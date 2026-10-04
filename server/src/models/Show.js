import mongoose from 'mongoose';

const showSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    },
    venueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Venue',
      required: true,
      index: true
    },
    startsAt: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ['SCHEDULED', 'ON_SALE', 'SOLD_OUT', 'CLOSED'],
      default: 'SCHEDULED',
      index: true
    },
    saleStartsAt: {
      type: Date,
      default: Date.now
    },
    priceMap: {
      type: Map,
      of: Number,
      default: {}
    },
    isFlashSale: {
      type: Boolean,
      default: false,
      index: true
    },
    totalSeats: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

showSchema.index({ startsAt: 1, status: 1 });
showSchema.index({ isFlashSale: 1, status: 1 });

export const Show = mongoose.model('Show', showSchema);
