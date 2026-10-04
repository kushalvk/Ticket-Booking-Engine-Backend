# TicketRush - Engineering Progress & Architectural Decisions

TicketRush is a high-concurrency flash sale and ticket booking engine designed for **ZERO double-booking** under extreme demand, utilizing Redis Lua atomic scripts, MongoDB for durable source-of-truth state, Socket.IO for real-time seat synchronization, and Express.

---

## Phase 1: Project Setup & Monorepo Scaffold
**Status:** Completed
- **What Was Built:**
  - Monorepo folder layout: `/server`, `/client`, `/loadtest`, `/docs`.
  - Root `package.json` with npm workspaces and script orchestrations.
  - Multi-service `docker-compose.yml` configured for `redis/redis-stack-server`, `mongo:7`, and the nodemon hot-reloading Express API server with healthchecks.
  - `.env.example` templates and centralized Zod environment validation (`PORT`, `MONGO_URI`, `REDIS_URL`, `JWT_SECRET`, `HOLD_TTL_SECONDS=300`, `MAX_SEATS_PER_HOLD=6`, `QUEUE_ADMIT_RATE`, `QUEUE_ADMIT_WINDOW_SECONDS`).
  - Redis connection module (`src/redis/client.js`) exporting primary client and pub/sub duplicate instances with retry strategy, connection logging, and automatic Lua script loader.
  - Redis canonical keys builder (`src/redis/keys.js`) adhering strictly to schema rules.
  - Core middlewares: `requestId`, `httpLogger` (Pino), `helmet`, `cors`, `validate` (Zod), `notFound`, `errorHandler`, `rateLimiter` (sliding-window Lua), and `idempotency` (24-hour response caching).
  - Health check endpoint `GET /health` measuring Redis and MongoDB ping latencies.
  - Vitest + Supertest smoke test suite passing.

---

## Phase 2: MongoDB Domain Models, Auth & Catalog APIs
**Status:** Completed
- **What Was Built:**
  - **Mongoose Domain Models**:
    - `User`: `name`, `email` (unique index), `passwordHash`, `role` (`user`|`admin`), `comparePassword()`, `hashPassword()`.
    - `Venue`: `name` (unique), `city`, `layout: { rows, seatsPerRow, categories: [{ name, rows, basePrice }] }`.
    - `Event`: `title`, `description`, `category`, `posterUrl`, `durationMins`.
    - `Show`: `eventId`, `venueId`, `startsAt`, `status` (`SCHEDULED`|`ON_SALE`|`SOLD_OUT`|`CLOSED`), `saleStartsAt`, `priceMap`, `isFlashSale`, `totalSeats`.
    - `Booking`: `userId`, `showId`, `seats: [{ seatId, price }]`, `totalAmount`, `status` (`CONFIRMED`|`CANCELLED`|`REFUNDED`), `paymentId`, `holdId`, `idempotencyKey`, `createdAt`.
    - **Database Safety Net**: Added unique compound partial index on `{ showId: 1, 'seats.seatId': 1 }` for `status: 'CONFIRMED'` in `Booking` model to provide unbreakable database-level prevention of double-booking.
    - `Payment`: `bookingId`, `holdId`, `userId`, `amount`, `status`, `provider='mock'`, `providerRef`.
  - **Authentication System**:
    - `bcryptjs` password hashing with salt rounds 10.
    - JWT signing and verification (`config.JWT_SECRET`).
    - `authenticate` and `requireRole` RBAC middlewares.
    - `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
  - **Catalog APIs & RBAC Guards**:
    - `GET /api/events`, `GET /api/events/:id`, `GET /api/shows/:id` (metadata only), `POST /api/events` (admin), `POST /api/shows` (admin; auto-triggers inventory initialization if `ON_SALE`).
  - **Idempotent Redis Seat Map Initialization**:
    - `CatalogService.initShowInventory(showId)`: Uses Redis `HSETNX` via pipeline to populate `show:{showId}:seats` with `AVAILABLE` for every seat in the venue without overwriting existing held/booked seats.
  - **Database Seeder (`npm run seed`)**:
    - 1 Venue (150 seats), 5 Events, 10 Shows (including 1 flash sale show with 150 Redis seats), 200 Test Users + 1 Admin.
    - Fully idempotent: running seed multiple times does not duplicate records.

---

## Phase 3: Core Seat-Hold Engine & Concurrency Verification
**Status:** Completed
- **What Was Built:**
  - **Atomic Lua Scripts**:
    - `hold_seats.lua`: Atomically checks seat limit (active holds + new <= maxSeats), verifies all requested seats are `AVAILABLE` (all-or-nothing), sets seats to `HELD`, creates `hold:{holdId}` with status `ACTIVE`, adds to `user:{userId}:holds:{showId}`, and scores into `show:{showId}:holds:expiry`.
    - `release_hold.lua`: Validates hold ownership and `ACTIVE` status, checks that seat hold keys belong to this hold, reverts seats to `AVAILABLE`, deletes hold keys, marks hold `RELEASED`, and cleans up tracking ZSET/SET.
    - `confirm_hold.lua`: Validates hold is `ACTIVE`, owned by user, and unexpired; transitions seats to `BOOKED`, deletes hold keys, marks hold `CONFIRMED`, and removes from expiry tracking.
  - **SeatService (`src/services/seatService.js`)**:
    - `getSeatMap(showId)`: Live seat map grouped by row (A-J) with status counts (`total`, `available`, `held`, `booked`).
    - `holdSeats({ userId, showId, seatIds })`: Dynamic key atomic execution, max seat validation, typed error mapping (409 `SEAT_UNAVAILABLE`, 400 `TOO_MANY_SEATS`).
    - `releaseHold({ userId, holdId })`: Ownership check, atomic seat release, Socket.IO notification.
    - `getHold({ userId, holdId })`: Active hold inspection with real-time remaining TTL calculation (410 `HOLD_EXPIRED` on timeout).
    - `confirmHold({ userId, holdId, bookingId })`: Atomic checkout transition to `BOOKED`.
  - **REST Endpoints**:
    - `GET /shows/:id/seats` (and `/api/shows/:id/seats`)
    - `POST /shows/:id/holds` (and `/api/shows/:id/holds`)
    - `DELETE /holds/:id` (and `/api/holds/:id`)
    - `GET /holds/:id` (and `/api/holds/:id`)
  - **Formal Concurrency Specifications**:
    - Authored `/docs/CONCURRENCY.md` documenting the 5 core concurrency invariants, sequence diagrams, and mathematical single-occupancy guarantees.
  - **High-Concurrency Benchmarking**:
    - Verified hot-seat contention: 200 concurrent requests for the exact same seat -> exactly 1 winner, 199 conflicts.
    - Verified mass contention: 200 concurrent requests across 150 seats -> 0 double-bookings.
    - Verified all-or-nothing atomicity and hold TTL expiry.
    - Passed **20 consecutive test runs** with 100% success rate.
