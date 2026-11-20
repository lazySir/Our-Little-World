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

export function createRateLimitMiddleware(): RateLimitMiddleware {
  const buckets = new Map<string, { count: number; reset: number }>();
  const cleanup = setInterval(() => {
    for (const [key, bucket] of buckets) if (bucket.reset < Date.now()) buckets.delete(key);
  }, 60000);
  cleanup.unref();
  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const sensitive = /^\/api\/auth\/(login|setup|join)$/.test(req.path);
    const key = `${req.ip}:${sensitive ? 'auth' : 'general'}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset < Date.now()) {
      bucket = { count: 0, reset: Date.now() + 60000 };
      buckets.set(key, bucket);
    }
    if (++bucket.count > (sensitive ? 20 : 600))
      return res.status(429).json({ message: '请求过于频繁，请稍后再试' });
    next();
  };
  return Object.assign(middleware, { close: () => clearInterval(cleanup) });
}
