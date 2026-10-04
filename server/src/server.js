import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { app } from './app.js';
import { config } from './config/index.js';
import { connectMongo, disconnectMongo } from './config/database.js';
import { redisClient, redisPubClient, redisSubClient, registerLuaScripts } from './redis/client.js';
import { setSocketIO } from './sockets/emitter.js';
import { logger } from './utils/logger.js';

let server;
let io;

export async function startServer() {
  try {
    logger.info('Connecting to MongoDB...');
    await connectMongo();

    logger.info('Verifying Redis connection and registering Lua scripts...');
    await redisClient.ping();
    registerLuaScripts(redisClient);

    const httpServer = http.createServer(app);

    // Initialize Socket.IO with Redis Adapter
    io = new SocketIOServer(httpServer, {
      cors: {
        origin: config.CORS_ORIGIN,
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    setSocketIO(io);

    io.adapter(createAdapter(redisPubClient, redisSubClient));

    io.on('connection', (socket) => {
      logger.debug({ socketId: socket.id }, 'Socket.IO client connected');

      socket.on('join:show', (showId) => {
        socket.join(`show:${showId}`);
        logger.debug({ socketId: socket.id, showId }, 'Client joined show room');
      });

      socket.on('leave:show', (showId) => {
        socket.leave(`show:${showId}`);
        logger.debug({ socketId: socket.id, showId }, 'Client left show room');
      });

      socket.on('disconnect', (reason) => {
        logger.debug({ socketId: socket.id, reason }, 'Socket.IO client disconnected');
      });
    });

    server = httpServer.listen(config.PORT, () => {
      logger.info({ port: config.PORT, env: config.NODE_ENV }, 'TicketRush Server listening');
    });

    const shutdown = async (signal) => {
      logger.info({ signal }, 'Gracefully shutting down TicketRush server...');
      if (server) {
        server.close(async () => {
          logger.info('HTTP server closed');
          if (io) {
            io.close();
            logger.info('Socket.IO server closed');
          }
          await disconnectMongo();
          redisClient.disconnect();
          redisPubClient.disconnect();
          redisSubClient.disconnect();
          logger.info('All connections terminated. Goodbye!');
          process.exit(0);
        });
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return { server, io };
  } catch (err) {
    logger.fatal({ err: err.message, stack: err.stack }, 'Fatal error during server startup');
    process.exit(1);
  }
}

// Start if executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer();
}
