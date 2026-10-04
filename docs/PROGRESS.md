# TicketRush - Engineering Progress & Architectural Decisions

TicketRush is a high-concurrency flash sale and ticket booking engine designed for zero double-booking under extreme demand, utilizing Redis Lua atomic scripts, MongoDB for durable source-of-truth state, Socket.IO for real-time seat synchronization, and Express.

---

## Phase 1: Project Setup & Monorepo Scaffold
**Status:** In Progress
- **What Was Built:**
  - Monorepo folder layout: `/server`, `/client`, `/loadtest`, `/docs`.
  - Root `package.json` with npm workspaces.
  - Multi-service `docker-compose.yml` configured for Redis 7, MongoDB 7, Express API server, and Vite client.
- **Key Architectural Decisions:**
  - Pure JavaScript ESM (`"type": "module"`) without TypeScript compilation step for clean, fast runtime debugging.
  - MongoDB handles durable transactional state (events, shows, bookings, payments, users).
  - Redis 7 handles high-velocity transient state (sliding window rate-limiting, waiting queue, seat hold TTL, real-time seat map, idempotency caching).
  - Redis Lua scripts loaded via `ioredis.defineCommand` ensure atomic check-and-set operations with zero race conditions.
- **How to Run:**
  - Spin up backing services: `docker compose up -d redis mongodb`

---
