import type { Request } from 'express';
import type { User } from '@prisma/client';

export type SpaceUser = Pick<
  User,
  'id' | 'username' | 'nickname' | 'role' | 'spaceId' | 'passwordHash'
>;
export interface AuthenticatedRequest extends Request {
  user: SpaceUser;
  sessionId: string;
}

/** Validated Zod resource payload stored inside the shared Entry envelope. */
export type ResourceData = Record<string, any>;
export interface AssetQuery {
  expires?: string;
  signature?: string;
}
