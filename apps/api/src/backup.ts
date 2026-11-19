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
import { assertBackupBudget, BACKUP_LIMITS, BackupLimitError } from './backup-limits';
const { fail } = require('./auth');
const config = require('./config');

const VERSION = 1;
const safeFilename = /^[a-zA-Z0-9-]+\.webp$/;
const safetyBackupName = /^before-restore-(\d+)(?:-[a-f0-9-]{36})?\.zip$/;
type BackupContext = { db: PrismaClient; assets: any; route: Function; auth: any; mutex: Mutex };
async function pruneRestoreSafetyBackups(directory: string) {
  const backups = (await fs.readdir(directory))
    .flatMap((name) => {
      const match = safetyBackupName.exec(name);
      return match ? [{ name, timestamp: Number(match[1]) }] : [];
    })
    .sort((a, b) => b.timestamp - a.timestamp || b.name.localeCompare(a.name));
  for (const backup of backups.slice(7)) {
    await fs.unlink(path.join(directory, backup.name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
async function writeRestoreSafetyBackup(directory: string, buffer: Buffer) {
  const names = await fs.readdir(directory);
  const latestTimestamp = names.reduce((latest, name) => {
    const match = safetyBackupName.exec(name);
    return match ? Math.max(latest, Number(match[1])) : latest;
  }, 0);
  let timestamp = Math.max(Date.now(), latestTimestamp + 1);
  while (true) {
    const name = `before-restore-${timestamp}-${crypto.randomUUID()}.zip`;
    try {
      await fs.writeFile(path.join(directory, name), buffer, { flag: 'wx' });
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      timestamp++;
    }
  }
}
async function removeUnreferencedAssets(directory: string, retainedFilenames: Set<string>) {
  try {
    const files = await fs.readdir(directory, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !safeFilename.test(file.name) || retainedFilenames.has(file.name))
        continue;
      await fs.unlink(path.join(directory, file.name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  } catch (error) {
    console.error('恢复成功，但清理旧附件失败:', error);
  }
}
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
    try {
      // Reject counts and a lower byte estimate before materializing all payloads.
      const [entryStats, assetStats, users] = await db.$transaction([
        db.$queryRaw<{ records: bigint | number; bytes: bigint | number }[]>`
          SELECT COUNT(*) AS records, COALESCE(SUM(LENGTH(CAST("data" AS BLOB))), 0) AS bytes
          FROM "Entry" WHERE "spaceId" = ${user.spaceId}`,
        db.asset.aggregate({
          where: { spaceId: user.spaceId },
          _count: { _all: true },
          _sum: { size: true },
        }),
        db.user.count({ where: { spaceId: user.spaceId } }),
      ]);
      assertBackupBudget({
        records: Number(entryStats[0].records),
        assets: assetStats._count._all,
        users,
        zipEntries: assetStats._count._all + 3,
        expandedBytes: Number(entryStats[0].bytes) + (assetStats._sum.size || 0),
      });
      const data = await dataset(db, user, true);
      const dataBytes = Buffer.from(JSON.stringify(data));
      const missingAssets: { id: string; filename: string }[] = [];
      const damagedAssets: {
        id: string;
        filename: string;
        expectedSize: number;
        actualSize: number;
      }[] = [];
      const files: { filename: string; source: string; size: number }[] = [];
      let expandedBytes = dataBytes.length;
      assertBackupBudget({ expandedBytes });
      // Inspect every attachment before reading any attachment into memory.
      for (const asset of data.assets) {
        if (!safeFilename.test(asset.filename)) fail(500, '附件文件名无效');
        const source = path.join(assets.directory, asset.filename);
        try {
          const stat = await fs.stat(source);
          assertBackupBudget({ assetBytes: stat.size });
          if (stat.size !== asset.size) {
            if (!allowMissingAssets) fail(409, '照片文件大小与记录不一致，请先恢复完整备份');
            damagedAssets.push({
              id: asset.id,
              filename: asset.filename,
              expectedSize: asset.size,
              actualSize: stat.size,
            });
          }
          expandedBytes += stat.size;
          assertBackupBudget({ expandedBytes });
          files.push({ filename: asset.filename, source, size: stat.size });
        } catch (error: any) {
          if (!allowMissingAssets && error.code === 'ENOENT')
            fail(409, '有照片文件缺失，请先使用以前保存的完整备份恢复，再重新备份');
          if (!allowMissingAssets || error.code !== 'ENOENT') throw error;
          missingAssets.push({ id: asset.id, filename: asset.filename });
        }
      }
      const manifestBytes = Buffer.from(
        JSON.stringify({
          product: 'our-little-world',
          version: VERSION,
          createdAt: data.exportedAt,
          format: 'logical-sqlite',
          complete: missingAssets.length === 0 && damagedAssets.length === 0,
          missingAssets,
          damagedAssets,
        }),
      );
      expandedBytes += manifestBytes.length;
      assertBackupBudget({ expandedBytes });
      // SQLite snapshot plus logical data supports direct offline recovery.
      const snapshot = path.join(config.storage, `snapshot-${crypto.randomUUID()}.db`);
      try {
        await db.$executeRawUnsafe(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
        expandedBytes += (await fs.stat(snapshot)).size;
        assertBackupBudget({ expandedBytes });
        const zip = new AdmZip();
        zip.addFile('data.json', dataBytes);
        zip.addFile('manifest.json', manifestBytes);
        zip.addFile('database.sqlite', await fs.readFile(snapshot));
        for (const file of files) {
          const bytes = await fs.readFile(file.source);
          if (bytes.length !== file.size) fail(409, '照片文件在备份期间发生变化，请重新备份');
          zip.addFile(`uploads/${file.filename}`, bytes);
        }
        const buffer = zip.toBuffer();
        assertBackupBudget({ zipBytes: buffer.length });
        return { buffer, missingAssets, damagedAssets };
      } finally {
        await fs.unlink(snapshot).catch(() => {});
      }
    } catch (error) {
      if (error instanceof BackupLimitError) fail(413, error.message);
      throw error;
    }
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
        assertBackupBudget({ zipEntries: rows.length, zipBytes: file.buffer.length });
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
          assertBackupBudget({ expandedBytes: total });
          if (
            !['manifest.json', 'data.json', 'database.sqlite'].includes(name) &&
            !/^uploads\/[a-zA-Z0-9-]+\.webp$/.test(name)
          )
            throw new Error();
        }
        const manifest = JSON.parse(zip.readAsText('manifest.json'));
        data = JSON.parse(zip.readAsText('data.json'));
        if (manifest.complete === false)
          fail(400, '此恢复前保护副本的附件不完整，不能作为完整备份恢复');
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
        assertBackupBudget({
          records: data.entries.length,
          assets: data.assets.length,
          users: data.users.length,
        });
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
            size: z.number().int().positive().max(BACKUP_LIMITS.assetBytes),
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
      const safety = await archive(req.user, { allowMissingAssets: true });
      const safetyName = await writeRestoreSafetyBackup(backups, safety.buffer);
      try {
        await pruneRestoreSafetyBackups(backups);
      } catch (error) {
        console.error('恢复前保护副本清理失败:', error);
      }
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
        try {
          const retainedAssets = await db.asset.findMany({ select: { filename: true } });
          await removeUnreferencedAssets(
            assets.directory,
            new Set(retainedAssets.map((asset) => asset.filename)),
          );
        } catch (error) {
          console.error('恢复成功，但清理旧附件失败:', error);
        }
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
        safetyDamagedAssets: safety.damagedAssets.length,
      };
    }
  }
  Controller('backup')(BackupController);
  route(BackupController, Get, 'export', 'export', [Req(), Res()]);
  route(BackupController, Get, 'download', 'download', [Req(), Res()]);
  route(BackupController, Post, 'restore', 'restore', [Req(), UploadedFile()]);
  UseInterceptors(
    // Busboy emits its limit at equality; the shared budget accepts the exact boundary.
    FileInterceptor('file', { limits: { fileSize: BACKUP_LIMITS.zipBytes + 1, files: 1 } }),
  )(
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
