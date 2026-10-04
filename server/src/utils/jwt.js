import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export function signToken(payload, options = { expiresIn: '24h' }) {
  return jwt.sign(payload, config.JWT_SECRET, options);
}

export function verifyToken(token) {
  return jwt.verify(token, config.JWT_SECRET);
}
