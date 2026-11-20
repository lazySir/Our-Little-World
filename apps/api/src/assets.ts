import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import type { Asset, PrismaClient } from './db/client';
import type { SpaceUser, AssetQuery } from './types';
import { fail } from './auth';
import config = require('./config');

const ASSET_URL_TTL_MS = 30 * 60 * 1000;

export class AssetsService {
  readonly directory: string;
  constructor(private readonly db: PrismaClient) {
    this.directory = path.join(config.storage, 'uploads');
  }
  signature(id: string, expires: string | number) {
    return crypto.createHmac('sha256', config.assetSecret).update(`${id}:${expires}`).digest('hex');
  }
  shape(asset: Asset) {
    const expires = Date.now() + ASSET_URL_TTL_MS;
    return {
      id: asset.id,
      url: `/api/assets/${asset.id}/file?expires=${expires}&signature=${this.signature(asset.id, expires)}`,
      mime: asset.mime,
      size: asset.size,
      originalName: asset.originalName,
      createdAt: asset.createdAt,
    };
  }
  async list(user: SpaceUser) {
    return (
      await this.db.asset.findMany({
        where: { spaceId: user.spaceId },
        orderBy: { createdAt: 'desc' },
      })
    ).map((a) => this.shape(a));
  }
  async renew(user: SpaceUser, id: string) {
    const asset = await this.db.asset.findFirst({ where: { id, spaceId: user.spaceId } });
    if (!asset) fail(404, '图片不存在');
    return this.shape(asset);
  }
  async upload(user: SpaceUser, file?: Express.Multer.File) {
    if (!file) fail(400, '请选择图片');
    if (file.size > 10 * 1024 * 1024) fail(413, '图片不能超过10MB');
    let buffer: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 40000000 });
      const metadata = await image.metadata();
      if (!metadata.format || !['jpeg', 'png', 'webp', 'gif'].includes(metadata.format))
        fail(400, '支持 JPEG、PNG、WebP、GIF 图片');
      // Decode and re-encode to strip metadata and prevent disguised active payloads.
      buffer = await image
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch (error) {
      if (error.status) throw error;
      fail(400, '图片损坏或格式不支持');
    }
    await fs.mkdir(this.directory, { recursive: true });
    const filename = `${crypto.randomUUID()}.webp`;
    await fs.writeFile(path.join(this.directory, filename), buffer);
    try {
      return this.shape(
        await this.db.asset.create({
          data: {
            spaceId: user.spaceId,
            filename,
            originalName: path.basename(file.originalname || 'photo').slice(0, 200),
            mime: 'image/webp',
            size: buffer.length,
          },
        }),
      );
    } catch (error) {
      await fs.unlink(path.join(this.directory, filename)).catch(() => {});
      throw error;
    }
  }
  async file(id: string, query: AssetQuery) {
    const { expires, signature } = query;
    if (
      !/^\d+$/.test(String(expires)) ||
      Number(expires) < Date.now() ||
      Number(expires) > Date.now() + ASSET_URL_TTL_MS ||
      !/^[a-f0-9]{64}$/.test(signature || '')
    )
      fail(403, '图片链接已失效，请刷新页面');
    if (!crypto.timingSafeEqual(Buffer.from(signature!), Buffer.from(this.signature(id, expires!))))
      fail(403, '无权查看图片');
    const asset = await this.db.asset.findUnique({ where: { id } });
    if (!asset) fail(404, '图片不存在');
    const buffer = await fs
      .readFile(path.join(this.directory, asset.filename))
      .catch(() => fail(404, '图片文件不存在'));
    return { asset, buffer };
  }
  async remove(user: SpaceUser, id: string) {
    const asset = await this.db.asset.findFirst({ where: { id, spaceId: user.spaceId } });
    if (!asset) fail(404, '图片不存在');
    const rows = await this.db.entry.findMany({ where: { spaceId: user.spaceId } });
    if (
      rows.some((row) => {
        const d = JSON.parse(row.data);
        return d.assetIds?.includes(id) || d.assetId === id || d.avatarId === id;
      })
    )
      fail(409, '图片仍被记录使用，请先移除关联');
    await this.db.asset.delete({ where: { id } });
    await fs.unlink(path.join(this.directory, asset.filename)).catch(() => {});
    return { ok: true };
  }
}
