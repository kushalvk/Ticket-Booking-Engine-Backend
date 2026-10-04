import { connectMongo, disconnectMongo } from '../config/database.js';
import { redisClient } from '../redis/client.js';
import { redisKeys } from '../redis/keys.js';
import { User } from '../models/User.js';
import { Venue } from '../models/Venue.js';
import { Event } from '../models/Event.js';
import { Show } from '../models/Show.js';
import { CatalogService } from '../services/catalogService.js';
import { logger } from '../utils/logger.js';

export async function seedDatabase() {
  logger.info('Starting idempotent database seed...');

  // 1. Upsert Venue: 10 rows x 15 seats = 150 seats
  const venueData = {
    name: 'Grand Arena',
    city: 'Mumbai',
    layout: {
      rows: 10,
      seatsPerRow: 15,
      categories: [
        { name: 'VIP', rows: ['A', 'B'], basePrice: 200 },
        { name: 'PREMIUM', rows: ['C', 'D', 'E', 'F'], basePrice: 120 },
        { name: 'STANDARD', rows: ['G', 'H', 'I', 'J'], basePrice: 60 }
      ]
    }
  };

  const venue = await Venue.findOneAndUpdate(
    { name: venueData.name },
    { $set: venueData },
    { upsert: true, new: true }
  );
  logger.info({ venueId: venue._id.toString() }, 'Seeded venue: Grand Arena');

  // 2. Upsert 5 Events
  const eventsData = [
    {
      title: 'Coldplay: Music of the Spheres',
      description: 'The global stadium tour featuring timeless hits and dazzling visuals.',
      category: 'Concert',
      posterUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819',
      durationMins: 150
    },
    {
      title: 'Taylor Swift: The Eras Tour',
      description: 'An unforgettable musical journey celebrating all album eras.',
      category: 'Concert',
      posterUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745',
      durationMins: 180
    },
    {
      title: 'Arijit Singh Live Symphony',
      description: 'Soulful melodies and orchestral brilliance live in concert.',
      category: 'Concert',
      posterUrl: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6',
      durationMins: 160
    },
    {
      title: 'Avengers: Secret Wars Premiere',
      description: 'The multiversal climax of Marvel cinematic history.',
      category: 'Movie',
      posterUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba',
      durationMins: 165
    },
    {
      title: 'Zakir Khan Live Comedy Special',
      description: 'Heartfelt, hilarious observational comedy from the maestro.',
      category: 'Comedy',
      posterUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7',
      durationMins: 90
    }
  ];

  const seededEvents = [];
  for (const evt of eventsData) {
    const doc = await Event.findOneAndUpdate(
      { title: evt.title },
      { $set: evt },
      { upsert: true, new: true }
    );
    seededEvents.push(doc);
  }
  logger.info({ count: seededEvents.length }, 'Seeded 5 events');

  // 3. Upsert 10 Shows (including 1 flash sale show)
  const baseTime = new Date(Date.now() + 24 * 3600 * 1000); // Tomorrow
  const priceMap = { VIP: 200, PREMIUM: 120, STANDARD: 60 };

  const showsData = [];

  // Show 0 is the flagship Flash Sale Show
  showsData.push({
    eventId: seededEvents[0]._id,
    venueId: venue._id,
    startsAt: new Date(baseTime.getTime() + 1 * 3600 * 1000),
    status: 'ON_SALE',
    saleStartsAt: new Date(),
    priceMap,
    isFlashSale: true,
    totalSeats: 150
  });

  // Shows 1 to 9 are standard shows distributed across events
  for (let i = 1; i < 10; i++) {
    const event = seededEvents[i % seededEvents.length];
    const status = i < 4 ? 'ON_SALE' : i < 7 ? 'SCHEDULED' : 'CLOSED';
    showsData.push({
      eventId: event._id,
      venueId: venue._id,
      startsAt: new Date(baseTime.getTime() + (i + 1) * 3600 * 1000),
      status,
      saleStartsAt: new Date(baseTime.getTime() - 12 * 3600 * 1000),
      priceMap,
      isFlashSale: false,
      totalSeats: 150
    });
  }

  const seededShows = [];
  for (const showData of showsData) {
    const existing = await Show.findOne({
      eventId: showData.eventId,
      venueId: showData.venueId,
      startsAt: showData.startsAt
    });

    let showDoc;
    if (existing) {
      existing.status = showData.status;
      existing.isFlashSale = showData.isFlashSale;
      existing.priceMap = showData.priceMap;
      existing.totalSeats = showData.totalSeats;
      showDoc = await existing.save();
    } else {
      showDoc = await Show.create(showData);
    }
    seededShows.push(showDoc);
  }
  logger.info({ count: seededShows.length }, 'Seeded 10 shows');

  // 4. Initialize Redis seat maps for ON_SALE shows, especially the Flash Sale show
  let flashSaleShow = seededShows.find((s) => s.isFlashSale);
  if (flashSaleShow) {
    await CatalogService.initShowInventory(flashSaleShow._id.toString());
    const seatsKey = redisKeys.showSeats(flashSaleShow._id.toString());
    const seatCount = await redisClient.hlen(seatsKey);
    logger.info(
      { showId: flashSaleShow._id.toString(), redisSeatCount: seatCount },
      'Flash sale show Redis seat inventory initialized'
    );
  }

  // 5. Upsert 200 Test Users + 1 Admin
  const sharedPasswordHash = await User.hashPassword('Test@123');

  const userOperations = [];

  // Admin user
  userOperations.push({
    updateOne: {
      filter: { email: 'admin@ticketrush.com' },
      update: {
        $set: {
          name: 'Super Admin',
          email: 'admin@ticketrush.com',
          passwordHash: sharedPasswordHash,
          role: 'admin'
        }
      },
      upsert: true
    }
  });

  // 200 test users: user1@test.com to user200@test.com
  for (let i = 1; i <= 200; i++) {
    const email = `user${i}@test.com`;
    userOperations.push({
      updateOne: {
        filter: { email },
        update: {
          $set: {
            name: `Test User ${i}`,
            email,
            passwordHash: sharedPasswordHash,
            role: 'user'
          }
        },
        upsert: true
      }
    });
  }

  await User.bulkWrite(userOperations);
  logger.info('Seeded 200 test users + 1 admin user with password: Test@123');

  return {
    venue,
    events: seededEvents,
    shows: seededShows,
    flashSaleShow
  };
}

// Execute directly if run via CLI
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  (async () => {
    try {
      await connectMongo();
      await redisClient.ping();
      await seedDatabase();
      logger.info('Database seeding completed successfully.');
      await disconnectMongo();
      redisClient.disconnect();
      process.exit(0);
    } catch (err) {
      logger.fatal({ err: err.message, stack: err.stack }, 'Seeding failed');
      process.exit(1);
    }
  })();
}
