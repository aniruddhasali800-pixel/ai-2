import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, allowedOrigins } from './config/env';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import { paymentWebhookRouter } from './modules/payments/webhook.routes';
import { deliveryWebhookRouter } from './modules/integrations/integrations.routes';

/**
 * The SPA talks to `/api` and to the same-origin Socket.IO endpoint, so once the
 * client is built this process can host it too — one port, no CORS hop.
 */
function findWebDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    env.STATIC_DIR && path.resolve(process.cwd(), env.STATIC_DIR),
    // from backend/dist when bundled, from backend/src when run by tsx
    path.resolve(here, '../../frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
  ].filter((dir): dir is string => Boolean(dir));
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? null;
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );
  app.use(cors({ origin: allowedOrigins, credentials: true }));

  if (!env.isTest) {
    app.use(morgan(env.isProd ? 'combined' : 'dev'));
  }

  // A staff screen re-reads the same URL every few seconds, and a JSON body with no freshness
  // header is fair game for the browser cache — the floor then replays yesterday's tables, and a
  // stale read is indistinguishable from a lost order.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Webhooks must see the raw body to verify signatures, so they are mounted
  // before the JSON parser.
  app.use('/api/payments/webhook', paymentWebhookRouter);
  app.use('/api/integrations/webhook', deliveryWebhookRouter);

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
  fs.mkdirSync(uploadDir, { recursive: true });
  app.use(
    '/uploads',
    express.static(uploadDir, {
      maxAge: '7d',
      immutable: true,
      // The mime table bundled into `send` predates HEIC, so an iPhone photo would be served as
      // application/octet-stream and a browser reading it as a picture would not be told it is one.
      setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.heic' || ext === '.heif') res.setHeader('Content-Type', ext === '.heic' ? 'image/heic' : 'image/heif');
      },
    }),
  );

  app.use('/api', apiRouter);

  const webDir = findWebDir();
  if (webDir) {
    app.use(express.static(webDir, { index: false }));
    // Anything that is not an API, upload or websocket path is a client route.
    app.get(/^(?!\/(api|uploads|socket\.io)(\/|$))/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
