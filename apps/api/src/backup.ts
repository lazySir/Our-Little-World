import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { PrismaClient } from '@prisma/client';
import { Controller, Get, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Mutex } from 'async-mutex';
import { z, date, schemas, text } from './validation';
import { today } from './resources';
const { fail } = require('./auth');
const config = require('./config');

const VERSION = 1;
const safeFilename = /^[a-zA-Z0-9-]+\.webp$/;
type BackupContext = { db: PrismaClient; assets: any; route: Function; auth: any; mutex: Mutex };
async function dataset(db: PrismaClient, user: any, includeCredentials = false) {
  const [space, users, entries, assets] = await db.$transaction([
    db.space.findUnique({ where: { id: user.spaceId } }),
    db.user.findMany({ where: { spaceId: user.spaceId } }),
    db.entry.findMany({ where: { spaceId: user.spaceId } }),
    db.asset.findMany({ where: { spaceId: user.spaceId } }),
  ]);
  return {
    version: VERSION,
    exportedAt: new Date().toISOString(),
    space,
    users: users.map((u) => {
      const { passwordHash, ...publicData } = u;
      return includeCredentials ? u : publicData;
    }),
    entries,
    assets,
  };
}
export function makeBackupController({ db, assets, route, mutex }: BackupContext) {
  async function archive(user: any, { allowMissingAssets = false } = {}) {
    const data = await dataset(db, user, true);
    const zip = new AdmZip();
    const missingAssets: { id: string; filename: string }[] = [];
    zip.addFile('data.json', Buffer.from(JSON.stringify(data)));
    for (const asset of data.assets) {
      if (!safeFilename.test(asset.filename)) fail(500, '附件文件名无效');
      try {
        const bytes = await fs.readFile(path.join(assets.directory, asset.filename));
        zip.addFile(`uploads/${asset.filename}`, bytes);
      } catch (error: any) {
        if (!allowMissingAssets && error.code === 'ENOENT')
          fail(409, '有照片文件缺失，请先使用以前保存的完整备份恢复，再重新备份');
        if (!allowMissingAssets || error.code !== 'ENOENT') throw error;
        missingAssets.push({ id: asset.id, filename: asset.filename });
      }
    }
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          product: 'our-little-world',
          version: VERSION,
          createdAt: data.exportedAt,
          format: 'logical-sqlite',
          complete: missingAssets.length === 0,
          missingAssets,
        }),
      ),
    );
    // SQLite snapshot plus logical data makes the archive useful for both
    // direct offline recovery and safe in-process restore without replacing handles.
    const snapshot = path.join(config.storage, `snapshot-${crypto.randomUUID()}.db`);
    try {
      await db.$executeRawUnsafe(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
      zip.addFile('database.sqlite', await fs.readFile(snapshot));
    } finally {
      await fs.unlink(snapshot).catch(() => {});
    }
    return { buffer: zip.toBuffer(), missingAssets };
  }
  class BackupController {
    async export(req: any, res: any) {
      const data = await dataset(db, req.user, false);
      // Portable ordinary exports keep future letters sealed for every role.
      data.entries = data.entries.map((e) => {
        if (e.kind !== 'letters') return e;
        const payload = JSON.parse(e.data);
        if (payload.unlockDate > today()) delete payload.content;
        return { ...e, data: JSON.stringify(payload) };
      });
      res
        .set({
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="little-world-export.json"',
          'Cache-Control': 'no-store',
        })
        .send(JSON.stringify(data, null, 2));
    }
    async download(req: any, res: any) {
      if (req.user.role !== 'owner') fail(403, '只有创建者可以备份整个空间');
      const backup = await archive(req.user);
      res
        .set({
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="little-world-backup.zip"',
          'Cache-Control': 'no-store',
        })
        .send(backup.buffer);
    }
    async restore(req: any, file: any) {
      if (req.user.role !== 'owner') fail(403, '只有创建者可以恢复空间');
      if (!file) fail(400, '请选择备份 ZIP');
      let zip: any, data: any;
      try {
        zip = new AdmZip(file.buffer);
        const rows = zip.getEntries();
        if (rows.length > 10000) throw new Error();
        let total = 0;
        for (const entry of rows) {
          const name = entry.entryName;
          if (
            name.includes('..') ||
            name.includes('\\') ||
            name.startsWith('/') ||
            name.includes(':')
          )
            throw new Error();
          total += entry.header.size;
          if (total > 250 * 1024 * 1024) throw new Error();
          if (
            !['manifest.json', 'data.json', 'database.sqlite'].includes(name) &&
            !/^uploads\/[a-zA-Z0-9-]+\.webp$/.test(name)
          )
            throw new Error();
        }
        const manifest = JSON.parse(zip.readAsText('manifest.json'));
        data = JSON.parse(zip.readAsText('data.json'));
        if (manifest.complete === false)
          fail(400, '此恢复前保护副本缺少附件，不能作为完整备份恢复');
        if (
          manifest.product !== 'our-little-world' ||
          manifest.version !== VERSION ||
          data.version !== VERSION ||
          !Array.isArray(data.entries) ||
          !Array.isArray(data.assets) ||
          !Array.isArray(data.users)
        )
          throw new Error();
        if (data.space?.id !== req.user.spaceId) fail(400, '只能恢复当前空间的备份');
        if (data.entries.length > 10000 || data.assets.length > 10000 || data.users.length > 2)
          throw new Error();
        const users = await db.user.findMany({ where: { spaceId: req.user.spaceId } });
        // Preserve current accounts and passwords. Restore never imports credentials.
        z.object({
          name: text(80).min(1),
          startDate: date,
          theme: z.enum(['cream', 'rose', 'sage']),
        }).parse(data.space);
        const userIds = new Set(users.map((u) => u.id)),
          entryIds = new Set<string>(),
          assetIds = new Set<string>(),
          filenames = new Set<string>();
        const timestamp = z.string().datetime();
        for (const asset of data.assets) {
          z.object({
            id: z.string().min(1).max(100),
            filename: z.string().regex(safeFilename),
            originalName: z.string().max(200),
            mime: z.literal('image/webp'),
            size: z
              .number()
              .int()
              .positive()
              .max(10 * 1024 * 1024),
            createdAt: timestamp,
          }).parse(asset);
          if (
            asset.spaceId !== req.user.spaceId ||
            !zip.getEntry(`uploads/${asset.filename}`) ||
            assetIds.has(asset.id) ||
            filenames.has(asset.filename)
          )
            throw new Error();
          const image = zip.readFile(`uploads/${asset.filename}`);
          if (!image || image.length !== asset.size) throw new Error();
          assetIds.add(asset.id);
          filenames.add(asset.filename);
        }
        let babyCount = 0;
        for (const row of data.entries) {
          z.object({
            id: z.string().min(1).max(100),
            kind: z.string(),
            data: z.string().max(100000),
            createdAt: timestamp,
            updatedAt: timestamp,
          }).parse(row);
          if (
            row.spaceId !== req.user.spaceId ||
            !userIds.has(row.authorId) ||
            entryIds.has(row.id) ||
            !Object.hasOwn(schemas, row.kind)
          )
            throw new Error();
          const schema = schemas[row.kind as keyof typeof schemas];
          const payload: Record<string, any> = schema.parse(JSON.parse(row.data));
          const refs = [...(payload.assetIds || []), payload.assetId, payload.avatarId].filter(
            Boolean,
          );
          if (refs.some((id: string) => !assetIds.has(id))) throw new Error();
          if (row.kind === 'baby' && ++babyCount > 1) throw new Error();
          if (row.kind === 'orders') {
            const snapshot = JSON.parse(row.data);
            const items = z
              .array(
                z.object({
                  menuItemId: z.string(),
                  name: z.string().min(1).max(120),
                  quantity: z.number().int().min(1).max(99),
                  priceCents: z.number().int().min(0).max(100000000),
                }),
              )
              .min(1)
              .max(100)
              .parse(snapshot.items);
            if (
              snapshot.totalCents !== items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0)
            )
              throw new Error();
          }
          entryIds.add(row.id);
        }
      } catch (error: any) {
        if (error.getStatus) throw error;
        fail(400, '备份文件无效、版本不兼容或超过大小限制');
      }
      const backups = path.join(config.storage, 'backups');
      await fs.mkdir(backups, { recursive: true });
      const safetyName = `before-restore-${Date.now()}.zip`;
      const safety = await archive(req.user, { allowMissingAssets: true });
      await fs.writeFile(path.join(backups, safetyName), safety.buffer);
      await fs.mkdir(assets.directory, { recursive: true });
      const added: string[] = [];
      const replaced = new Map<string, Buffer>();
      try {
        for (const asset of data.assets) {
          const destination = path.join(assets.directory, asset.filename);
          const restored = zip.readFile(`uploads/${asset.filename}`);
          let previous: Buffer | undefined;
          try {
            previous = await fs.readFile(destination);
          } catch (error: any) {
            if (error.code !== 'ENOENT') throw error;
          }
          if (previous?.equals(restored)) continue;
          if (previous) replaced.set(destination, previous);
          else added.push(destination);
          await fs.writeFile(destination, restored);
        }
        await db.$transaction(async (tx) => {
          await tx.entry.deleteMany({ where: { spaceId: req.user.spaceId } });
          await tx.asset.deleteMany({ where: { spaceId: req.user.spaceId } });
          await tx.space.update({
            where: { id: req.user.spaceId },
            data: {
              name: data.space.name,
              startDate: data.space.startDate,
              theme: data.space.theme,
            },
          });
          for (const a of data.assets)
            await tx.asset.create({
              data: {
                id: a.id,
                spaceId: req.user.spaceId,
                filename: a.filename,
                originalName: a.originalName,
                mime: a.mime,
                size: a.size,
                createdAt: new Date(a.createdAt),
              },
            });
          for (const e of data.entries)
            await tx.entry.create({
              data: {
                id: e.id,
                kind: e.kind,
                data: e.data,
                spaceId: req.user.spaceId,
                authorId: e.authorId,
                createdAt: new Date(e.createdAt),
                updatedAt: new Date(e.updatedAt),
              },
            });
          await tx.invite.deleteMany({ where: { spaceId: req.user.spaceId } });
        });
      } catch (error) {
        await Promise.all(added.map((p) => fs.unlink(p).catch(() => {})));
        await Promise.all([...replaced].map(([p, bytes]) => fs.writeFile(p, bytes)));
        throw error;
      }
      return {
        ok: true,
        restartRequired: false,
        safetyBackup: safetyName,
        safetyMissingAssets: safety.missingAssets.length,
      };
    }
  }
  Controller('backup')(BackupController);
  route(BackupController, Get, 'export', 'export', [Req(), Res()]);
  route(BackupController, Get, 'download', 'download', [Req(), Res()]);
  route(BackupController, Post, 'restore', 'restore', [Req(), UploadedFile()]);
  UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))(
    BackupController.prototype,
    'restore',
    Object.getOwnPropertyDescriptor(BackupController.prototype, 'restore')!,
  );
  // The caller's lifecycle provider owns the daily timer and shared write mutex.
  (BackupController as any).runAutomatic = () =>
    mutex.runExclusive(async () => {
      const owner = await db.user.findFirst({ where: { role: 'owner' } });
      if (!owner) return;
      const directory = path.join(config.storage, 'backups');
      await fs.mkdir(directory, { recursive: true });
      const backup = await archive(owner);
      await fs.writeFile(path.join(directory, `auto-${Date.now()}.zip`), backup.buffer);
      const files = (await fs.readdir(directory))
        .filter((f) => /^auto-\d+\.zip$/.test(f))
        .sort()
        .reverse();
      for (const old of files.slice(7)) await fs.unlink(path.join(directory, old));
    });
  return BackupController;
}
