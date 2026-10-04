import { SeatService } from '../services/seatService.js';

export class SeatController {
  static async getSeatMap(req, res, next) {
    try {
      const { id: showId } = req.params;
      const seatMap = await SeatService.getSeatMap(showId);
      res.status(200).json({
        status: 'success',
        data: seatMap,
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async holdSeats(req, res, next) {
    try {
      const { id: showId } = req.params;
      const { seatIds } = req.body;
      const userId = req.user._id.toString();

      const holdResult = await SeatService.holdSeats({
        userId,
        showId,
        seatIds
      });

      res.status(201).json({
        status: 'success',
        data: holdResult,
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async releaseHold(req, res, next) {
    try {
      const { id: holdId } = req.params;
      const userId = req.user._id.toString();

      const releaseResult = await SeatService.releaseHold({
        userId,
        holdId
      });

      res.status(200).json({
        status: 'success',
        data: releaseResult,
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async getHold(req, res, next) {
    try {
      const { id: holdId } = req.params;
      const userId = req.user._id.toString();

      const holdData = await SeatService.getHold({
        userId,
        holdId
      });

      res.status(200).json({
        status: 'success',
        data: holdData,
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }
}
