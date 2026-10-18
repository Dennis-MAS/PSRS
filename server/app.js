import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { csrfProtection, loadUser } from './middleware/auth.js';
import { errorHandler, notFoundApi } from './middleware/errors.js';
import { apiLimiter } from './utils/limiters.js';
import authRoutes from './routes/auth.js';
import { departments, services } from './routes/catalog.js';
import requestRoutes from './routes/requests.js';
import officerRoutes from './routes/officer.js';
import notificationRoutes from './routes/notifications.js';
import trackRoutes from './routes/track.js';
import adminRoutes from './routes/admin.js';
import { publicSettings } from './services/settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ sessionStore } = {}) {
  const app = express();
  const prod = process.env.NODE_ENV === 'production';
  if (prod && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
  app.set('trust proxy', prod ? 1 : false);
  app.disable('x-powered-by');
  app.set('query parser', 'simple'); // no nested query objects (NoSQL operator injection)

  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"],
      frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], upgradeInsecureRequests: prod ? [] : null
    } }
  }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', uptime: Math.round(process.uptime()) }));

  app.use('/api', apiLimiter);
  app.use(session({
    name: 'psrs.sid', secret: process.env.SESSION_SECRET || 'dev-only-secret', resave: false, saveUninitialized: false, store: sessionStore,
    cookie: { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: Number(process.env.SESSION_MAX_AGE_HOURS || 8) * 3600 * 1000 }
  }));
  app.use('/api', loadUser, csrfProtection);

  const v1 = express.Router();
  v1.use('/auth', authRoutes);
  v1.use('/services', services);
  v1.use('/departments', departments);
  v1.use('/requests', requestRoutes);
  v1.use('/officer', officerRoutes);
  v1.use('/notifications', notificationRoutes);
  v1.use('/admin', adminRoutes);
  v1.use('/track', trackRoutes);
  v1.get('/settings/public', async (_req, res, next) => { try { res.json({ success: true, settings: await publicSettings() }); } catch (e) { next(e); } });
  app.use('/api/v1', v1);
  app.use('/api', notFoundApi);

  app.use('/vendor/chart', express.static(path.join(root, 'node_modules/chart.js/dist')));
  app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
  app.use((_req, res) => res.status(404).sendFile(path.join(root, 'public/errors/404.html')));
  app.use(errorHandler);
  return app;
}
