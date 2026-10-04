import crypto from 'node:crypto';
import { redisClient } from '../redis/client.js';
import { redisKeys } from '../redis/keys.js';
import { config } from '../config/index.js';
import { emitSeatUpdates } from '../sockets/emitter.js';

export class SeatService {
  /**
   * Retrieves live seat map for a show from Redis, grouped by row with status counts.
   * @param {string} showId
   */
  static async getSeatMap(showId) {
    const seatsKey = redisKeys.showSeats(showId);
    const rawSeats = await redisClient.hgetall(seatsKey);

    const counts = {
      total: 0,
      available: 0,
      held: 0,
      booked: 0
    };

    const rowMap = {};

    for (const [seatId, status] of Object.entries(rawSeats)) {
      counts.total++;
      if (status === 'AVAILABLE') counts.available++;
      else if (status === 'HELD') counts.held++;
      else if (status === 'BOOKED') counts.booked++;

      // Extract row (leading alphabetical characters) and seat number
      const match = seatId.match(/^([A-Za-z]+)(\d+)$/);
      const row = match ? match[1].toUpperCase() : 'GENERAL';
      const number = match ? parseInt(match[2], 10) : 0;

      if (!rowMap[row]) {
        rowMap[row] = [];
      }

      rowMap[row].push({
        seatId,
        row,
        number,
        status
      });
    }

    // Sort rows alphabetically and seats by number
    const sortedRows = {};
    const sortedRowKeys = Object.keys(rowMap).sort();

    for (const rowKey of sortedRowKeys) {
      sortedRows[rowKey] = rowMap[rowKey].sort((a, b) => a.number - b.number);
    }

    return {
      showId,
      counts,
      rows: sortedRows
    };
  }

  /**
   * Atomically holds seats for a user using hold_seats Lua script.
   * Enforces max seats per hold, active user quota, and all-or-nothing seat availability.
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.showId
   * @param {string[]} params.seatIds
   */
  static async holdSeats({ userId, showId, seatIds }) {
    if (!Array.isArray(seatIds) || seatIds.length === 0) {
      const error = new Error('At least one seat must be specified');
      error.statusCode = 400;
      error.code = 'INVALID_SEATS';
      throw error;
    }

    // Deduplicate requested seatIds
    const uniqueSeatIds = [...new Set(seatIds)];

    if (uniqueSeatIds.length > config.MAX_SEATS_PER_HOLD) {
      const error = new Error(`Cannot hold more than ${config.MAX_SEATS_PER_HOLD} seats`);
      error.statusCode = 400;
      error.code = 'TOO_MANY_SEATS';
      error.details = { requested: uniqueSeatIds.length, max: config.MAX_SEATS_PER_HOLD };
      throw error;
    }

    const holdId = crypto.randomUUID();
    const nowMs = Date.now();

    // Construct dynamic keys for hold_seats.lua
    const seatsHash = redisKeys.showSeats(showId);
    const expiryZset = redisKeys.showHoldsExpiry(showId);
    const holdHash = redisKeys.hold(holdId);
    const userHoldsSet = redisKeys.userHoldsForShow(userId, showId);

    const seatHoldKeys = uniqueSeatIds.map((seatId) => redisKeys.showSeatHold(showId, seatId));
    const allKeys = [seatsHash, expiryZset, holdHash, userHoldsSet, ...seatHoldKeys];

    // Execute atomic Lua script
    const rawResult = await redisClient.hold_seats(
      allKeys.length,
      ...allKeys,
      showId,
      userId,
      holdId,
      config.HOLD_TTL_SECONDS,
      nowMs,
      config.MAX_SEATS_PER_HOLD,
      ...uniqueSeatIds
    );

    const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;

    if (!result.ok) {
      if (result.err === 'SEAT_UNAVAILABLE') {
        const error = new Error('One or more selected seats are no longer available');
        error.statusCode = 409;
        error.code = 'SEAT_UNAVAILABLE';
        error.details = { unavailableSeats: result.seats };
        throw error;
      }

      if (result.err === 'TOO_MANY_SEATS') {
        const error = new Error(
          `User hold limit exceeded (max ${config.MAX_SEATS_PER_HOLD} active seats allowed)`
        );
        error.statusCode = 400;
        error.code = 'TOO_MANY_SEATS';
        error.details = {
          current: result.current,
          requested: result.requested,
          max: result.max
        };
        throw error;
      }

      const error = new Error(result.message || 'Seat hold request failed');
      error.statusCode = 400;
      error.code = result.err || 'HOLD_FAILED';
      throw error;
    }

    // Broadcast real-time seat update via Socket.IO
    emitSeatUpdates(
      showId,
      uniqueSeatIds.map((seatId) => ({ seatId, status: 'HELD', userId }))
    );

    return {
      holdId: result.holdId,
      showId,
      userId,
      seats: result.seats,
      expiresAt: result.expiresAt,
      ttlSeconds: config.HOLD_TTL_SECONDS
    };
  }

  /**
   * Releases an active seat hold owned by the user.
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.holdId
   */
  static async releaseHold({ userId, holdId }) {
    const holdHash = redisKeys.hold(holdId);
    const holdData = await redisClient.hgetall(holdHash);

    if (!holdData || !holdData.status) {
      const error = new Error('Hold not found or has already expired');
      error.statusCode = 404;
      error.code = 'HOLD_NOT_FOUND';
      throw error;
    }

    if (holdData.userId !== userId) {
      const error = new Error('You do not have permission to release this hold');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    if (holdData.status !== 'ACTIVE') {
      const error = new Error(`Hold is already ${holdData.status.toLowerCase()}`);
      error.statusCode = 400;
      error.code = 'HOLD_NOT_ACTIVE';
      throw error;
    }

    const showId = holdData.showId;
    const seatsHash = redisKeys.showSeats(showId);
    const expiryZset = redisKeys.showHoldsExpiry(showId);
    const userHoldsSet = redisKeys.userHoldsForShow(userId, showId);

    const rawResult = await redisClient.release_hold(
      holdHash,
      seatsHash,
      expiryZset,
      userHoldsSet,
      holdId,
      userId,
      showId
    );

    const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;

    if (!result.ok) {
      const error = new Error(result.message || 'Failed to release hold');
      error.statusCode = result.err === 'FORBIDDEN' ? 403 : 400;
      error.code = result.err || 'RELEASE_FAILED';
      throw error;
    }

    // Broadcast seats back to AVAILABLE via Socket.IO
    if (result.releasedSeats && result.releasedSeats.length > 0) {
      emitSeatUpdates(
        showId,
        result.releasedSeats.map((seatId) => ({ seatId, status: 'AVAILABLE' }))
      );
    }

    return {
      holdId,
      status: 'RELEASED',
      releasedSeats: result.releasedSeats
    };
  }

  /**
   * Retrieves active hold details including remaining TTL in seconds.
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.holdId
   */
  static async getHold({ userId, holdId }) {
    const holdHash = redisKeys.hold(holdId);
    const holdData = await redisClient.hgetall(holdHash);

    if (!holdData || !holdData.status) {
      const error = new Error('Hold not found');
      error.statusCode = 404;
      error.code = 'HOLD_NOT_FOUND';
      throw error;
    }

    if (holdData.userId !== userId) {
      const error = new Error('You do not have permission to view this hold');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const now = Date.now();
    const expiresAt = Number(holdData.expiresAt);
    const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));

    if (remainingSeconds === 0 && holdData.status === 'ACTIVE') {
      const error = new Error('Hold has expired');
      error.statusCode = 410;
      error.code = 'HOLD_EXPIRED';
      throw error;
    }

    return {
      holdId,
      showId: holdData.showId,
      userId: holdData.userId,
      seats: JSON.parse(holdData.seats || '[]'),
      status: holdData.status,
      expiresAt,
      remainingSeconds
    };
  }

  /**
   * Confirms a hold and atomically transitions seats to BOOKED.
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.holdId
   * @param {string} [params.bookingId]
   */
  static async confirmHold({ userId, holdId, bookingId = '' }) {
    const holdHash = redisKeys.hold(holdId);
    const holdData = await redisClient.hgetall(holdHash);

    if (!holdData || !holdData.status) {
      const error = new Error('Hold not found or expired');
      error.statusCode = 404;
      error.code = 'HOLD_NOT_FOUND';
      throw error;
    }

    if (holdData.userId !== userId) {
      const error = new Error('You do not have permission to confirm this hold');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const showId = holdData.showId;
    const seatsHash = redisKeys.showSeats(showId);
    const expiryZset = redisKeys.showHoldsExpiry(showId);
    const userHoldsSet = redisKeys.userHoldsForShow(userId, showId);

    const rawResult = await redisClient.confirm_hold(
      holdHash,
      seatsHash,
      expiryZset,
      userHoldsSet,
      holdId,
      userId,
      showId,
      Date.now(),
      bookingId
    );

    const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;

    if (!result.ok) {
      const error = new Error(result.message || 'Failed to confirm hold');
      error.statusCode =
        result.err === 'HOLD_EXPIRED' ? 410 : result.err === 'FORBIDDEN' ? 403 : 400;
      error.code = result.err || 'CONFIRM_FAILED';
      throw error;
    }

    // Broadcast seats BOOKED to all connected clients
    emitSeatUpdates(
      showId,
      result.seats.map((seatId) => ({ seatId, status: 'BOOKED' }))
    );

    return {
      holdId,
      status: 'CONFIRMED',
      seats: result.seats
    };
  }
}
