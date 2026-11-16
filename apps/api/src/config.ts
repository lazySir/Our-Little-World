import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
const root = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '../.env'), quiet: true });
process.env.RUST_LOG ||= 'info';
const storage = path.resolve(root, process.env.STORAGE_DIR || 'storage');
fs.mkdirSync(storage, { recursive: true });
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = `file:${path.join(root, 'data/world.db').replace(/\\/g, '/')}`;
let assetSecret = process.env.ASSET_SECRET;
if (!assetSecret) {
  const secretPath = path.join(storage, '.asset-secret');
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  assetSecret = fs.readFileSync(secretPath, 'utf8').trim();
}
const config = { root, storage, assetSecret, port: Number(process.env.PORT || 3000), host: process.env.HOST || '0.0.0.0' };
export = config;
