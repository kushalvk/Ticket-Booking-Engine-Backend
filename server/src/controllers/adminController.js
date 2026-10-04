import { CatalogService } from '../services/catalogService.js';
import { Show } from '../models/Show.js';

export class AdminController {
  /**
   * PATCH /api/admin/shows/:id/status - Update show status and init inventory if ON_SALE
   */
  static async updateShowStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const show = await Show.findById(id);
      if (!show) {
        const error = new Error('Show not found');
        error.statusCode = 404;
        throw error;
      }

      show.status = status;
      await show.save();

      // If transitioning to ON_SALE, initialize Redis seat inventory
      if (status === 'ON_SALE') {
        await CatalogService.initShowInventory(show._id.toString());
      }

      res.status(200).json({
        status: 'success',
        data: { show },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/admin/shows/:id/init-inventory - Manually init seat map
   */
  static async initInventory(req, res, next) {
    try {
      const { id } = req.params;
      const result = await CatalogService.initShowInventory(id);
      res.status(200).json({
        status: 'success',
        data: result,
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }
}
