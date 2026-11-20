import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Application } from 'express';

export function configureTrustedProxies(app: Application, value = '') {
  const trustedProxies = value
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (trustedProxies.length) app.set('trust proxy', trustedProxies);
}

export type RateLimitMiddleware = RequestHandler & { close: () => void };

export interface RateLimitOptions {
  authLimit?: number;
  generalLimit?: number;
  windowMs?: number;
}

function positiveLimit(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

export function createRateLimitMiddleware(options: RateLimitOptions = {}): RateLimitMiddleware {
  const authLimit = positiveLimit(options.authLimit, 20);
  const generalLimit = positiveLimit(options.generalLimit, 600);
  const windowMs = positiveLimit(options.windowMs, 60000);
  const buckets = new Map<string, { count: number; reset: number }>();
  const cleanup = setInterval(() => {
    for (const [key, bucket] of buckets) if (bucket.reset < Date.now()) buckets.delete(key);
  }, Math.min(windowMs, 60000));
  cleanup.unref();
  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const sensitive = /^\/api\/auth\/(login|setup|join)$/.test(req.path);
    const key = `${req.ip}:${sensitive ? 'auth' : 'general'}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset < Date.now()) {
      bucket = { count: 0, reset: Date.now() + windowMs };
      buckets.set(key, bucket);
    }
    if (++bucket.count > (sensitive ? authLimit : generalLimit))
      return res.status(429).json({ message: '请求过于频繁，请稍后再试' });
    next();
  };
  return Object.assign(middleware, { close: () => clearInterval(cleanup) });
}
