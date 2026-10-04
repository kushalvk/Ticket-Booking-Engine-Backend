import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    description: {
      type: String,
      default: '',
      trim: true
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    posterUrl: {
      type: String,
      default: '',
      trim: true
    },
    durationMins: {
      type: Number,
      required: true,
      min: 1
    }
  },
  {
    timestamps: true
  }
);

export const Event = mongoose.model('Event', eventSchema);
