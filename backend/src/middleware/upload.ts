import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env';
import { randomToken } from '../utils/tokens';
import { ApiError } from '../utils/httpError';

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);

/**
 * An iPhone hands over a .heic and the browser is inconsistent about naming its type — Safari says
 * image/heic, some Windows pickers send application/octet-stream — so the extension is read as well as
 * the declared type. Anything else, including the script- and markup-capable formats, stays refused.
 */
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || '.jpg';
    cb(null, `${Date.now()}-${randomToken(6)}${ext}`);
  },
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedTypes.has(file.mimetype) && !allowedExtensions.has(ext)) {
      cb(ApiError.badRequest('Only JPEG, PNG, WEBP, GIF or HEIC images are allowed'));
      return;
    }
    cb(null, true);
  },
});

export { uploadDir };
