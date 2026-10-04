import { QueueService } from '../services/queueService.js';

export class QueueController {
  static async joinQueue(req, res, next) {
    try {
      const userId = req.user._id.toString();
      const { id: showId } = req.params;
      const result = await QueueService.joinQueue(userId, showId);
      res.status(200).json({ status: 'success', data: result, requestId: req.id });
    } catch (err) {
      next(err);
    }
  }

  static async getPosition(req, res, next) {
    try {
      const userId = req.user._id.toString();
      const { id: showId } = req.params;
      const result = await QueueService.getQueuePosition(userId, showId);
      res.status(200).json({ status: 'success', data: result, requestId: req.id });
    } catch (err) {
      next(err);
    }
  }

  static async admitBatch(req, res, next) {
    try {
      const { id: showId } = req.params;
      const { batchSize, windowMs } = req.body;
      const result = await QueueService.admitBatch(showId, batchSize, windowMs);
      res.status(200).json({ status: 'success', data: result, requestId: req.id });
    } catch (err) {
      next(err);
    }
  }

  static async getStats(req, res, next) {
    try {
      const { id: showId } = req.params;
      const result = await QueueService.getQueueStats(showId);
      res.status(200).json({ status: 'success', data: result, requestId: req.id });
    } catch (err) {
      next(err);
    }
  }
}
