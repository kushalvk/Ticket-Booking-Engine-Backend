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

## API Reference (GET Endpoints)

**Base URL (local):** `http://localhost:5000`
**API prefix:** `/api/v1` (the health check is the only route outside the prefix)
**Auth header:** `Authorization: Bearer <jwt>`

### Endpoint Summary

| # | Method | Path | Auth | Description |
| :-: | :--- | :--- | :---: | :--- |
| 1 | GET | `/health` | No | Service health with Mongo and Redis status and latency |
| 2 | GET | `/api/v1/auth/me` | Yes | Current logged-in user |
| 3 | GET | `/api/v1/events` | No | Paginated, filterable event list |
| 4 | GET | `/api/v1/events/:eventId` | No | Single event details |
| 5 | GET | `/api/v1/events/:eventId/shows` | No | Shows for an event, with live availability from Redis |
| 6 | GET | `/api/v1/shows/:showId` | No | Single show with venue layout and price map |
| 7 | GET | `/api/v1/shows/:showId/seats` | Yes | Live seat map grouped by row |
| 8 | GET | `/api/v1/holds/:holdId` | Yes | Hold status and remaining TTL (owner only) |
| 9 | GET | `/api/v1/bookings/me` | Yes | Bookings of the logged-in user |

### Parameters

| Endpoint | Param | Where | Description |
| :--- | :--- | :--- | :--- |
| `/events` | `q` | query | Text search on title |
| `/events` | `city` | query | Filter by venue city |
| `/events` | `category` | query | `MOVIE`, `CONCERT`, ... |
| `/events` | `page`, `limit` | query | Pagination (defaults `1`, `10`) |
| `/events/:eventId` | `eventId` | path | Event ObjectId |
| `/events/:eventId/shows` | `eventId` | path | Event ObjectId |
| `/shows/:showId` | `showId` | path | Show ObjectId |
| `/shows/:showId/seats` | `showId` | path | Show ObjectId |
| `/holds/:holdId` | `holdId` | path | Hold UUID |

### Response Envelope

```json
// success
{ "success": true, "data": { } }

// error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "...", "details": { } } }
```

### Common GET Error Codes

| HTTP | Code | When |
| :-: | :--- | :--- |
| 400 | `VALIDATION_ERROR` | Invalid ID or query params |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Hold belongs to another user |
| 404 | `NOT_FOUND` | Event, show, or hold does not exist |
| 503 | n/a | `/health` when Mongo or Redis is down |

### Examples

```bash
# Health
curl http://localhost:5000/health

# Current user
curl http://localhost:5000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"

# Browse events
curl "http://localhost:5000/api/v1/events?city=Ahmedabad&category=CONCERT&page=1&limit=10"

# Event details and its shows
curl http://localhost:5000/api/v1/events/$EVENT_ID
curl http://localhost:5000/api/v1/events/$EVENT_ID/shows

# Show details and live seat map
curl http://localhost:5000/api/v1/shows/$SHOW_ID
curl http://localhost:5000/api/v1/shows/$SHOW_ID/seats \
  -H "Authorization: Bearer $TOKEN"

# Hold status
curl http://localhost:5000/api/v1/holds/$HOLD_ID \
  -H "Authorization: Bearer $TOKEN"

# My bookings
curl http://localhost:5000/api/v1/bookings/me \
  -H "Authorization: Bearer $TOKEN"
```

### Sample Response: `GET /api/v1/shows/:showId/seats`

```json
{
  "success": true,
  "data": {
    "showId": "667b...",
    "summary": { "total": 150, "available": 141, "held": 6, "booked": 3 },
    "rows": [
      {
        "row": "A",
        "seats": [
          { "seatId": "A1", "status": "AVAILABLE", "category": "PREMIUM", "price": 2500, "mine": false },
          { "seatId": "A2", "status": "HELD",      "category": "PREMIUM", "price": 2500, "mine": true  },
          { "seatId": "A3", "status": "BOOKED",    "category": "PREMIUM", "price": 2500, "mine": false }
        ]
      }
    ]
  }
}
```

`status` is normalized: a `HELD` seat whose hold key has expired is returned as `AVAILABLE`. `mine` is `true` when the seat is held by the caller.

### Sample Response: `GET /api/v1/holds/:holdId`

```json
{
  "success": true,
  "data": {
    "holdId": "7f3c9a52-8b1e-4d6a-9c11-2a5e0f7d3b44",
    "showId": "667b...",
    "status": "ACTIVE",
    "seatIds": ["A1", "A2"],
    "totalAmount": 5000,
    "expiresAt": 1763650200000,
    "remainingSeconds": 241
  }
}
```

`status` is one of `ACTIVE`, `EXPIRED`, `RELEASED`, `CONFIRMED`.

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