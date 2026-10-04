import { Event } from '../models/Event.js';
import { Show } from '../models/Show.js';
import { Venue } from '../models/Venue.js';
import { redisClient } from '../redis/client.js';
import { redisKeys } from '../redis/keys.js';
import { logger } from '../utils/logger.js';

export class CatalogService {
  /**
   * Idempotently initializes Redis seat map for a show based on venue layout.
   * Uses HSETNX so existing held or booked seats are never overwritten.
   * @param {string} showId
   * @returns {Promise<{ showId: string, totalSeats: number, initialized: boolean }>}
   */
  static async initShowInventory(showId) {
    const show = await Show.findById(showId).populate('venueId');
    if (!show) {
      const error = new Error('Show not found');
      error.statusCode = 404;
      error.code = 'SHOW_NOT_FOUND';
      throw error;
    }

    const venue = show.venueId;
    if (!venue || !venue.layout) {
      const error = new Error('Venue layout configuration missing for show');
      error.statusCode = 400;
      error.code = 'VENUE_LAYOUT_MISSING';
      throw error;
    }

    const { rows, seatsPerRow } = venue.layout;
    const seatsKey = redisKeys.showSeats(show._id.toString());

    // Generate row labels A, B, C, ... up to rows count
    const rowLabels = Array.from({ length: rows }, (_, i) => String.fromCharCode(65 + i));

    const pipeline = redisClient.pipeline();
    let seatCount = 0;

    for (const row of rowLabels) {
      for (let num = 1; num <= seatsPerRow; num++) {
        const seatId = `${row}${num}`;
        pipeline.hsetnx(seatsKey, seatId, 'AVAILABLE');
        seatCount++;
      }
    }

    await pipeline.exec();

    // Ensure show.totalSeats matches venue capacity
    if (show.totalSeats !== seatCount) {
      show.totalSeats = seatCount;
      await show.save();
    }

    logger.info({ showId: show._id.toString(), seatCount }, 'Show seat inventory initialized idempotently');
    return { showId: show._id.toString(), totalSeats: seatCount, initialized: true };
  }

  static async listEvents(filter = {}) {
    return Event.find(filter).sort({ createdAt: -1 });
  }

  static async getEventById(id) {
    const event = await Event.findById(id);
    if (!event) {
      const error = new Error('Event not found');
      error.statusCode = 404;
      error.code = 'EVENT_NOT_FOUND';
      throw error;
    }
    const shows = await Show.find({ eventId: id }).populate('venueId').sort({ startsAt: 1 });
    return { event, shows };
  }

  static async getShowById(id) {
    const show = await Show.findById(id).populate('eventId').populate('venueId');
    if (!show) {
      const error = new Error('Show not found');
      error.statusCode = 404;
      error.code = 'SHOW_NOT_FOUND';
      throw error;
    }

    // Return metadata only as per specification
    return {
      _id: show._id,
      eventId: show.eventId,
      venueId: show.venueId,
      startsAt: show.startsAt,
      status: show.status,
      saleStartsAt: show.saleStartsAt,
      priceMap: show.priceMap,
      isFlashSale: show.isFlashSale,
      totalSeats: show.totalSeats,
      createdAt: show.createdAt,
      updatedAt: show.updatedAt
    };
  }

  static async createEvent(data) {
    return Event.create(data);
  }

  static async createShow(data) {
    const venue = await Venue.findById(data.venueId);
    if (!venue) {
      const error = new Error('Venue not found');
      error.statusCode = 404;
      error.code = 'VENUE_NOT_FOUND';
      throw error;
    }

    const totalSeats = venue.layout.rows * venue.layout.seatsPerRow;
    const show = await Show.create({
      ...data,
      totalSeats
    });

    // If show status is ON_SALE, immediately initialize Redis seat inventory
    if (show.status === 'ON_SALE') {
      await CatalogService.initShowInventory(show._id.toString());
    }

    return show;
  }
}
