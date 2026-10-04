import { BookingService } from '../services/bookingService.js';

export class BookingController {
  static async checkout(req, res, next) {
    try {
      const userId = req.user._id.toString();
      const { holdId } = req.body;
      const idempotencyKey = req.headers['idempotency-key'] || null;

      const result = await BookingService.checkout({ userId, holdId, idempotencyKey });

      res.status(201).json({
        status: 'success',
        data: result,
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async listMyBookings(req, res, next) {
    try {
      const userId = req.user._id.toString();
      const { showId, status, page, limit } = req.query;

      const result = await BookingService.listUserBookings(userId, {
        showId,
        status,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20
      });

      res.status(200).json({
        status: 'success',
        data: result,
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async getBooking(req, res, next) {
    try {
      const userId = req.user._id.toString();
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;

      const booking = await BookingService.getBookingById(id, userId, isAdmin);

      res.status(200).json({
        status: 'success',
        data: { booking },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async cancelBooking(req, res, next) {
    try {
      const userId = req.user._id.toString();
      const { id } = req.params;

      const booking = await BookingService.cancelBooking(id, userId);

      res.status(200).json({
        status: 'success',
        data: { booking },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }
}
