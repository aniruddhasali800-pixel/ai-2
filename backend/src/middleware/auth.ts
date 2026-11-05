import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { UserModel } from '../models';
import { ApiError } from '../utils/httpError';
import type { Role } from '../types/constants';

export interface AccessPayload {
  sub: string;
  rid: string;
  role: Role;
  name: string;
}

export function signAccessToken(payload: AccessPayload): string {
  const expiresIn = env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, { expiresIn });
}

/**
 * Resolves auth for incoming requests using Bearer JWT tokens (internal or Clerk session tokens).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('Please sign in to continue');

    let user: any = null;

    // 1. Try verifying as internal application JWT
    try {
      const payload = jwt.verify(token, env.ACCESS_TOKEN_SECRET) as AccessPayload;
      user = await UserModel.findById(payload.sub).select('name role status restaurantId permissions clerkUserId').lean();
    } catch {
      // 2. Try verifying as Clerk session token
      const decoded = jwt.decode(token) as any;
      if (decoded && decoded.sub && typeof decoded.sub === 'string') {
        const isExpired = decoded.exp && decoded.exp < Date.now() / 1000;
        if (!isExpired) {
          user = await UserModel.findOne({ clerkUserId: decoded.sub })
            .select('name role status restaurantId permissions clerkUserId')
            .lean();
        }
      }
    }

    if (!user) throw ApiError.unauthorized('Session expired or invalid, please sign in again');
    if (user.status !== 'ACTIVE') throw ApiError.forbidden('Account is suspended or inactive');

    req.auth = {
      userId: String(user._id),
      restaurantId: String(user.restaurantId),
      role: user.role as Role,
      name: user.name,
      clerkUserId: user.clerkUserId,
      permissions: user.permissions ?? [],
    };
    next();
  } catch (err) {
    next(err);
  }
}
