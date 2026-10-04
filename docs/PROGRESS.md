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
    - `POST /api/auth/register` (creates user, validates input, returns JWT).
    - `POST /api/auth/login` (verifies credentials, returns JWT).
    - `GET /api/auth/me` (returns user profile excluding password hash).
  - **Catalog APIs & RBAC Guards**:
    - `GET /api/events` (returns all active events).
    - `GET /api/events/:id` (returns event details and scheduled shows).
    - `GET /api/shows/:id` (returns show metadata only, omitting seat details).
    - `POST /api/events` (admin-only event creation).
    - `POST /api/shows` (admin-only show creation; auto-triggers inventory initialization if `ON_SALE`).
  - **Idempotent Redis Seat Map Initialization**:
    - `CatalogService.initShowInventory(showId)`: Uses Redis `HSETNX` via pipeline to populate `show:{showId}:seats` with `AVAILABLE` for every seat in the venue without overwriting existing held/booked seats.
  - **Database Seeder (`npm run seed`)**:
    - 1 Venue: "Grand Arena", Mumbai (10 rows A-J × 15 seats = 150 seats, categories: VIP, PREMIUM, STANDARD).
    - 5 Events: Concerts, Movies, Comedy shows.
    - 10 Shows: 9 regular shows + 1 Flash Sale show with `isFlashSale: true`, `status: 'ON_SALE'`, and 150 seats.
    - 200 Test Users: `user1@test.com` to `user200@test.com` + 1 Admin `admin@ticketrush.com` (password: `Test@123`).
    - Fully idempotent: Running seed multiple times does not duplicate records and guarantees exactly 150 fields in `show:{id}:seats`.

- **How to Run & Verify:**
  ```bash
  # Run database seed
  npm --prefix server run seed

  # Run all test suites (Smoke, Auth, Catalog, RBAC, Idempotency)
  npm --prefix server test

  # Run linter
  npm --prefix server run lint
  ```
