import crypto from 'node:crypto';
import { User } from '../models/index.js';
import { HttpError, wrap } from '../utils/helpers.js';

export const loadUser = wrap(async (req, _res, next) => {
  req.user = null;
  const id = req.session?.userId;
  if (id) {
    const u = await User.findById(id);
    if (u && u.accountStatus === 'active') req.user = u;
    else delete req.session.userId;
  }
  next();
});

export const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in to continue')));
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue'));
  return roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission to do this'));
};

export function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

// Synchroniser-token CSRF protection for every state-changing request
export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
  const real = Buffer.from(String(req.session?.csrf || ''));
  if (!real.length || sent.length !== real.length || !crypto.timingSafeEqual(sent, real)) {
    return next(new HttpError(403, 'Invalid or missing CSRF token. Refresh the page and try again'));
  }
  next();
}
