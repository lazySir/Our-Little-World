import 'reflect-metadata';
import config = require('./config');
import fs from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  Module,
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Req,
  Res,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Catch,
} from '@nestjs/common';
import type {
  ArgumentsHost,
  ExecutionContext,
  INestApplication,
  CanActivate,
  ExceptionFilter,
  Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createPrismaClient } from './db/client';
import { ZodError } from 'zod';
import express from 'express';
import type { Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import methodOverride from 'method-override';
import { AuthService } from './auth';
import { AssetsService } from './assets';
import { ResourcesService } from './resources';
import { schemas } from './validation';
import type { AuthenticatedRequest, AssetQuery } from './types';
import { Mutex } from 'async-mutex';
import { makeBackupController } from './backup';
import { from, lastValueFrom } from 'rxjs';
import { prepareSetupToken } from './setup-token';
import { configureTrustedProxies, createRateLimitMiddleware } from './rate-limit';

class ErrorFilter implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (res.headersSent) return;
    let status = error.getStatus?.() || 500;
    let message = status === 500 ? '服务暂时出错，请稍后再试' : error.message;
    if (error instanceof ZodError) {
      status = 400;
      message = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('；');
    }
    if (error.code === 'P2002') {
      status = 409;
      message = '账号或数据已存在';
    }
    if (error.code === 'P2025') {
      status = 404;
      message = '记录不存在';
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      message = '文件超过大小限制';
    }
    if (status >= 500) console.error(error);
    res.status(status).json({ message });
  }
}
Catch()(ErrorFilter);
export interface WorldApplication extends INestApplication {}
export async function createApp(options: { logger?: boolean } = {}): Promise<WorldApplication> {
  const db = createPrismaClient();
  await db.$connect();
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  const setupToken = await prepareSetupToken(db, config.storage, process.env.SETUP_TOKEN);
  const auth = new AuthService(db, setupToken);
  const rateLimit = createRateLimitMiddleware();
  class AuthGuard implements CanActivate {
    async canActivate(context: ExecutionContext) {
      await auth.authenticate(context.switchToHttp().getRequest());
      return true;
    }
  }
  // Bind guards and routes to this server instance, including test instances.
  function route(
    klass: any,
    method: any,
    name: string,
    url: string,
    parameters: ParameterDecorator[] = [],
    secure = true,
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(klass.prototype, name)!;
    method(url)(klass.prototype, name, descriptor);
    parameters.forEach((parameter, index) => parameter(klass.prototype, name, index));
    if (secure) UseGuards(AuthGuard)(klass.prototype, name, descriptor);
  }
  const assets = new AssetsService(db);
  const resources = new ResourcesService(db, assets);
  const mutex = new Mutex();
  let backupTimer: ReturnType<typeof setInterval> | undefined;
  class AuthController {
    status() {
      return auth.status();
    }
    setup(body) {
      return auth.setup(body);
    }
    login(body) {
      return auth.login(body);
    }
    join(body) {
      return auth.join(body);
    }
    me(req) {
      return auth.me(req.user);
    }
    invite(req) {
      return auth.invite(req.user);
    }
    logout(req) {
      return auth.logout(req.sessionId);
    }
    password(req, body) {
      return auth.password(req.user, req.sessionId, body);
    }
    profile(req, body) {
      return auth.profile(req.user, body);
    }
  }
  Controller('auth')(AuthController);
  route(AuthController, Get, 'status', 'status', [], false);
  for (const action of ['setup', 'login', 'join'])
    route(AuthController, Post, action, action, [Body()], false);
  route(AuthController, Get, 'me', 'me', [Req()]);
  for (const action of ['invite', 'logout']) route(AuthController, Post, action, action, [Req()]);
  for (const action of ['password', 'profile'])
    route(AuthController, Patch, action, action, [Req(), Body()]);
  class SpaceController {
    space(req: AuthenticatedRequest, body) {
      return auth.space(req.user, body);
    }
    dashboard(req: AuthenticatedRequest) {
      return resources.dashboard(req.user);
    }
    health() {
      return { ok: true, version: '1.0.0', database: 'sqlite' };
    }
  }
  Controller()(SpaceController);
  route(SpaceController, Patch, 'space', 'space', [Req(), Body()]);
  route(SpaceController, Get, 'dashboard', 'dashboard', [Req()]);
  route(SpaceController, Get, 'health', 'health', [], false);
  const controllers: Type<any>[] = [AuthController, SpaceController];
  for (const kind of Object.keys(schemas).filter((k) => k !== 'baby')) {
    class ResourceController {
      list(req) {
        return resources.list(kind, req.user);
      }
      create(req, body) {
        return resources.save(kind, req.user, body);
      }
      update(req, id, body) {
        return resources.save(kind, req.user, body, id);
      }
      remove(req, id) {
        return resources.remove(kind, req.user, id);
      }
    }
    Object.defineProperty(ResourceController, 'name', { value: `${kind}Controller` });
    Controller(kind)(ResourceController);
    route(ResourceController, Get, 'list', '', [Req()]);
    route(ResourceController, Post, 'create', '', [Req(), Body()]);
    route(ResourceController, Patch, 'update', ':id', [Req(), Param('id'), Body()]);
    route(ResourceController, Delete, 'remove', ':id', [Req(), Param('id')]);
    controllers.push(ResourceController);
  }
  class BabyController {
    async get(req: AuthenticatedRequest, res: Response) {
      res.json(await resources.baby(req.user));
    }
    put(req, body) {
      return resources.baby(req.user, body);
    }
  }
  Controller('baby')(BabyController);
  route(BabyController, Get, 'get', '', [Req(), Res()]);
  route(BabyController, Put, 'put', '', [Req(), Body()]);
  controllers.push(BabyController);
  class AssetsController {
    list(req) {
      return assets.list(req.user);
    }
    upload(req, file) {
      return assets.upload(req.user, file);
    }
    remove(req, id) {
      return assets.remove(req.user, id);
    }
    async file(id: string, query: AssetQuery, res: Response) {
      const { asset, buffer } = await assets.file(id, query);
      res
        .set({
          'Content-Type': asset.mime,
          'Cache-Control': 'private, max-age=86400',
          'Content-Disposition': 'inline',
          'X-Content-Type-Options': 'nosniff',
        })
        .send(buffer);
    }
  }
  Controller('assets')(AssetsController);
  route(AssetsController, Get, 'list', '', [Req()]);
  route(AssetsController, Post, 'upload', '', [Req(), UploadedFile()]);
  UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))(
    AssetsController.prototype,
    'upload',
    Object.getOwnPropertyDescriptor(AssetsController.prototype, 'upload')!,
  );
  route(AssetsController, Delete, 'remove', ':id', [Req(), Param('id')]);
  route(AssetsController, Get, 'file', ':id/file', [Param('id'), Query(), Res()], false);
  controllers.push(AssetsController);
  // Backup controller is added separately so archive handling stays isolated.
  const BackupController = makeBackupController({ db, assets, route, auth, mutex });
  controllers.push(BackupController);
  const backupHours = Number(process.env.AUTO_BACKUP_HOURS || 24);
  if (Number.isFinite(backupHours) && backupHours > 0) {
    backupTimer = setInterval(() => {
      (BackupController as any)
        .runAutomatic()
        .catch((e: Error) => console.error('自动备份失败:', e.message));
    }, backupHours * 3600000);
    backupTimer.unref();
  }
  class AppModule {}
  Module({
    controllers,
    providers: [
      AuthGuard,
      { provide: 'PRISMA', useValue: db },
      {
        provide: 'WORLD_LIFECYCLE',
        useValue: {
          onModuleDestroy: async () => {
            rateLimit.close();
            if (backupTimer) clearInterval(backupTimer);
            await db.$disconnect();
          },
        },
      },
    ],
  })(AppModule);
  const app = await NestFactory.create<WorldApplication>(AppModule, {
    logger: options.logger === false ? false : ['log', 'error', 'warn'],
    bodyParser: false,
  });
  configureTrustedProxies(app.getHttpAdapter().getInstance(), process.env.TRUSTED_PROXY_CIDRS);
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }),
  );
  app.use(compression());
  // WeChat transports edits through POST; keep the existing PATCH routes and guards.
  app.use(
    methodOverride((req) => (req.header('X-HTTP-Method-Override') === 'PATCH' ? 'PATCH' : ''), {
      methods: ['POST'],
    }),
  );
  // A single private SQLite writer also makes archive DB/data/file snapshots
  // consistent, and prevents duplicate singleton profiles or mood upserts.
  app.useGlobalInterceptors({
    intercept(context, next) {
      const req = context.switchToHttp().getRequest<express.Request>();
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.path.startsWith('/api/backup/'))
        return next.handle();
      // Hold the lock until the actual handler settles, even if its client leaves.
      return from(
        mutex.runExclusive(() => lastValueFrom(next.handle(), { defaultValue: undefined })),
      );
    },
  });
  app.use(express.json({ limit: '2mb' }));
  const allowed = [
    ...(
      process.env.CORS_ORIGINS ||
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175'
    )
      .split(',')
      .filter(Boolean),
  ];
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-HTTP-Method-Override'],
  });
  app.use(rateLimit);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorFilter());
  const webDist = path.resolve(config.root, process.env.WEB_DIST_DIR || 'apps/web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false }));
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/') && !path.extname(req.path))
        return res.sendFile(path.join(webDist, 'index.html'));
      next();
    });
  }
  return app;
}
