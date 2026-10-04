import { AuthService } from '../services/authService.js';

export class AuthController {
  static async register(req, res, next) {
    try {
      const { name, email, password, role } = req.body;
      const { user, token } = await AuthService.register({ name, email, password, role });
      res.status(201).json({
        status: 'success',
        data: { user, token },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const { user, token } = await AuthService.login({ email, password });
      res.status(200).json({
        status: 'success',
        data: { user, token },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }

  static async getMe(req, res, next) {
    try {
      const user = await AuthService.getMe(req.user._id);
      res.status(200).json({
        status: 'success',
        data: { user },
        requestId: req.id
      });
    } catch (err) {
      next(err);
    }
  }
}
