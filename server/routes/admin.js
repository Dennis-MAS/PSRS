import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AuditLog, Department, Notification, PasswordReset, Service, ServiceRequest, User } from '../models/index.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, checkId, csvCell, escapeRegex, pageQuery, paginate, parse, wrap } from '../utils/helpers.js';
import { audit } from '../services/records.js';
import { DEFS, getSettings, isEmailConfigured, saveSettings } from '../services/settings.js';
import { appUrl, checkBrevo, queueTemplate, sendTemplate } from '../services/email.js';
import { createToken } from './auth.js';

const r = Router();
r.use(requireRole('admin'));
const OID = (s) => new mongoose.Types.ObjectId(s);
const CLOSED = ['RESOLVED', 'REJECTED', 'CANCELLED'];
const DAY = 86400000;
const STATUS = z.enum(['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CANCELLED']);

async function nameMap(Model, ids, field = 'name') {
  const rows = await Model.find({ _id: { $in: ids.filter(Boolean) } }).select(field);
  return new Map(rows.map((x) => [String(x._id), x[field]]));
}

r.get('/dashboard', wrap(async (_req, res) => {
  const since30 = new Date(Date.now() - 30 * DAY), since7 = new Date(Date.now() - 7 * DAY), since6m = new Date(Date.now() - 183 * DAY);
  const [byStatusRows, byDeptRows, recent, resolvedDocs, newCount] = await Promise.all([
    ServiceRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ServiceRequest.aggregate([{ $group: { _id: '$department', n: { $sum: 1 } } }]),
    ServiceRequest.find({ submittedAt: { $gte: since30 } }).select('submittedAt').limit(20000).lean(),
    ServiceRequest.find({ status: 'RESOLVED', resolvedAt: { $ne: null } }).select('submittedAt resolvedAt').limit(20000).lean(),
    ServiceRequest.countDocuments({ submittedAt: { $gte: since7 } })
  ]);
  // Day/month bucketing and averages are done in JS so the code runs on any MongoDB-compatible server.
  const overTimeMap = new Map();
  for (const d of recent) { const k = d.submittedAt.toISOString().slice(0, 10); overTimeMap.set(k, (overTimeMap.get(k) || 0) + 1); }
  const overTime = [...overTimeMap].sort().map(([_id, n]) => ({ _id, n }));
  const trendMap = new Map();
  for (const d of resolvedDocs.filter((x) => x.resolvedAt >= since6m)) {
    const k = d.resolvedAt.toISOString().slice(0, 7); const t = trendMap.get(k) || { ms: 0, n: 0 };
    t.ms += d.resolvedAt - d.submittedAt; t.n += 1; trendMap.set(k, t);
  }
  const trend = [...trendMap].sort().map(([_id, t]) => ({ _id, ms: t.ms / t.n, n: t.n }));
  const avg = resolvedDocs.length ? [{ ms: resolvedDocs.reduce((acc, d) => acc + (d.resolvedAt - d.submittedAt), 0) / resolvedDocs.length }] : [];
  const byStatus = Object.fromEntries(byStatusRows.map((x) => [x._id, x.n]));
  const names = await nameMap(Department, byDeptRows.map((x) => x._id));
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  res.json({
    success: true,
    metrics: {
      total, newSubmissions: newCount, pendingReview: (byStatus.SUBMITTED || 0) + (byStatus.UNDER_REVIEW || 0), awaitingInformation: byStatus.AWAITING_INFORMATION || 0,
      inProgress: byStatus.IN_PROGRESS || 0, resolved: byStatus.RESOLVED || 0, rejected: byStatus.REJECTED || 0,
      // open = anything not yet finished; resolution rate = resolved / all requests
      openCases: total - (byStatus.RESOLVED || 0) - (byStatus.REJECTED || 0) - (byStatus.CANCELLED || 0),
      resolutionRate: total ? Math.round(((byStatus.RESOLVED || 0) / total) * 100) : 0,
      avgResolutionDays: avg[0] ? +(avg[0].ms / DAY).toFixed(1) : null
    },
    charts: {
      openVsResolved: { open: total - (byStatus.RESOLVED || 0) - (byStatus.REJECTED || 0) - (byStatus.CANCELLED || 0), resolved: byStatus.RESOLVED || 0, closedOther: (byStatus.REJECTED || 0) + (byStatus.CANCELLED || 0) },
      byStatus, byDepartment: byDeptRows.map((x) => ({ name: names.get(String(x._id)) || 'Unknown', count: x.n })),
      overTime: overTime.map((x) => ({ date: x._id, count: x.n })), resolutionTrend: trend.map((x) => ({ month: x._id, avgDays: +(x.ms / DAY).toFixed(1), resolved: x.n }))
    }
  });
}));

// ---- users ----
r.get('/users', wrap(async (req, res) => {
  const q = parse(pageQuery.extend({ q: z.string().max(100).optional(), role: z.enum(['citizen', 'officer', 'admin']).optional(), accountStatus: z.enum(['active', 'suspended']).optional() }), req.query);
  const filter = { deletedAt: { $exists: false } };
  if (q.role) filter.role = q.role;
  if (q.accountStatus) filter.accountStatus = q.accountStatus;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); filter.$or = [{ fullName: rx }, { email: rx }]; }
  res.json({ success: true, ...(await paginate(User, filter, q, { populate: [{ path: 'department', select: 'name' }] })) });
}));

const pwd = z.string().min(8).max(72).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/);
r.post('/users', wrap(async (req, res) => {
  const d = parse(z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email(), password: pwd, role: z.enum(['officer', 'admin']), department: z.string().length(24).optional() }), req.body);
  if (d.role === 'officer' && !(d.department && (await Department.exists({ _id: d.department })))) throw new HttpError(422, 'Officers need a department', { department: 'Required' });
  if (await User.exists({ email: d.email })) throw new HttpError(409, 'An account with this email already exists', { email: 'Already registered' });
  const u = await User.create({ fullName: d.fullName, email: d.email, role: d.role, department: d.role === 'officer' ? d.department : null, passwordHash: await bcrypt.hash(d.password, 12) });
  await audit(req.user._id, 'user.create', 'User', u._id, { role: u.role });
  let invited = false;
  const base = appUrl(req);
  if (isEmailConfigured() && base) { // email a link so the staff member sets their own password
    const link = `${base}/forgot-password.html?token=${await createToken(u._id, 'reset', 24 * 60)}`;
    invited = (await sendTemplate('staffInvite', u, { role: u.role === 'admin' ? 'administrator' : 'service officer', link, loginUrl: `${base}/staff-login.html` })).sent;
  }
  res.status(201).json({ success: true, user: u, invited });
}));

const notSelf = (req) => { if (String(req.params.id) === String(req.user._id)) throw new HttpError(409, 'You cannot change your own account here'); };
r.patch('/users/:id/role', wrap(async (req, res) => {
  const d = parse(z.object({ role: z.enum(['citizen', 'officer', 'admin']), department: z.string().length(24).nullable().optional() }), req.body);
  checkId(req.params.id); notSelf(req);
  const u = await User.findOne({ _id: req.params.id, deletedAt: { $exists: false } });
  if (!u) throw new HttpError(404, 'User not found');
  if (d.role === 'officer' && !(d.department || u.department)) throw new HttpError(422, 'Officers need a department', { department: 'Required' });
  if (d.department && !(await Department.exists({ _id: d.department }))) throw new HttpError(422, 'Department not found', { department: 'Not found' });
  const before = u.role;
  u.role = d.role;
  if (d.role === 'officer' && d.department) u.department = d.department;
  if (d.role !== 'officer') u.department = null;
  await u.save();
  await audit(req.user._id, 'user.role', 'User', u._id, { from: before, to: u.role });
  res.json({ success: true, user: u });
}));
r.patch('/users/:id/department', wrap(async (req, res) => {
  const { department } = parse(z.object({ department: z.string().length(24) }), req.body);
  const u = await User.findOne({ _id: checkId(req.params.id), role: 'officer', deletedAt: { $exists: false } });
  if (!u) throw new HttpError(404, 'Officer not found');
  if (!(await Department.exists({ _id: department }))) throw new HttpError(422, 'Department not found', { department: 'Not found' });
  u.department = department; await u.save();
  await audit(req.user._id, 'user.department', 'User', u._id, { department });
  res.json({ success: true, user: u });
}));
r.patch('/users/:id/status', wrap(async (req, res) => {
  const { accountStatus } = parse(z.object({ accountStatus: z.enum(['active', 'suspended']) }), req.body);
  checkId(req.params.id); notSelf(req);
  await User.updateOne({ _id: req.params.id, deletedAt: { $exists: false } }, { accountStatus });
  const u = await User.findOne({ _id: req.params.id, deletedAt: { $exists: false } });
  if (!u) throw new HttpError(404, 'User not found');
  await audit(req.user._id, 'user.status', 'User', u._id, { accountStatus });
  res.json({ success: true, user: u });
}));

r.delete('/users/:id', wrap(async (req, res) => {
  checkId(req.params.id);
  if (String(req.params.id) === String(req.user._id)) throw new HttpError(409, 'You cannot delete your own account');
  const u = await User.findOne({ _id: req.params.id, deletedAt: { $exists: false } });
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role === 'admin' && !(await User.exists({ _id: { $ne: u._id }, role: 'admin', accountStatus: 'active', deletedAt: { $exists: false } }))) {
    throw new HttpError(409, 'You cannot delete the last active administrator');
  }
  const [citizenRequests, assignedRequests] = await Promise.all([
    ServiceRequest.countDocuments({ citizen: u._id }),
    ServiceRequest.countDocuments({ assignedOfficer: u._id, status: { $nin: CLOSED } })
  ]);

  await Promise.all([
    ServiceRequest.updateMany({ assignedOfficer: u._id, status: { $nin: CLOSED } }, { $set: { assignedOfficer: null } }),
    Notification.deleteMany({ recipient: u._id }),
    PasswordReset.deleteMany({ user: u._id })
  ]);
  u.fullName = 'Deleted account';
  u.email = `deleted-${u._id}@deleted.invalid`;
  u.passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  u.accountStatus = 'suspended';
  u.emailVerified = false;
  u.emailNotifications = false;
  u.department = null;
  u.failedLogins = 0;
  u.lockUntil = undefined;
  u.acceptedTermsAt = undefined;
  u.deletedAt = new Date();
  u.phone = undefined;
  await u.save();

  await audit(req.user._id, 'user.delete', 'User', u._id, { role: u.role, citizenRequests, assignedRequests });
  res.json({ success: true, message: 'Account deleted. Existing request history has been retained with anonymized account details.' });
}));

// ---- reports ----
const reportQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), department: z.string().length(24).optional(), status: STATUS.optional() });
const dateRange = (q, field) => (q.from || q.to ? { [field]: { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: new Date(q.to.getTime() + DAY - 1) }) } } : {});
const baseMatch = (q) => ({ ...(q.department && { department: OID(q.department) }), ...(q.status && { status: q.status }), ...dateRange(q, 'submittedAt') });

r.get('/reports', wrap(async (req, res) => {
  const q = parse(reportQuery, req.query);
  const m = baseMatch(q);
  const dep = q.department ? { department: OID(q.department) } : {};
  const group = (field) => ServiceRequest.aggregate([{ $match: m }, { $group: { _id: field, n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  const [status, dept, svc, received, resolved, outstanding, awaiting, workload, avg] = await Promise.all([
    group('$status'), group('$department'), group('$service'),
    ServiceRequest.countDocuments(m),
    ServiceRequest.countDocuments({ ...dep, status: 'RESOLVED', ...dateRange(q, 'resolvedAt') }),
    ServiceRequest.countDocuments({ ...m, status: { $nin: CLOSED, ...(q.status && { $in: [q.status] }) } }),
    ServiceRequest.countDocuments({ ...m, status: 'AWAITING_INFORMATION' }),
    ServiceRequest.aggregate([{ $match: { ...dep, assignedOfficer: { $ne: null }, status: { $nin: CLOSED } } }, { $group: { _id: '$assignedOfficer', open: { $sum: 1 } } }, { $sort: { open: -1 } }]),
    ServiceRequest.find({ ...dep, status: 'RESOLVED', resolvedAt: { $ne: null }, ...dateRange(q, 'submittedAt') }).select('submittedAt resolvedAt').limit(20000).lean()
  ]);
  const [dn, sn, on] = await Promise.all([nameMap(Department, dept.map((x) => x._id)), nameMap(Service, svc.map((x) => x._id)), nameMap(User, workload.map((x) => x._id), 'fullName')]);
  res.json({
    success: true, filters: q,
    totals: { received, resolvedInRange: resolved, outstanding, awaitingInformation: awaiting, avgProcessingDays: avg.length ? +(avg.reduce((a, d) => a + (d.resolvedAt - d.submittedAt), 0) / avg.length / DAY).toFixed(1) : null },
    byStatus: status.map((x) => ({ name: x._id, count: x.n })),
    byDepartment: dept.map((x) => ({ name: dn.get(String(x._id)) || 'Unknown', count: x.n })),
    byService: svc.map((x) => ({ name: sn.get(String(x._id)) || 'Unknown', count: x.n })),
    officerWorkload: workload.map((x) => ({ name: on.get(String(x._id)) || 'Unknown', open: x.open }))
  });
}));

r.get('/reports/export', wrap(async (req, res) => {
  const q = parse(reportQuery, req.query);
  const rows = await ServiceRequest.find(baseMatch(q)).sort({ submittedAt: -1 }).limit(10000).select('referenceNumber service department status submittedAt resolvedAt assignedOfficer')
    .populate('service', 'name').populate('department', 'name').populate('assignedOfficer', 'fullName'); // no citizen personal data
  const head = ['Reference', 'Service', 'Department', 'Status', 'Submitted', 'Resolved', 'Assigned officer'];
  const lines = [head.map(csvCell).join(',')].concat(rows.map((x) => [x.referenceNumber, x.service?.name, x.department?.name, x.status, x.submittedAt?.toISOString(), x.resolvedAt?.toISOString(), x.assignedOfficer?.fullName].map(csvCell).join(',')));
  await audit(req.user._id, 'report.export', 'Report', 'requests', { rows: rows.length, filters: q });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="psrs-requests.csv"' }).send('\uFEFF' + lines.join('\r\n'));
}));

r.get('/audit-logs', wrap(async (req, res) => {
  const q = parse(pageQuery.extend({ action: z.string().max(60).optional() }), req.query);
  const filter = q.action ? { action: new RegExp('^' + escapeRegex(q.action)) } : {};
  res.json({ success: true, ...(await paginate(AuditLog, filter, q, { populate: [{ path: 'actor', select: 'fullName role' }] })) });
}));

r.patch('/users/:id/activate', wrap(async (req, res) => {
  checkId(req.params.id);
  await User.updateOne({ _id: req.params.id, deletedAt: { $exists: false } }, { emailVerified: true });
  const u = await User.findOne({ _id: req.params.id, deletedAt: { $exists: false } });
  if (!u) throw new HttpError(404, 'User not found');
  await audit(req.user._id, 'user.activate', 'User', u._id);
  res.json({ success: true, user: u });
}));
r.post('/users/:id/resend-activation', wrap(async (req, res) => {
  const u = await User.findOne({ _id: checkId(req.params.id), emailVerified: false, deletedAt: { $exists: false } });
  if (!u) throw new HttpError(404, 'This user does not need activation');
  const base = appUrl(req);
  if (!isEmailConfigured() || !base) throw new HttpError(409, 'Email is not configured, so use "Activate now" instead');
  const link = `${base}/activate.html?token=${await createToken(u._id, 'activation', 24 * 60)}`;
  const result = await sendTemplate('activation', u, { link });
  if (!result.sent) throw new HttpError(502, `Brevo could not send the email: ${result.error}`);
  await audit(req.user._id, 'user.resend_activation', 'User', u._id);
  res.json({ success: true });
}));

// ---- settings ----
const bool = z.boolean();
const settingsSchema = z.object({
  siteName: z.string().trim().min(2).max(40), tagline: z.string().trim().max(100), supportEmail: z.string().trim().email().or(z.literal('')), supportPhone: z.string().trim().max(30), announcement: z.string().trim().max(300),
  registrationOpen: bool, requireEmailVerification: bool, maintenanceMode: bool, allowCitizenCancel: bool, autoAssign: bool,
  maxAttachments: z.number().int().min(1).max(10),
  emailEnabled: bool, emailOnSubmit: bool, emailOnStatus: bool, emailOnComment: bool, emailOnAssign: bool
});
const emailInfo = () => ({ configured: isEmailConfigured(), senderEmail: process.env.BREVO_SENDER_EMAIL || '', senderName: process.env.BREVO_SENDER_NAME || '', appUrl: appUrl() || '' });
r.get('/settings', wrap(async (_req, res) => res.json({ success: true, settings: await getSettings(), email: emailInfo() })));
r.put('/settings', wrap(async (req, res) => {
  const d = parse(settingsSchema, req.body);
  const before = await getSettings();
  const settings = await saveSettings(d);
  const changed = Object.keys(DEFS).filter((k) => before[k] !== settings[k]);
  await audit(req.user._id, 'settings.update', 'Setting', 'site', { changed });
  res.json({ success: true, settings, email: emailInfo() });
}));
r.get('/email/status', wrap(async (_req, res) => res.json({ success: true, status: await checkBrevo(), ...emailInfo() })));
r.post('/email/test', wrap(async (req, res) => {
  const { to } = parse(z.object({ to: z.string().trim().toLowerCase().email() }), req.body);
  if (!isEmailConfigured()) throw new HttpError(409, 'Email is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL in your environment first');
  const result = await sendTemplate('test', { email: to, fullName: 'Administrator' });
  if (!result.sent) throw new HttpError(502, `Brevo could not send the email: ${result.error}`);
  await audit(req.user._id, 'email.test', 'Email', 'test');
  res.json({ success: true, message: `Test email sent to ${to}` });
}));

export default r;
