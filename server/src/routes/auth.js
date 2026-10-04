import { Router } from 'express';
import { z } from 'zod';
import { AuthController } from '../controllers/authController.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['user', 'admin']).optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

authRouter.post('/register', validate({ body: registerSchema }), AuthController.register);
authRouter.post('/login', validate({ body: loginSchema }), AuthController.login);
authRouter.get('/me', authenticate, AuthController.getMe);
