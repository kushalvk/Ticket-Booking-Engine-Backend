/**
 * Central Redis key builder for TicketRush.
 * Enforces key naming conventions across the system.
 */
export const redisKeys = {
  /**
   * HASH: seatId -> AVAILABLE | HELD | BOOKED
   */
  showSeats: (showId) => `show:${showId}:seats`,

  /**
   * STRING: value = `${holdId}|${userId}`, TTL = HOLD_TTL_SECONDS
   */
  showSeatHold: (showId, seatId) => `show:${showId}:hold:${seatId}`,

  /**
   * HASH: userId, showId, seats(json), expiresAt, status
   */
  hold: (holdId) => `hold:${holdId}`,

  /**
   * SET: holdIds active for this user in this show
   */
  userHoldsForShow: (userId, showId) => `user:${userId}:holds:${showId}`,

  /**
   * ZSET: holdId scored by expiresAt (epoch ms or seconds) for background sweeper
   */
  showHoldsExpiry: (showId) => `show:${showId}:holds:expiry`,

  /**
   * ZSET: userId scored by join timestamp ms (waiting room queue)
   */
  showQueue: (showId) => `show:${showId}:queue`,

  /**
   * SET/ZSET: admitted userIds with TTL window for checkout access
   */
  showAdmitted: (showId) => `show:${showId}:admitted`,

  /**
   * ZSET: sliding window timestamps for rate limiting
   */
  rateLimit: (scope, id) => `ratelimit:${scope}:${id}`,

  /**
   * STRING: cached response JSON, TTL 24h
   */
  idempotency: (key) => `idem:${key}`
};
