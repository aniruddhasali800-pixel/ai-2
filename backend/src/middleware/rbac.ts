import type { NextFunction, Request, Response } from 'express';
import { roleHasPermission, type Permission, type Role } from '../types/constants';
import { ApiError } from '../utils/httpError';

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) return next(ApiError.unauthorized());
    const allowed = permissions.every((p) => roleHasPermission(auth.role, p));
    if (!allowed) return next(ApiError.forbidden());
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) return next(ApiError.unauthorized());
    if (!roles.includes(auth.role)) return next(ApiError.forbidden());
    next();
  };
}
