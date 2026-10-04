import { Router } from 'express';
import mongoose from 'mongoose';
import { redisClient } from '../redis/client.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    services: {
      redis: { status: 'down', latencyMs: null },
      mongo: { status: 'down', latencyMs: null }
    }
  };

  let allUp = true;

  // Check Redis
  try {
    const startRedis = performance.now();
    const reply = await redisClient.ping();
    const redisLatency = Math.round((performance.now() - startRedis) * 100) / 100;
    if (reply === 'PONG') {
      health.services.redis = { status: 'up', latencyMs: redisLatency };
    } else {
      allUp = false;
      health.services.redis = { status: 'down', error: `Unexpected reply: ${reply}` };
    }
  } catch (err) {
    allUp = false;
    health.services.redis = { status: 'down', error: err.message };
  }

  // Check Mongo
  try {
    const startMongo = performance.now();
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
      const mongoLatency = Math.round((performance.now() - startMongo) * 100) / 100;
      health.services.mongo = { status: 'up', latencyMs: mongoLatency };
    } else {
      allUp = false;
      health.services.mongo = {
        status: 'down',
        error: `Mongoose connection state: ${mongoose.connection.readyState}`
      };
    }
  } catch (err) {
    allUp = false;
    health.services.mongo = { status: 'down', error: err.message };
  }

  health.status = allUp ? 'ok' : 'degraded';
  const statusCode = allUp ? 200 : 503;
  return res.status(statusCode).json(health);
});
