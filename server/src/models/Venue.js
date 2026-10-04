import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    rows: [{ type: String, required: true, uppercase: true, trim: true }],
    basePrice: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const venueLayoutSchema = new mongoose.Schema(
  {
    rows: { type: Number, required: true, min: 1 },
    seatsPerRow: { type: Number, required: true, min: 1 },
    categories: [categorySchema]
  },
  { _id: false }
);

const venueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    city: {
      type: String,
      required: true,
      trim: true
    },
    layout: {
      type: venueLayoutSchema,
      required: true
    }
  },
  {
    timestamps: true
  }
);

export const Venue = mongoose.model('Venue', venueSchema);
