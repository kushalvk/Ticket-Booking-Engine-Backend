import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { connectMongo, disconnectMongo } from '../src/config/database.js';
import { redisClient, redisPubClient, redisSubClient } from '../src/redis/client.js';
import { redisKeys } from '../src/redis/keys.js';
import { seedDatabase } from '../src/scripts/seed.js';
import { SeatService } from '../src/services/seatService.js';
import { signToken } from '../src/utils/jwt.js';

describe('Core Seat-Hold Engine & Concurrency Invariants', () => {
  let user1Token;
  let user2Token;
  let user1Id = '6ac29ba330b10fc753762b8c'; // user1 from seed
  let user2Id = '6ac29ba330b10fc753762b8d'; // user2 from seed
  let flashShowId;

  beforeAll(async () => {
    await connectMongo();
    await redisClient.ping();

    const seedResult = await seedDatabase();
    flashShowId = seedResult.flashSaleShow._id.toString();

    user1Token = signToken({ userId: user1Id, email: 'user1@test.com', role: 'user' });
    user2Token = signToken({ userId: user2Id, email: 'user2@test.com', role: 'user' });
  });

  afterAll(async () => {
    await disconnectMongo();
    redisClient.disconnect();
    redisPubClient.disconnect();
    redisSubClient.disconnect();
  });

  beforeEach(async () => {
    // Re-initialize 150 seats for flash show before each test
    const seatsKey = redisKeys.showSeats(flashShowId);
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const pipeline = redisClient.pipeline();
    pipeline.del(seatsKey);
    pipeline.del(redisKeys.showHoldsExpiry(flashShowId));
    pipeline.del(redisKeys.userHoldsForShow(user1Id, flashShowId));
    pipeline.del(redisKeys.userHoldsForShow(user2Id, flashShowId));

    for (const row of rows) {
      for (let n = 1; n <= 15; n++) {
        const seatId = `${row}${n}`;
        pipeline.hset(seatsKey, seatId, 'AVAILABLE');
        pipeline.del(redisKeys.showSeatHold(flashShowId, seatId));
      }
    }
    await pipeline.exec();
  });

  it('single hold succeeds and second user hold on the same seat fails (409)', async () => {
    // User 1 holds A1
    const res1 = await request(app)
      .post(`/shows/${flashShowId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: ['A1'] });

    expect(res1.status).toBe(201);
    expect(res1.body.status).toBe('success');
    expect(res1.body.data.holdId).toBeDefined();
    expect(res1.body.data.seats).toEqual(['A1']);

    // Verify Redis seat status
    const status = await redisClient.hget(redisKeys.showSeats(flashShowId), 'A1');
    expect(status).toBe('HELD');

    // User 2 attempts to hold the same seat A1
    const res2 = await request(app)
      .post(`/shows/${flashShowId}/holds`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ seatIds: ['A1'] });

    expect(res2.status).toBe(409);
    expect(res2.body.code).toBe('SEAT_UNAVAILABLE');
    expect(res2.body.details.unavailableSeats).toEqual(['A1']);
  });

  it('all-or-nothing: requesting [A1, A2] where A2 is taken leaves A1 AVAILABLE', async () => {
    // User 1 holds A2
    const res1 = await request(app)
      .post(`/shows/${flashShowId}/holds`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ seatIds: ['A2'] });
    expect(res1.status).toBe(201);

    // User 2 requests [A1, A2]
    const res2 = await request(app)
      .post(`/shows/${flashShowId}/holds`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ seatIds: ['A1', 'A2'] });

    expect(res2.status).toBe(409);
    expect(res2.body.code).toBe('SEAT_UNAVAILABLE');
    expect(res2.body.details.unavailableSeats).toEqual(['A2']);

    // Crucial check: A1 MUST still be AVAILABLE (not partially held)
    const a1Status = await redisClient.hget(redisKeys.showSeats(flashShowId), 'A1');
    expect(a1Status).toBe('AVAILABLE');

    const a2Status = await redisClient.hget(redisKeys.showSeats(flashShowId), 'A2');
    expect(a2Status).toBe('HELD');
  });

  it('200 concurrent Promise.all hold attempts on the SAME seat -> exactly 1 success', async () => {
    const seatTarget = 'B5';
    const concurrentRequests = 200;

    // Fire 200 concurrent hold requests simultaneously for the exact same seat
    const promises = Array.from({ length: concurrentRequests }, (_, i) => {
      const uId = `user_${i}`;
      return SeatService.holdSeats({
        userId: uId,
        showId: flashShowId,
        seatIds: [seatTarget]
      }).then(
        (data) => ({ success: true, data }),
        (err) => ({ success: false, code: err.code })
      );
    });

    const results = await Promise.all(promises);

    const successes = results.filter((r) => r.success);
    const conflicts = results.filter((r) => !r.success && r.code === 'SEAT_UNAVAILABLE');

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(199);

    // Verify seat is HELD in Redis
    const seatStatus = await redisClient.hget(redisKeys.showSeats(flashShowId), seatTarget);
    expect(seatStatus).toBe('HELD');
  });

  it('200 concurrent attempts spread over 150 seats -> no seat held twice', async () => {
    // Generate pool of 150 seat names A1-J15
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const allSeatIds = [];
    for (const r of rows) {
      for (let n = 1; n <= 15; n++) {
        allSeatIds.push(`${r}${n}`);
      }
    }

    // 200 users attempt to hold 2 random seats each
    const requests = Array.from({ length: 200 }, (_, i) => {
      const uId = `stress_user_${i}`;
      // Pick 2 seats randomly
      const idx1 = Math.floor(Math.random() * allSeatIds.length);
      let idx2 = (idx1 + 1 + Math.floor(Math.random() * 5)) % allSeatIds.length;
      const chosenSeats = [allSeatIds[idx1], allSeatIds[idx2]];

      return SeatService.holdSeats({
        userId: uId,
        showId: flashShowId,
        seatIds: chosenSeats
      }).then(
        (res) => ({ success: true, seats: res.seats }),
        (err) => ({ success: false, err: err.code })
      );
    });

    const outcomes = await Promise.all(requests);
    const successfulHolds = outcomes.filter((o) => o.success);

    // Verify NO seat was given to more than 1 hold
    const heldSeatsSet = new Set();
    for (const hold of successfulHolds) {
      for (const seat of hold.seats) {
        expect(heldSeatsSet.has(seat)).toBe(false);
        heldSeatsSet.add(seat);
      }
    }

    // Verify total seats consistency in Redis seat map
    const seatMap = await SeatService.getSeatMap(flashShowId);
    expect(seatMap.counts.total).toBe(150);
    expect(seatMap.counts.held).toBe(heldSeatsSet.size);
    expect(seatMap.counts.available + seatMap.counts.held).toBe(150);
  });

  it('hold key TTL expiry makes the seat reservable again', async () => {
    const seatId = 'C3';
    const shortTtlSeconds = 1;
    const holdId = 'test-short-ttl-hold';
    const nowMs = Date.now();

    const seatsHash = redisKeys.showSeats(flashShowId);
    const expiryZset = redisKeys.showHoldsExpiry(flashShowId);
    const holdHash = redisKeys.hold(holdId);
    const userHoldsSet = redisKeys.userHoldsForShow(user1Id, flashShowId);
    const seatHoldKey = redisKeys.showSeatHold(flashShowId, seatId);

    // Place a hold with 1-second TTL directly using Lua script
    const keys = [seatsHash, expiryZset, holdHash, userHoldsSet, seatHoldKey];
    await redisClient.hold_seats(
      keys.length,
      ...keys,
      flashShowId,
      user1Id,
      holdId,
      shortTtlSeconds,
      nowMs,
      6,
      seatId
    );

    // Confirm it is held
    expect(await redisClient.hget(seatsHash, seatId)).toBe('HELD');

    // Wait 1200ms for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Release via sweeper / expire logic
    const [_expiredIds, releasedJson] = await redisClient.expire_holds(
      seatsHash,
      expiryZset,
      flashShowId,
      Date.now(),
      10
    );
    const released = JSON.parse(releasedJson || '[]');
    expect(released).toContain(seatId);

    // Now seat C3 should be AVAILABLE again
    expect(await redisClient.hget(seatsHash, seatId)).toBe('AVAILABLE');

    // User 2 can now hold seat C3 successfully
    const holdRes2 = await SeatService.holdSeats({
      userId: user2Id,
      showId: flashShowId,
      seatIds: [seatId]
    });
    expect(holdRes2.seats).toEqual([seatId]);
  });

  it('release by a non-owner is rejected with 403 FORBIDDEN', async () => {
    // User 1 creates hold
    const hold = await SeatService.holdSeats({
      userId: user1Id,
      showId: flashShowId,
      seatIds: ['D1', 'D2']
    });

    // User 2 attempts to release User 1's hold
    const res = await request(app)
      .delete(`/holds/${hold.holdId}`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');

    // Verify seats are still HELD
    expect(await redisClient.hget(redisKeys.showSeats(flashShowId), 'D1')).toBe('HELD');

    // User 1 releases the hold successfully
    const user1Release = await request(app)
      .delete(`/holds/${hold.holdId}`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(user1Release.status).toBe(200);
    expect(user1Release.body.data.status).toBe('RELEASED');
    expect(user1Release.body.data.releasedSeats).toEqual(['D1', 'D2']);

    // Seats are now AVAILABLE
    expect(await redisClient.hget(redisKeys.showSeats(flashShowId), 'D1')).toBe('AVAILABLE');
    expect(await redisClient.hget(redisKeys.showSeats(flashShowId), 'D2')).toBe('AVAILABLE');
  });

  it('fetches live seat map on GET /shows/:id/seats', async () => {
    const res = await request(app)
      .get(`/shows/${flashShowId}/seats`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.showId).toBe(flashShowId);
    expect(res.body.data.counts.total).toBe(150);
    expect(res.body.data.rows.A.length).toBe(15);
  });

  it('fetches hold details on GET /holds/:id', async () => {
    const hold = await SeatService.holdSeats({
      userId: user1Id,
      showId: flashShowId,
      seatIds: ['E1']
    });

    const res = await request(app)
      .get(`/holds/${hold.holdId}`)
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.holdId).toBe(hold.holdId);
    expect(res.body.data.seats).toEqual(['E1']);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.remainingSeconds).toBeGreaterThan(0);
  });
});
