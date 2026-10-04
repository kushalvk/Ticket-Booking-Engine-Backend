import mongoose from 'mongoose';

const bookedSeatSchema = new mongoose.Schema(
  {
    seatId: { type: String, required: true },
    price: { type: Number, required: true }
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    showId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Show',
      required: true,
      index: true
    },
    seats: {
      type: [bookedSeatSchema],
      required: true,
      validate: [(val) => val.length > 0, 'Booking must contain at least one seat']
    },
    totalAmount: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ['CONFIRMED', 'CANCELLED', 'REFUNDED'],
      default: 'CONFIRMED',
      index: true
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment'
    },
    holdId: {
      type: String,
      required: true,
      index: true
    },
    idempotencyKey: {
      type: String,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Final safety net against double-booking in MongoDB
bookingSchema.index(
  { showId: 1, 'seats.seatId': 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'CONFIRMED' }
  }
);

export const Booking = mongoose.model('Booking', bookingSchema);
