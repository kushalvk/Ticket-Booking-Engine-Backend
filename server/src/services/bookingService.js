import crypto from 'node:crypto';
import { Booking } from '../models/Booking.js';
import { Payment } from '../models/Payment.js';
import { Show } from '../models/Show.js';
import { Venue } from '../models/Venue.js';
import { SeatService } from './seatService.js';
import { logger } from '../utils/logger.js';

export class BookingService {
  /**
   * Full checkout: confirm the Redis hold, create Payment + Booking in MongoDB.
   * Atomic: if the Mongo write fails, the Redis seats stay BOOKED
   * (the durable safety-net index will prevent duplicates on retry).
   */
  static async checkout({ userId, holdId, idempotencyKey }) {
    // 1. Fetch hold data from Redis to get showId + seats
    const holdInfo = await SeatService.getHold({ userId, holdId });

    if (holdInfo.status !== 'ACTIVE') {
      const error = new Error(`Hold is ${holdInfo.status.toLowerCase()}, cannot checkout`);
      error.statusCode = 400;
      error.code = 'HOLD_NOT_ACTIVE';
      throw error;
    }

    const show = await Show.findById(holdInfo.showId).populate('venueId');
    if (!show) {
      const error = new Error('Show not found');
      error.statusCode = 404;
      error.code = 'SHOW_NOT_FOUND';
      throw error;
    }

    // 2. Calculate pricing using venue categories + show priceMap
    const venue = show.venueId;
    const seatPricing = holdInfo.seats.map((seatId) => {
      const row = seatId.replace(/[0-9]/g, '').toUpperCase();
      let price = 100; // fallback

      if (venue && venue.layout && venue.layout.categories) {
        for (const cat of venue.layout.categories) {
          if (cat.rows.includes(row)) {
            // Use show-level priceMap override if present, else venue base
            price = (show.priceMap && show.priceMap.get(cat.name)) || cat.basePrice;
            break;
          }
        }
      }

      return { seatId, price };
    });

    const totalAmount = seatPricing.reduce((sum, s) => sum + s.price, 0);

    // 3. Confirm hold atomically in Redis (seats → BOOKED)
    await SeatService.confirmHold({ userId, holdId });

    // 4. Create mock payment record
    const payment = await Payment.create({
      holdId,
      userId,
      amount: totalAmount,
      currency: 'USD',
      status: 'SUCCESS',
      provider: 'mock',
      providerRef: `mock_${crypto.randomUUID()}`
    });

    // 5. Create booking record in MongoDB (compound unique index guards double-book)
    let booking;
    try {
      booking = await Booking.create({
        userId,
        showId: holdInfo.showId,
        seats: seatPricing,
        totalAmount,
        status: 'CONFIRMED',
        paymentId: payment._id,
        holdId,
        idempotencyKey
      });
    } catch (err) {
      // If Mongo unique index fires, someone else booked these seats via a race
      if (err.code === 11000) {
        const error = new Error('These seats have already been booked');
        error.statusCode = 409;
        error.code = 'DUPLICATE_BOOKING';
        throw error;
      }
      throw err;
    }

    // Link payment to booking
    payment.bookingId = booking._id;
    await payment.save();

    logger.info(
      { bookingId: booking._id.toString(), holdId, seats: holdInfo.seats },
      'Booking confirmed'
    );

    return {
      booking,
      payment
    };
  }

  /**
   * List bookings for a user (optionally filter by showId).
   */
  static async listUserBookings(userId, { showId, status, page = 1, limit = 20 } = {}) {
    const filter = { userId };
    if (showId) filter.showId = showId;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('showId', 'startsAt status isFlashSale totalSeats')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter)
    ]);

    return {
      bookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get a single booking by ID (user must own it or be admin).
   */
  static async getBookingById(bookingId, userId, isAdmin = false) {
    const booking = await Booking.findById(bookingId)
      .populate('showId')
      .populate('paymentId');

    if (!booking) {
      const error = new Error('Booking not found');
      error.statusCode = 404;
      error.code = 'BOOKING_NOT_FOUND';
      throw error;
    }

    if (!isAdmin && booking.userId.toString() !== userId) {
      const error = new Error('You do not have permission to view this booking');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    return booking;
  }

  /**
   * Cancel a confirmed booking (does NOT release Redis seats - they remain BOOKED).
   * In production this would integrate with payment refund flow.
   */
  static async cancelBooking(bookingId, userId) {
    const booking = await Booking.findById(bookingId);

    if (!booking) {
      const error = new Error('Booking not found');
      error.statusCode = 404;
      error.code = 'BOOKING_NOT_FOUND';
      throw error;
    }

    if (booking.userId.toString() !== userId) {
      const error = new Error('You do not have permission to cancel this booking');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    if (booking.status !== 'CONFIRMED') {
      const error = new Error(`Booking is already ${booking.status.toLowerCase()}`);
      error.statusCode = 400;
      error.code = 'BOOKING_NOT_CANCELLABLE';
      throw error;
    }

    booking.status = 'CANCELLED';
    await booking.save();

    // Mark payment as refunded
    if (booking.paymentId) {
      await Payment.findByIdAndUpdate(booking.paymentId, { status: 'FAILED' });
    }

    logger.info({ bookingId: booking._id.toString() }, 'Booking cancelled');

    return booking;
  }
}
