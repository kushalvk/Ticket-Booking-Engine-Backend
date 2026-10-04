import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { connectMongo, disconnectMongo } from '../src/config/database.js';
import { redisClient, redisPubClient, redisSubClient } from '../src/redis/client.js';
import { redisKeys } from '../src/redis/keys.js';
import { seedDatabase } from '../src/scripts/seed.js';
import { User } from '../src/models/User.js';
import { Event } from '../src/models/Event.js';
import { Venue } from '../src/models/Venue.js';
import { Show } from '../src/models/Show.js';

describe('Auth & Catalog Integration Tests', () => {
  let adminToken = '';
  let userToken = '';
  let testEventId = '';
  let testVenueId = '';
  let flashShowId = '';

  beforeAll(async () => {
    await connectMongo();
    await redisClient.ping();

    // Run seed to ensure baseline state
    const seedResult = await seedDatabase();
    testVenueId = seedResult.venue._id.toString();
    testEventId = seedResult.events[0]._id.toString();
    flashShowId = seedResult.flashSaleShow._id.toString();

    // Login as seeded admin
    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@ticketrush.com', password: 'Test@123' });
    adminToken = adminLoginRes.body.data.token;

    // Login as seeded user1
    const userLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user1@test.com', password: 'Test@123' });
    userToken = userLoginRes.body.data.token;
  });

  afterAll(async () => {
    await disconnectMongo();
    redisClient.disconnect();
    redisPubClient.disconnect();
    redisSubClient.disconnect();
  });

  describe('Authentication Endpoints', () => {
    it('registers a new user and returns JWT token without exposing password hash', async () => {
      const email = `newuser_${Date.now()}@test.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Jane Doe',
          email,
          password: 'Password123'
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.email).toBe(email);
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.body.data.token).toBeDefined();
    });

    it('rejects duplicate email registration with 409', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Duplicate User',
          email: 'user1@test.com',
          password: 'Password123'
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('USER_EXISTS');
    });

    it('authenticates valid credentials on /login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'user2@test.com', password: 'Test@123' });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe('user2@test.com');
    });

    it('rejects invalid password on /login with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'user2@test.com', password: 'WrongPassword!' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('fetches profile on GET /me with valid JWT Bearer', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('user1@test.com');
    });

    it('rejects unauthenticated requests to /me with 401', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Catalog Endpoints & RBAC Guards', () => {
    it('lists seeded events on GET /events', async () => {
      const res = await request(app).get('/api/events');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.events)).toBe(true);
      expect(res.body.data.events.length).toBeGreaterThanOrEqual(5);
    });

    it('fetches event by ID on GET /events/:id', async () => {
      const res = await request(app).get(`/api/events/${testEventId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.event._id).toBe(testEventId);
      expect(Array.isArray(res.body.data.shows)).toBe(true);
    });

    it('fetches show metadata on GET /shows/:id', async () => {
      const res = await request(app).get(`/api/shows/${flashShowId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.show._id).toBe(flashShowId);
      expect(res.body.data.show.isFlashSale).toBe(true);
      expect(res.body.data.show.totalSeats).toBe(150);
      // Ensure metadata only (no raw seat array in payload)
      expect(res.body.data.show.seats).toBeUndefined();
    });

    it('prevents non-admin user from creating an event (403)', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          title: 'Unauthorized Event',
          category: 'Concert',
          durationMins: 120
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('allows admin to create an event (201)', async () => {
      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Dua Lipa Radical Optimism Tour',
          category: 'Concert',
          description: 'Pop spectacle with top dance-pop anthems',
          durationMins: 130
        });

      expect(res.status).toBe(201);
      expect(res.body.data.event.title).toBe('Dua Lipa Radical Optimism Tour');
    });

    it('allows admin to create an ON_SALE show and initializes Redis inventory', async () => {
      const res = await request(app)
        .post('/api/shows')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          eventId: testEventId,
          venueId: testVenueId,
          startsAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
          status: 'ON_SALE',
          priceMap: { VIP: 250, PREMIUM: 150, STANDARD: 75 }
        });

      expect(res.status).toBe(201);
      const newShowId = res.body.data.show._id;

      // Verify Redis seat map initialized for this show
      const seatsKey = redisKeys.showSeats(newShowId);
      const seatCount = await redisClient.hlen(seatsKey);
      expect(seatCount).toBe(150);

      const seatA1 = await redisClient.hget(seatsKey, 'A1');
      expect(seatA1).toBe('AVAILABLE');
    });
  });

  describe('Seeding Idempotency & Acceptance Checks', () => {
    it('running seed again does not duplicate data and preserves 150 Redis seats', async () => {
      await seedDatabase();

      const userCount = await User.countDocuments();
      expect(userCount).toBeGreaterThanOrEqual(201); // 200 test users + 1 admin + Jane Doe

      const venueCount = await Venue.countDocuments({ name: 'Grand Arena' });
      expect(venueCount).toBe(1);

      const eventCount = await Event.countDocuments();
      expect(eventCount).toBeGreaterThanOrEqual(5);

      // Verify flash sale show Redis seats count is exactly 150
      const flashShowSeatsKey = redisKeys.showSeats(flashShowId);
      const flashSeatCount = await redisClient.hlen(flashShowSeatsKey);
      expect(flashSeatCount).toBe(150);
    });
  });
});
