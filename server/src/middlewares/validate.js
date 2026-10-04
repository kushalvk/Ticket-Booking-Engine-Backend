import { ZodError } from 'zod';

/**
 * Higher-order middleware to validate incoming request segments (body, query, params)
 * @param {object} schemaMap
 * @param {import('zod').ZodSchema} [schemaMap.body]
 * @param {import('zod').ZodSchema} [schemaMap.query]
 * @param {import('zod').ZodSchema} [schemaMap.params]
 */
export function validate(schemaMap = {}) {
  return (req, res, next) => {
    try {
      if (schemaMap.body && req.body) {
        req.body = schemaMap.body.parse(req.body);
      }
      if (schemaMap.query && req.query) {
        req.query = schemaMap.query.parse(req.query);
      }
      if (schemaMap.params && req.params) {
        req.params = schemaMap.params.parse(req.params);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: 'Input validation failed',
          errors: err.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message
          })),
          requestId: req.id
        });
      }
      next(err);
    }
  };
}
