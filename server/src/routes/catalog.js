import { Router } from 'express';
import { z } from 'zod';
import { CatalogController } from '../controllers/catalogController.js';
import { validate } from '../middlewares/validate.js';
import { authenticate, requireRole } from '../middlewares/auth.js';

export const eventsRouter = Router();
export const showsRouter = Router();

const createEventSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  description: z.string().optional().default(''),
  category: z.string().min(2, 'Category is required'),
  posterUrl: z.string().optional().default(''),
  durationMins: z.coerce.number().int().positive('Duration must be positive in minutes')
});

const createShowSchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  venueId: z.string().min(1, 'venueId is required'),
  startsAt: z.string().datetime({ offset: true }).or(z.string().min(10)),
  status: z.enum(['SCHEDULED', 'ON_SALE', 'SOLD_OUT', 'CLOSED']).optional().default('SCHEDULED'),
  saleStartsAt: z.string().datetime({ offset: true }).or(z.string().min(10)).optional(),
  priceMap: z.record(z.coerce.number()).optional().default({}),
  isFlashSale: z.boolean().optional().default(false)
});

// Events routes
eventsRouter.get('/', CatalogController.listEvents);
eventsRouter.get('/:id', CatalogController.getEventById);
eventsRouter.post(
  '/',
  authenticate,
  requireRole('admin'),
  validate({ body: createEventSchema }),
  CatalogController.createEvent
);

// Shows routes
showsRouter.get('/:id', CatalogController.getShowById);
showsRouter.post(
  '/',
  authenticate,
  requireRole('admin'),
  validate({ body: createShowSchema }),
  CatalogController.createShow
);
