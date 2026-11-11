import path from 'node:path';
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { uploadImage } from '../../middleware/upload';
import { ApiError } from '../../utils/httpError';

export const uploadsRouter = Router();

// Public upload endpoint for onboarding / logo upload before an account is signed in
uploadsRouter.post(
  '/public',
  uploadImage.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Choose an image to upload');
    res.status(201).json({
      url: `/uploads/${path.basename(req.file.filename)}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  }),
);

uploadsRouter.use(requireAuth);

uploadsRouter.post(
  '/',
  requirePermission('menu:write'),
  uploadImage.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Choose an image to upload');
    res.status(201).json({
      url: `/uploads/${path.basename(req.file.filename)}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  }),
);
