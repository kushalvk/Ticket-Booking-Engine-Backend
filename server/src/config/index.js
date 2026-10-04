import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required').default('mongodb://localhost:27017/ticketrush'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default('ticketrush-dev-secret-super-key-32chars'),
  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_SEATS_PER_HOLD: z.coerce.number().int().positive().default(6),
  QUEUE_ADMIT_RATE: z.coerce.number().int().positive().default(50),
  QUEUE_ADMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(5),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.error({ errors: parsed.error.format() }, 'Invalid environment configuration');
  throw new Error(`Config validation error: ${JSON.stringify(parsed.error.format())}`);
}

export const config = Object.freeze(parsed.data);
