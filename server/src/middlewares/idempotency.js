import { redisClient } from '../redis/client.js';
import { redisKeys } from '../redis/keys.js';
import { logger } from '../utils/logger.js';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export function idempotencyMiddleware() {
  return async (req, res, next) => {
    // Only apply to mutating requests
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return next();
    }

    const cacheKey = redisKeys.idempotency(idempotencyKey);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const payload = JSON.parse(cached);
        res.setHeader('X-Cache-Lookup', 'HIT');
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(payload.statusCode).json(payload.body);
      }

      res.setHeader('X-Cache-Lookup', 'MISS');

      // Intercept res.json to capture response body
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Cache successful or client-error outcomes (avoid caching 5xx internal crashes)
        if (res.statusCode < 500) {
          const cacheData = JSON.stringify({
            statusCode: res.statusCode,
            body
          });
          redisClient.set(cacheKey, cacheData, 'EX', IDEMPOTENCY_TTL_SECONDS).catch((err) => {
            logger.error({ err: err.message, idempotencyKey }, 'Failed to cache idempotent response');
          });
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error({ err: err.message, idempotencyKey }, 'Idempotency middleware error');
      next();
    }
  };
}
