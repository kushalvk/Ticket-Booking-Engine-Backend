# TicketRush - Monorepo Guide & Architecture Standards

## Overview
TicketRush is a high-concurrency flash sale and ticket booking engine designed to guarantee ZERO double-booking using atomic Redis Lua scripts, MongoDB for persistent state, and Socket.IO for real-time seat synchronization.

## Monorepo Layout
- `/server`: Node.js (v20+, ESM, Express, Mongoose, ioredis, Socket.IO)
- `/client`: React + Vite frontend
- `/loadtest`: k6 load testing scripts
- `/docs`: Progress logs and architectural decision records (`/docs/PROGRESS.md`)

## Core Architecture Rules
1. **Source of Truth**:
   - MongoDB: Events, Shows, Users, Bookings, Payments.
   - Redis: Transient state only (Seat holds, waiting room queue, rate limits, idempotency keys, live seat map).
2. **Atomic Redis Operations**:
   - All multi-step Redis mutations must be Lua scripts in `/server/src/redis/lua/*.lua`, registered via `defineCommand`.
   - Never perform read-then-write logic in Node.js for concurrency-critical paths.
3. **Redis Key Schema (Single Source: `src/redis/keys.js`)**:
   - `show:{showId}:seats` -> HASH: `seatId -> AVAILABLE|HELD|BOOKED`
   - `show:{showId}:hold:{seatId}` -> STRING: `holdId|userId`, TTL = `HOLD_TTL_SECONDS`
   - `hold:{holdId}` -> HASH: `userId, showId, seats(json), expiresAt, status`
   - `user:{userId}:holds:{showId}` -> SET: `holdIds`
   - `show:{showId}:holds:expiry` -> ZSET: `holdId` scored by `expiresAt`
   - `show:{showId}:queue` -> ZSET: `userId` scored by join timestamp
   - `show:{showId}:admitted` -> SET/ZSET: admitted users with TTL window
   - `ratelimit:{scope}:{id}` -> ZSET: sliding window timestamps
   - `idem:{key}` -> STRING: cached response JSON, TTL 24h
4. **Hold Policy**:
   - Max 6 seats per hold.
   - Seat hold TTL: 300s (configurable via `HOLD_TTL_SECONDS`).
5. **Idempotency**:
   - Every write endpoint supports `Idempotency-Key` header with 24-hour response caching.
6. **Code Layering**:
   - `routes` -> `controllers` -> `services` -> `repositories` / `redis`.
   - Controllers must never contain business logic.
7. **Observability**:
   - Pino structured logging, Pino HTTP middleware, central error handling, Zod input validation.

## Key Commands
- `npm run dev:server` - Starts Express server in dev mode with nodemon
- `npm run test:server` - Runs Vitest tests
- `docker compose up -d` - Starts Redis Stack, MongoDB, and app containers
