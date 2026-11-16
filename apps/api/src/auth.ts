import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { HttpException } from '@nestjs/common';
import type { PrismaClient, User } from '@prisma/client';
import type { AuthenticatedRequest, SpaceUser } from './types';
import { z, text, date, credentials, passwordInput } from './validation';
export function fail(status: number, message: string): never {
  throw new HttpException(message, status);
}
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const publicUser = ({
  id,
  username,
  nickname,
  role,
}: Pick<User, 'id' | 'username' | 'nickname' | 'role'>) => ({ id, username, nickname, role });
export class AuthService {
  constructor(private readonly db: PrismaClient) {}
  async status() {
    return { initialized: Boolean(await this.db.space.count()) };
  }
  async session(user: SpaceUser) {
    const token = randomBytes(32).toString('base64url');
    await this.db.session.create({
      data: { id: digest(token), userId: user.id, expiresAt: new Date(Date.now() + 30 * 86400000) },
    });
    const space = await this.db.space.findUnique({ where: { id: user.spaceId } });
    return { token, user: publicUser(user), space };
  }
  async authenticate(req: AuthenticatedRequest) {
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
    if (!token) fail(401, '请先登录');
    const session = await this.db.session.findUnique({
      where: { id: digest(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) fail(401, '登录已过期，请重新登录');
    req.user = session.user;
    req.sessionId = session.id;
    return session.user;
  }
  async setup(body: unknown) {
    if ((await this.status()).initialized) fail(409, '空间已经创建，请登录或使用邀请码加入');
    const input = z
      .object({
        ...credentials,
        nickname: text(40).min(1),
        spaceName: text(80).min(1),
        startDate: date,
      })
      .parse(body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.db.$transaction(async (tx) => {
      await tx.space.create({
        data: { id: 'home', name: input.spaceName, startDate: input.startDate },
      });
      return tx.user.create({
        data: {
          username: input.username,
          nickname: input.nickname,
          passwordHash,
          role: 'owner',
          spaceId: 'home',
        },
      });
    });
    return this.session(user);
  }
  async login(body: unknown) {
    const input = z
      .object({ username: z.string().trim().toLowerCase().max(100), password: passwordInput })
      .parse(body);
    const user = await this.db.user.findUnique({ where: { username: input.username } });
    // Equal-cost comparison for absent accounts avoids username enumeration by timing.
    const valid = await bcrypt.compare(
      input.password,
      user?.passwordHash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW',
    );
    if (!user || !valid) fail(401, '账号或密码不正确');
    return this.session(user);
  }
  async invite(user: SpaceUser) {
    if ((await this.db.user.count({ where: { spaceId: user.spaceId } })) >= 2)
      fail(409, '这个空间已经住着两个人了');
    const code = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 86400000);
    await this.db.invite.deleteMany({ where: { spaceId: user.spaceId } });
    await this.db.invite.create({ data: { id: digest(code), spaceId: user.spaceId, expiresAt } });
    return { code, expiresAt };
  }
  async join(body: unknown) {
    const input = z
      .object({
        ...credentials,
        nickname: text(40).min(1),
        code: z.string().trim().toUpperCase().min(1),
      })
      .parse(body);
    const hash = await bcrypt.hash(input.password, 12);
    const user = await this.db.$transaction(async (tx) => {
      const invite = await tx.invite.findUnique({ where: { id: digest(input.code) } });
      if (!invite || invite.expiresAt < new Date()) fail(400, '邀请码无效或已过期');
      if ((await tx.user.count({ where: { spaceId: invite.spaceId } })) >= 2) fail(409, '空间已满');
      const created = await tx.user.create({
        data: {
          username: input.username,
          nickname: input.nickname,
          passwordHash: hash,
          spaceId: invite.spaceId,
        },
      });
      await tx.invite.delete({ where: { id: invite.id } });
      return created;
    });
    return this.session(user);
  }
  async me(user: SpaceUser) {
    const space = await this.db.space.findUnique({ where: { id: user.spaceId } });
    const partner = await this.db.user.findFirst({
      where: { spaceId: user.spaceId, id: { not: user.id } },
    });
    return { user: publicUser(user), space, partner: partner ? publicUser(partner) : null };
  }
  async profile(user: SpaceUser, body: unknown) {
    const { nickname } = z.object({ nickname: text(40).min(1) }).parse(body);
    return publicUser(await this.db.user.update({ where: { id: user.id }, data: { nickname } }));
  }
  async password(user: SpaceUser, sessionId: string, body: unknown) {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: passwordInput, newPassword: credentials.password })
      .parse(body);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) fail(400, '原密码不正确');
    const hash = await bcrypt.hash(newPassword, 12);
    await this.db.$transaction([
      this.db.user.update({ where: { id: user.id }, data: { passwordHash: hash } }),
      this.db.session.deleteMany({ where: { userId: user.id, id: { not: sessionId } } }),
    ]);
    return { ok: true };
  }
  async space(user: SpaceUser, body: unknown) {
    const input = z
      .object({ name: text(80).min(1), startDate: date, theme: z.enum(['cream', 'rose', 'sage']) })
      .partial()
      .parse(body);
    return this.db.space.update({ where: { id: user.spaceId }, data: input });
  }
  async logout(sessionId: string) {
    await this.db.session.deleteMany({ where: { id: sessionId } });
    return { ok: true };
  }
}
