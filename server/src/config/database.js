import mongoose from 'mongoose';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

export async function connectMongo() {
  try {
    await mongoose.connect(config.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true
    });
    logger.info('MongoDB connected successfully');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to connect to MongoDB');
    throw err;
  }
}

export async function disconnectMongo() {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}
