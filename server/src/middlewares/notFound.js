export function notFoundMiddleware(req, res, _next) {
  res.status(404).json({
    status: 'error',
    code: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    requestId: req.id
  });
}
