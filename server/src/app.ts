import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getEnv } from './config/env';
import { logger } from './lib/logger';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { requestContextMiddleware } from './middleware/requestContext';
import { authenticate } from './middleware/authenticate';
import { apiRouter } from './modules';
import { healthRoutes } from './modules/health/health.routes';

export const API_PREFIX = '/api/v1';

export function buildApp(): Express {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind nginx in production

  app.use(requestContextMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS, // explicit allow-list; empty list = no cross-origin access
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRoutes);
  app.use(API_PREFIX, authenticate, apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
