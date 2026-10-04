import { logger } from '../utils/logger.js';

let ioInstance = null;

export function setSocketIO(io) {
  ioInstance = io;
}

export function getSocketIO() {
  return ioInstance;
}

/**
 * Broadcast seat status change to show room
 * @param {string} showId
 * @param {Array<{ seatId: string, status: 'AVAILABLE'|'HELD'|'BOOKED', userId?: string }>} seatUpdates
 */
export function emitSeatUpdates(showId, seatUpdates) {
  if (!ioInstance) return;
  try {
    ioInstance.to(`show:${showId}`).emit('seats:updated', {
      showId,
      updates: seatUpdates,
      timestamp: Date.now()
    });
  } catch (err) {
    logger.error({ err: err.message, showId }, 'Failed to emit seat update');
  }
}
