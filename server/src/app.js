import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/index.js';
import { requestIdMiddleware } from './middlewares/requestId.js';
import { httpLogger } from './middlewares/httpLogger.js';
import { idempotencyMiddleware } from './middlewares/idempotency.js';
import { notFoundMiddleware } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { eventsRouter, showsRouter } from './routes/catalog.js';

export function createApp() {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id']
    })
  );

  // Request tracing & correlation
  app.use(requestIdMiddleware);

  // Structured HTTP access logging
  app.use(httpLogger);

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Idempotency support for write endpoints
  app.use(idempotencyMiddleware());

  // Core endpoints
  app.use('/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/shows', showsRouter);

  // 404 handler
  app.use(notFoundMiddleware);

  // Central error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
