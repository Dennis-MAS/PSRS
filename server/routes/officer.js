import { Router } from 'express';
import { z } from 'zod';
import { RequestComment, ServiceRequest, User } from '../models/index.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, checkId, escapeRegex, pageQuery, paginate, parse, wrap } from '../utils/helpers.js';
import { audit, changeStatus, loadAuthorizedRequest, notify, requestScope, staffForDepartment } from '../services/records.js';

const r = Router();
r.use(requireRole('officer', 'admin')); // admins reuse these endpoints for the all-requests view
const STATUS = z.enum(['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CANCELLED']);
const populate = [{ path: 'service', select: 'name' }, { path: 'department', select: 'name' }, { path: 'assignedOfficer', select: 'fullName' }, { path: 'citizen', select: 'fullName' }];

r.get('/requests', wrap(async (req, res) => {
  const q = parse(pageQuery.extend({
    q: z.string().max(40).optional(), status: STATUS.optional(), service: z.string().length(24).optional(), department: z.string().length(24).optional(),
    from: z.coerce.date().optional(), to: z.coerce.date().optional(), mine: z.enum(['0', '1']).optional()
  }), req.query);
  const conds = [requestScope(req.user)];
  if (q.q) conds.push({ referenceNumber: new RegExp(escapeRegex(q.q), 'i') });
  if (q.status) conds.push({ status: q.status });
  if (q.service) conds.push({ service: q.service });
  if (q.department && req.user.role === 'admin') conds.push({ department: q.department });
  if (q.mine === '1') conds.push({ assignedOfficer: req.user._id });
  if (q.from || q.to) conds.push({ submittedAt: { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: new Date(q.to.getTime() + 86399999) }) } });
  res.json({ success: true, ...(await paginate(ServiceRequest, { $and: conds }, q, { sort: { updatedAt: -1 }, populate })) });
}));

r.get('/dashboard', wrap(async (req, res) => {
  const scope = requestScope(req.user);
  const rows = await ServiceRequest.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const c = Object.fromEntries(rows.map((x) => [x._id, x.n]));
  const mine = await ServiceRequest.countDocuments({ $and: [scope, { assignedOfficer: req.user._id, status: { $nin: ['RESOLVED', 'REJECTED', 'CANCELLED'] } }] });
  const recent = await ServiceRequest.find(scope).sort({ updatedAt: -1 }).limit(5).populate(populate);
  res.json({ success: true, stats: { assignedToMe: mine, pendingReview: (c.SUBMITTED || 0) + (c.UNDER_REVIEW || 0), inProgress: c.IN_PROGRESS || 0, awaitingInformation: c.AWAITING_INFORMATION || 0, resolved: c.RESOLVED || 0 }, recent });
}));

r.get('/requests/:id/assignees', wrap(async (req, res) => {
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  res.json({ success: true, items: await staffForDepartment(doc.department) });
}));

r.patch('/requests/:id/assign', wrap(async (req, res) => {
  const { officerId } = parse(z.object({ officerId: z.string().length(24).nullable() }), req.body);
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  if (['RESOLVED', 'REJECTED', 'CANCELLED'].includes(doc.status)) throw new HttpError(409, 'Closed requests cannot be reassigned');
  if (officerId) {
    const officer = await User.findOne({ _id: officerId, role: 'officer', accountStatus: 'active' });
    if (!officer || String(officer.department) !== String(doc.department)) throw new HttpError(422, 'Choose an active officer from the responsible department', { officerId: 'Not allowed' });
    doc.assignedOfficer = officer._id;
    await doc.save();
    await notify(officer._id, doc._id, 'Request assigned to you', `${doc.referenceNumber} was assigned to you.`, 'emailOnAssign', { reference: doc.referenceNumber, title: doc.title });
    await notify(doc.citizen, doc._id, 'Officer assigned', `${doc.referenceNumber} is now being handled by an officer.`);
    await audit(req.user._id, 'request.assign', 'ServiceRequest', doc._id, { officer: officer._id });
  } else {
    doc.assignedOfficer = null;
    await doc.save();
    await audit(req.user._id, 'request.unassign', 'ServiceRequest', doc._id);
  }
  res.json({ success: true, request: doc });
}));

r.patch('/requests/:id/status', wrap(async (req, res) => {
  const d = parse(z.object({ status: STATUS, comment: z.string().trim().max(2000).optional() }), req.body);
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  if (req.user.role === 'officer' && !doc.assignedOfficer && d.status === 'UNDER_REVIEW') { doc.assignedOfficer = req.user._id; await doc.save(); }
  res.json({ success: true, request: await changeStatus(doc, d.status, req.user, d.comment) });
}));

r.post('/requests/:id/internal-notes', wrap(async (req, res) => {
  const d = parse(z.object({ comment: z.string().trim().min(1).max(2000) }), req.body);
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  const note = await RequestComment.create({ request: doc._id, author: req.user._id, comment: d.comment, visibility: 'internal' });
  await audit(req.user._id, 'request.internal_note', 'ServiceRequest', doc._id);
  res.status(201).json({ success: true, comment: note });
}));

export default r;
