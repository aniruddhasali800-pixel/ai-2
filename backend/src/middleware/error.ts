import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import { env } from '../config/env';
import { ApiError } from '../utils/httpError';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details: err.flatten().fieldErrors },
    });
    return;
  }

  if (err instanceof MulterError) {
    res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: { code: 'BAD_ID', message: `Invalid value for ${err.path}` } });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Database validation failed', details } });
    return;
  }

  const mongoErr = err as { code?: number; keyValue?: Record<string, unknown> };
  if (mongoErr?.code === 11000) {
    res.status(409).json({
      error: { code: 'DUPLICATE', message: 'A record with these details already exists', details: mongoErr.keyValue },
    });
    return;
  }

  if (!env.isProd) console.error('[error]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } });
}
