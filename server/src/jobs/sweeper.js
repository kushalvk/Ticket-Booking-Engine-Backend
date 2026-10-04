import { redisClient } from '../redis/client.js';
import { redisKeys } from '../redis/keys.js';
import { emitSeatUpdates } from '../sockets/emitter.js';
import { logger } from '../utils/logger.js';

let sweeperInterval = null;

/**
 * Sweep expired holds for a given show.
 * @param {string} showId
 */
export async function sweepShowExpiredHolds(showId) {
  const seatsKey = redisKeys.showSeats(showId);
  const expiryKey = redisKeys.showHoldsExpiry(showId);
  const nowMs = Date.now();

  try {
    const [_processedIdsJson, releasedSeatsJson] = await redisClient.expire_holds(
      seatsKey,
      expiryKey,
      showId,
      nowMs,
      50
    );

    const releasedSeats = JSON.parse(releasedSeatsJson || '[]');
    if (releasedSeats.length > 0) {
      logger.info({ showId, releasedCount: releasedSeats.length }, 'Expired seats returned to available pool');
      emitSeatUpdates(
        showId,
        releasedSeats.map((seatId) => ({ seatId, status: 'AVAILABLE' }))
      );
    }
  } catch (err) {
    logger.error({ err: err.message, showId }, 'Error running hold expiry sweeper');
  }
}

/**
 * Start recurring background hold sweeper
 * @param {Array<string>} activeShowIds
 * @param {number} intervalMs
 */
export function startHoldSweeper(activeShowIds = [], intervalMs = 2000) {
  if (sweeperInterval) clearInterval(sweeperInterval);

  sweeperInterval = setInterval(async () => {
    for (const showId of activeShowIds) {
      await sweepShowExpiredHolds(showId);
    }
  }, intervalMs);

  logger.info({ intervalMs }, 'Hold expiry sweeper job started');
}

export function stopHoldSweeper() {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
    logger.info('Hold expiry sweeper job stopped');
  }
}
