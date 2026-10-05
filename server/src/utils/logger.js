import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

let logger;

if (isProduction) {
  logger = pino({
    level: process.env.LOG_LEVEL || 'info'
  });
} else {
  logger = pino({
    level: process.env.LOG_LEVEL || 'debug',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  });
}

export { logger };