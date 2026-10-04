import crypto from 'node:crypto';
import { redisClient } from '../redis/client.js';
import { redisKeys } from '../redis/keys.js';
import { logger } from '../utils/logger.js';

/**
 * Sliding window rate limiter middleware backed by Redis Lua script.
 * @param {object} options
 * @param {string} [options.scope='global']
 * @param {number} [options.windowMs=60000]
 * @param {number} [options.maxHits=100]
 */
export function rateLimiter({ scope = 'global', windowMs = 60000, maxHits = 100 } = {}) {
  return async (req, res, next) => {
    try {
      const identifier = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const key = redisKeys.rateLimit(scope, identifier);
      const nowMs = Date.now();
      const memberId = `${nowMs}-${crypto.randomBytes(4).toString('hex')}`;

      // Call Lua script: rate_limit(key, windowMs, maxHits, nowMs, memberId)
      const result = await redisClient.rate_limit(key, windowMs, maxHits, nowMs, memberId);
      const [allowed, remaining, resetMs] = result;

      res.setHeader('X-RateLimit-Limit', maxHits);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));

      if (allowed === 1) {
        return next();
      }

      res.setHeader('Retry-After', Math.ceil((resetMs || windowMs) / 1000));
      return res.status(429).json({
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.',
        retryAfterMs: resetMs || windowMs,
        requestId: req.id
      });
    } catch (err) {
      // In case Redis rate-limiting call fails, fail open to avoid service outage
      logger.error({ err: err.message, scope }, 'Rate limiter Redis execution error');
      next();
    }
  };
}
