import { User } from '../models/User.js';
import { signToken } from '../utils/jwt.js';

export class AuthService {
  static async register({ name, email, password, role = 'user' }) {
    const existing = await User.findOne({ email });
    if (existing) {
      const error = new Error('A user with this email already exists');
      error.statusCode = 409;
      error.code = 'USER_EXISTS';
      throw error;
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      name,
      email,
      passwordHash,
      role
    });

    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role
    });

    return { user, token };
  }

  static async login({ email, password }) {
    const user = await User.findOne({ email });
    if (!user) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role
    });

    return { user, token };
  }

  static async getMe(userId) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      error.code = 'USER_NOT_FOUND';
      throw error;
    }
    return user;
  }
}
