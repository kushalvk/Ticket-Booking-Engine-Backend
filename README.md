# TicketRush 🎟️⚡

> High-concurrency flash sale and ticket booking engine designed for **ZERO double-booking** under extreme load, powered by atomic Redis Lua scripts, MongoDB, Express, and Socket.IO.

---

## Architecture Overview

1. **MongoDB (Source of Truth)**: Durable records for Events, Shows, Users, Bookings, and Payments.
2. **Redis 7 / Redis Stack (Transient High-Velocity State)**:
   - Atomic seat reservation locks with TTL
   - Waiting room queue with sliding admission
   - Sliding-window rate limiting
   - 24-hour response caching for idempotent writes
   - Real-time seat map cache
3. **Atomic Lua Scripts (`/server/src/redis/lua/*.lua`)**:
   - `hold_seats.lua`: Atomically checks seat availability, marks seats as `HELD`, registers hold keys, user sets, and sweeper expiration zset. Max 6 seats per hold.
   - `release_hold.lua`: Atomically frees held seats back to `AVAILABLE` on user cancellation or timeout.
   - `confirm_booking.lua`: Atomically transitions held seats to `BOOKED` and clears hold keys.
   - `expire_holds.lua`: Background sweeper script reclaiming expired seats in batches.
   - `rate_limit.lua`: Sliding-window rate limiter per scope and client IP.
   - `queue_join.lua` & `queue_admit.lua`: High-volume waiting room queue management.
4. **Real-time Synchronization**:
   - Socket.IO with `@socket.io/redis-adapter` for multi-instance pub/sub synchronization across rooms (`show:{showId}`).

---

## Redis Key Schema

All keys are constructed via `/server/src/redis/keys.js`:

| Key Pattern | Type | Purpose / Value |
| :--- | :--- | :--- |
| `show:{showId}:seats` | HASH | `seatId` -> `AVAILABLE` \| `HELD` \| `BOOKED` |
| `show:{showId}:hold:{seatId}` | STRING | `${holdId}\|${userId}`, TTL = `HOLD_TTL_SECONDS` |
| `hold:{holdId}` | HASH | `userId`, `showId`, `seats` (json), `expiresAt`, `status` |
| `user:{userId}:holds:{showId}` | SET | Active `holdId`s for the user |
| `show:{showId}:holds:expiry` | ZSET | `holdId` scored by `expiresAt` (ms) for sweeper |
| `show:{showId}:queue` | ZSET | `userId` scored by join timestamp |
| `show:{showId}:admitted` | ZSET | Admitted `userId`s with expiration window |
| `ratelimit:{scope}:{id}` | ZSET | Sliding-window request timestamps |
| `idem:{key}` | STRING | Cached response JSON, TTL 24h |

---

## Prerequisites

- **Node.js**: v20 or higher
- **Docker & Docker Compose**: v2+
- **npm**: v10+

---

## Quickstart (Docker Compose)

Start the entire stack (Redis Stack, MongoDB 7, and the hot-reloading Express server) with one command:

```bash
docker compose up --build -d
```

Check the health status of all backing services:

```bash
curl http://localhost:5000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-10-04T18:25:00.000Z",
  "uptimeSeconds": 12,
  "services": {
    "redis": {
      "status": "up",
      "latencyMs": 0.45
    },
    "mongo": {
      "status": "up",
      "latencyMs": 1.2
    }
  }
}
```

Stop services:
```bash
docker compose down
```

---

## Local Development (Without Docker Compose)

1. Start Redis and MongoDB locally or via Docker:
   ```bash
   docker compose up -d redis mongodb
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment:
   ```bash
   cp server/.env.example server/.env
   ```

4. Run server in development mode (with nodemon hot-reload):
   ```bash
   npm run dev:server
   ```

5. Run test suite:
   ```bash
   npm run test:server
   ```

6. Run linter and formatting:
   ```bash
   npm run lint
   npm --prefix server run format
   ```

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `5000` | HTTP port for Express server |
| `NODE_ENV` | `development` | Runtime environment (`development`, `production`, `test`) |
| `MONGO_URI` | `mongodb://localhost:27017/ticketrush` | MongoDB connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `JWT_SECRET` | `32+ character string` | Secret key for JWT authentication |
| `HOLD_TTL_SECONDS` | `300` | Seat hold duration (5 minutes) |
| `MAX_SEATS_PER_HOLD`| `6` | Maximum seats allowable in a single hold request |
| `QUEUE_ADMIT_RATE` | `50` | Users admitted per batch from waiting room |
| `QUEUE_ADMIT_WINDOW_SECONDS` | `5` | Batch admission interval |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |

---

## Testing & Verification

Run the automated test suite with Vitest:
```bash
npm --prefix server test
```
