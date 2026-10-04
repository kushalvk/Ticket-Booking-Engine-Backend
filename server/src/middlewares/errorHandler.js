import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;
  const isServerFault = statusCode >= 500;

  if (isServerFault) {
    logger.error(
      {
        err: {
          message: err.message,
          stack: err.stack,
          code: err.code
        },
        requestId: req.id,
        url: req.originalUrl,
        method: req.method
      },
      'Unhandled internal server error'
    );
  } else {
    logger.warn(
      {
        statusCode,
        message: err.message,
        requestId: req.id,
        url: req.originalUrl
      },
      'Client request error'
    );
  }

  res.status(statusCode).json({
    status: 'error',
    code: err.code || (isServerFault ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST'),
    message: isServerFault && process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred. Please try again later.'
      : err.message || 'Internal server error',
    ...(err.details ? { details: err.details } : {}),
    requestId: req.id
  });
}
