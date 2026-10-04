import { redisClient } from '../redis/client.js';
import { redisKeys } from '../redis/keys.js';
import { logger } from '../utils/logger.js';

export class QueueService {
  /**
   * Join the waiting room queue for a show.
   */
  static async joinQueue(userId, showId) {
    const queueKey = redisKeys.showQueue(showId);
    const admittedKey = redisKeys.showAdmitted(showId);
    const nowMs = Date.now();

    const rawResult = await redisClient.queue_join(queueKey, admittedKey, userId, nowMs);

    const [status, position] = rawResult;
    return {
      showId,
      userId,
      status, // 'QUEUED' or 'ADMITTED'
      position: Number(position)
    };
  }

  /**
   * Check user's position in the queue.
   */
  static async getQueuePosition(userId, showId) {
    const queueKey = redisKeys.showQueue(showId);
    const admittedKey = redisKeys.showAdmitted(showId);
    const nowMs = Date.now();

    // Check if admitted
    const admittedScore = await redisClient.zscore(admittedKey, userId);
    if (admittedScore && Number(admittedScore) > nowMs) {
      return { status: 'ADMITTED', position: 0 };
    }

    // Check queue position
    const rank = await redisClient.zrank(queueKey, userId);
    if (rank === null) {
      return { status: 'NOT_IN_QUEUE', position: -1 };
    }

    const totalInQueue = await redisClient.zcard(queueKey);
    return {
      status: 'QUEUED',
      position: rank + 1,
      totalInQueue
    };
  }

  /**
   * Admin: admit a batch of users from the waiting room.
   */
  static async admitBatch(showId, batchSize = 50, windowMs = 300000) {
    const queueKey = redisKeys.showQueue(showId);
    const admittedKey = redisKeys.showAdmitted(showId);
    const nowMs = Date.now();

    const rawResult = await redisClient.queue_admit(
      queueKey,
      admittedKey,
      batchSize,
      windowMs,
      nowMs
    );

    const admitted = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
    logger.info({ showId, admittedCount: admitted.length }, 'Admitted batch from queue');

    return { admitted, showId };
  }

  /**
   * Get queue stats for a show.
   */
  static async getQueueStats(showId) {
    const queueKey = redisKeys.showQueue(showId);
    const admittedKey = redisKeys.showAdmitted(showId);
    const nowMs = Date.now();

    // Clean expired admitted
    await redisClient.zremrangebyscore(admittedKey, 0, nowMs);

    const [queueSize, admittedSize] = await Promise.all([
      redisClient.zcard(queueKey),
      redisClient.zcard(admittedKey)
    ]);

    return {
      showId,
      queueSize,
      admittedCount: admittedSize
    };
  }
}
