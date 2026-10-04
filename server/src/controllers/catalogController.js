import { CatalogService } from '../services/catalogService.js';

export class CatalogController {
  static async listEvents(req, res, next) {
    try {
      const { category } = req.query;
      const filter = category ? { category } : {};
      const events = await CatalogService.listEvents(filter);
      res.status(200).json({
        status: 'success',
        data: { events },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async getEventById(req, res, next) {
    try {
      const { id } = req.params;
      const data = await CatalogService.getEventById(id);
      res.status(200).json({
        status: 'success',
        data,
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async getShowById(req, res, next) {
    try {
      const { id } = req.params;
      const show = await CatalogService.getShowById(id);
      res.status(200).json({
        status: 'success',
        data: { show },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async createEvent(req, res, next) {
    try {
      const event = await CatalogService.createEvent(req.body);
      res.status(201).json({
        status: 'success',
        data: { event },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async createShow(req, res, next) {
    try {
      const show = await CatalogService.createShow(req.body);
      res.status(201).json({
        status: 'success',
        data: { show },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }
}
