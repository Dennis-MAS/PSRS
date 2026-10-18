import { Router } from 'express';
import { z } from 'zod';
import { Notification } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError, checkId, pageQuery, paginate, parse, wrap } from '../utils/helpers.js';

const r = Router();
r.use(requireAuth);

r.get('/', wrap(async (req, res) => {
  const q = parse(pageQuery.extend({ unread: z.enum(['0', '1']).optional() }), req.query);
  const filter = { recipient: req.user._id, ...(q.unread === '1' ? { readAt: null } : {}) };
  const [list, unread] = await Promise.all([paginate(Notification, filter, q, { populate: [{ path: 'request', select: 'referenceNumber' }] }), Notification.countDocuments({ recipient: req.user._id, readAt: null })]);
  res.json({ success: true, ...list, unread });
}));
r.patch('/read-all', wrap(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, readAt: null }, { readAt: new Date() });
  res.json({ success: true });
}));
r.patch('/:id/read', wrap(async (req, res) => {
  const n = await Notification.findOneAndUpdate({ _id: checkId(req.params.id), recipient: req.user._id }, { readAt: new Date() }, { returnDocument: 'after' });
  if (!n) throw new HttpError(404, 'Notification not found');
  res.json({ success: true, notification: n });
}));
export default r;
