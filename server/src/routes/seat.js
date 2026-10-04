import { Router } from 'express';
import { z } from 'zod';
import { SeatController } from '../controllers/seatController.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';

export const seatShowRouter = Router({ mergeParams: true });
export const holdRouter = Router();

const holdSeatsSchema = z.object({
  seatIds: z
    .array(z.string().min(1, 'Seat ID cannot be empty'))
    .min(1, 'Must request at least 1 seat')
    .max(6, 'Cannot request more than 6 seats')
});

// Mounted under /shows/:id or /api/shows/:id
seatShowRouter.get('/seats', authenticate, SeatController.getSeatMap);
seatShowRouter.post('/holds', authenticate, validate({ body: holdSeatsSchema }), SeatController.holdSeats);

// Mounted under /holds or /api/holds
holdRouter.get('/:id', authenticate, SeatController.getHold);
holdRouter.delete('/:id', authenticate, SeatController.releaseHold);
