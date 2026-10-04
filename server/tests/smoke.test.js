import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { config } from '../src/config/index.js';
import { redisKeys } from '../src/redis/keys.js';
import { redisClient, redisPubClient, redisSubClient } from '../src/redis/client.js';
import { connectMongo, disconnectMongo } from '../src/config/database.js';

describe('TicketRush Smoke Tests', () => {
  beforeAll(async () => {
    await connectMongo();
    await redisClient.ping();
  });

  afterAll(async () => {
    await disconnectMongo();
    redisClient.disconnect();
    redisPubClient.disconnect();
    redisSubClient.disconnect();
  });

  it('validates config parameters properly', () => {
    expect(config.PORT).toBeDefined();
    expect(config.HOLD_TTL_SECONDS).toBe(300);
    expect(config.MAX_SEATS_PER_HOLD).toBe(6);
  });

  it('builds canonical Redis keys according to architecture schema', () => {
    expect(redisKeys.showSeats('show123')).toBe('show:show123:seats');
    expect(redisKeys.showSeatHold('show123', 'A1')).toBe('show:show123:hold:A1');
    expect(redisKeys.hold('hold123')).toBe('hold:hold123');
    expect(redisKeys.userHoldsForShow('user1', 'show123')).toBe('user:user1:holds:show123');
    expect(redisKeys.showHoldsExpiry('show123')).toBe('show:show123:holds:expiry');
    expect(redisKeys.showQueue('show123')).toBe('show:show123:queue');
    expect(redisKeys.showAdmitted('show123')).toBe('show:show123:admitted');
    expect(redisKeys.rateLimit('hold', 'ip123')).toBe('ratelimit:hold:ip123');
    expect(redisKeys.idempotency('idemp-key-1')).toBe('idem:idemp-key-1');
  });

  it('GET /health returns 200 with both Mongo and Redis UP and latency reported', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.redis.status).toBe('up');
    expect(typeof res.body.services.redis.latencyMs).toBe('number');
    expect(res.body.services.mongo.status).toBe('up');
    expect(typeof res.body.services.mongo.latencyMs).toBe('number');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('returns 404 structured error for unknown route', async () => {
    const res = await request(app).get('/api/unknown-endpoint');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBeDefined();
  });
});
