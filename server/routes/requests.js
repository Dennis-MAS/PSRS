import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { RequestAttachment, RequestComment, RequestStatusHistory, Service, ServiceRequest } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError, checkId, escapeRegex, nextReference, pageQuery, paginate, parse, wrap } from '../utils/helpers.js';
import { audit, changeStatus, loadAuthorizedRequest, notify, pickLeastBusyOfficer } from '../services/records.js';
import { getSettings } from '../services/settings.js';

const r = Router();
r.use(requireAuth);
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'storage/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const CLOSED = ['RESOLVED', 'REJECTED', 'CANCELLED'];

const createSchema = z.object({
  service: z.string().length(24),
  title: z.string().trim().min(3, 'At least 3 characters').max(150),
  description: z.string().trim().min(10, 'Describe the request in at least 10 characters').max(4000),
  location: z.string().trim().max(200).optional(),
  contactPreference: z.enum(['email', 'phone']).default('email'),
  declaration: z.literal(true, { message: 'You must confirm the information is accurate' }),
  submissionKey: z.string().min(8).max(64).optional()
});

r.post('/', requireRole('citizen'), wrap(async (req, res) => {
  const cfg = await getSettings();
  if (cfg.maintenanceMode) throw new HttpError(503, 'The system is in maintenance mode. Please try again later');
  const d = parse(createSchema, req.body);
  if (d.submissionKey) { // duplicate-submission protection
    const dup = await ServiceRequest.findOne({ citizen: req.user._id, submissionKey: d.submissionKey });
    if (dup) return res.json({ success: true, duplicate: true, request: dup });
  }
  const service = await Service.findById(d.service).populate('department');
  if (!service || service.status !== 'active' || service.department?.status !== 'active') throw new HttpError(422, 'This service is not accepting requests', { service: 'Service unavailable' });
  const request = await ServiceRequest.create({
    referenceNumber: await nextReference(), citizen: req.user._id, service: service._id, department: service.department._id,
    title: d.title, description: d.description, location: d.location, contactPreference: d.contactPreference, submissionKey: d.submissionKey
  });
  try {
    await RequestStatusHistory.create({ request: request._id, previousStatus: null, newStatus: 'SUBMITTED', changedBy: req.user._id, comment: 'Request submitted' });
  } catch (e) { await ServiceRequest.deleteOne({ _id: request._id }); throw e; } // compensate partial failure
  await notify(req.user._id, request._id, 'Request submitted', `${request.referenceNumber} was received for ${service.name}.`, 'emailOnSubmit', { reference: request.referenceNumber, title: request.title, category: service.name });
  if (cfg.autoAssign) { // give the request to the least busy officer of the department
    const officer = await pickLeastBusyOfficer(service.department._id);
    if (officer) { request.assignedOfficer = officer._id; await request.save(); await notify(officer._id, request._id, 'Request assigned to you', `${request.referenceNumber} was assigned to you automatically.`, 'emailOnAssign', { reference: request.referenceNumber, title: request.title }); }
  }
  await audit(req.user._id, 'request.create', 'ServiceRequest', request._id, { reference: request.referenceNumber });
  res.status(201).json({ success: true, request });
}));

const myQuery = pageQuery.extend({
  q: z.string().max(100).optional(),
  status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CANCELLED']).optional(),
  sort: z.enum(['submittedAt', 'updatedAt']).default('submittedAt'),
  dir: z.enum(['asc', 'desc']).default('desc')
});

r.get('/my', requireRole('citizen'), wrap(async (req, res) => {
  const q = parse(myQuery, req.query);
  const filter = { citizen: req.user._id };
  if (q.status) filter.status = q.status;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); filter.$or = [{ referenceNumber: rx }, { title: rx }]; }
  res.json({ success: true, ...(await paginate(ServiceRequest, filter, q, { sort: { [q.sort]: q.dir === 'asc' ? 1 : -1 }, populate: [{ path: 'service', select: 'name icon' }, { path: 'department', select: 'name' }] })) });
}));

r.get('/my/stats', requireRole('citizen'), wrap(async (req, res) => {
  const rows = await ServiceRequest.aggregate([{ $match: { citizen: req.user._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const stats = { total: 0, SUBMITTED: 0, UNDER_REVIEW: 0, AWAITING_INFORMATION: 0, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 0, CANCELLED: 0 };
  for (const x of rows) { stats[x._id] = x.n; stats.total += x.n; }
  res.json({ success: true, stats });
}));

r.get('/:id', wrap(async (req, res) => {
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  const staff = req.user.role !== 'citizen';
  const commentFilter = { request: doc._id, ...(staff ? {} : { visibility: 'citizen' }) };
  const [full, history, comments, attachments] = await Promise.all([
    ServiceRequest.findById(doc._id).populate('service', 'name icon instructions').populate('department', 'name').populate('assignedOfficer', 'fullName')
      .populate('citizen', staff ? 'fullName email phone' : 'fullName'),
    RequestStatusHistory.find({ request: doc._id }).sort({ createdAt: 1 }).populate('changedBy', 'fullName role'),
    RequestComment.find(commentFilter).sort({ createdAt: 1 }).populate('author', 'fullName role'),
    RequestAttachment.find({ request: doc._id }).sort({ createdAt: 1 })
  ]);
  // internal staff notes never reach citizens; internal-only history comments are not stored
  res.json({ success: true, request: full, history, comments, attachments });
}));

r.get('/:id/history', wrap(async (req, res) => {
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  res.json({ success: true, items: await RequestStatusHistory.find({ request: doc._id }).sort({ createdAt: 1 }).populate('changedBy', 'fullName role') });
}));

r.get('/:id/summary', wrap(async (req, res) => {
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  const full = await ServiceRequest.findById(doc._id).populate('service', 'name').populate('department', 'name');
  const text = [
    'PUBLIC SERVICE REQUEST SYSTEM - REQUEST SUMMARY', '',
    `Reference:   ${full.referenceNumber}`, `Service:     ${full.service?.name}`, `Department:  ${full.department?.name}`,
    `Status:      ${full.status}`, `Submitted:   ${full.submittedAt.toISOString()}`, `Title:       ${full.title}`, '', full.description
  ].join('\n');
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${full.referenceNumber}.txt"` }).send(text);
}));

const commentSchema = z.object({ comment: z.string().trim().min(1, 'Write a comment').max(2000), visibility: z.enum(['citizen', 'internal']).optional() });
r.post('/:id/comments', wrap(async (req, res) => {
  const d = parse(commentSchema, req.body);
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  const staff = req.user.role !== 'citizen';
  if (!staff && CLOSED.includes(doc.status)) throw new HttpError(409, 'This request is closed');
  const c = await RequestComment.create({ request: doc._id, author: req.user._id, comment: d.comment, visibility: staff ? (d.visibility || 'citizen') : 'citizen' });
  if (!staff) {
    if (doc.status === 'AWAITING_INFORMATION') await changeStatus(doc, 'UNDER_REVIEW', req.user, d.comment); // citizen reply reopens review
    else if (doc.assignedOfficer) await notify(doc.assignedOfficer, doc._id, 'Citizen reply', `${doc.referenceNumber}: ${d.comment.slice(0, 120)}`, 'emailOnComment', { reference: doc.referenceNumber, comment: d.comment, from: req.user.fullName });
  } else if (c.visibility === 'citizen') await notify(doc.citizen, doc._id, 'New comment on your request', `${doc.referenceNumber}: ${d.comment.slice(0, 120)}`, 'emailOnComment', { reference: doc.referenceNumber, comment: d.comment, from: req.user.fullName });
  await audit(req.user._id, 'request.comment', 'ServiceRequest', doc._id, { visibility: c.visibility });
  res.status(201).json({ success: true, comment: c });
}));

r.post('/:id/cancel', requireRole('citizen'), wrap(async (req, res) => {
  if (!(await getSettings()).allowCitizenCancel) throw new HttpError(403, 'Cancelling requests is turned off by the administrator');
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  if (doc.status !== 'SUBMITTED') throw new HttpError(409, 'Only requests that have not started review can be cancelled');
  res.json({ success: true, request: await changeStatus(doc, 'CANCELLED', req.user, req.body?.reason) });
}));

// ---- attachments ----
const SIGNATURES = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }
];
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (_q, _f, cb) => cb(null, crypto.randomUUID()) }),
  limits: { fileSize: 10 * 1048576, files: 1 }
}).single('file');
const cleanName = (n) => path.basename(String(n || 'file')).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';

r.post('/:id/attachments', requireRole('citizen'), wrap(async (req, _res, next) => {
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user); // ownership checked before any file is written
  if (CLOSED.includes(doc.status)) throw new HttpError(409, 'This request is closed');
  req.targetRequest = doc; next();
}), (req, res, next) => upload(req, res, next), wrap(async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(422, 'Choose a file to upload', { file: 'Required' });
  const reject = async (msg) => { await fs.promises.unlink(file.path).catch(() => {}); throw new HttpError(422, msg, { file: msg }); };
  const doc = req.targetRequest;
  const service = await Service.findById(doc.service);
  const fd = await fs.promises.open(file.path, 'r'); const head = Buffer.alloc(8); await fd.read(head, 0, 8, 0); await fd.close();
  const sig = SIGNATURES.find((s) => s.test(head));
  if (!sig) await reject('Only PDF, JPEG and PNG files are allowed');
  if (!service.allowedAttachmentTypes.includes(sig.mime)) await reject('This file type is not allowed for this service');
  if (file.size > service.maximumAttachmentSize) await reject(`File exceeds the ${(service.maximumAttachmentSize / 1048576).toFixed(1)} MB limit`);
  const maxFiles = (await getSettings()).maxAttachments;
  if ((await RequestAttachment.countDocuments({ request: doc._id })) >= maxFiles) await reject(`A request can have at most ${maxFiles} attachments`);
  const a = await RequestAttachment.create({ request: doc._id, uploadedBy: req.user._id, originalFilename: cleanName(file.originalname), storedFilename: file.filename, mimeType: sig.mime, fileSize: file.size, storagePath: `uploads/${file.filename}` });
  await audit(req.user._id, 'attachment.upload', 'ServiceRequest', doc._id, { attachment: a._id });
  const { storagePath, ...safe } = a.toObject(); // never expose server paths
  res.status(201).json({ success: true, attachment: safe });
}));

r.get('/:id/attachments/:aid', wrap(async (req, res) => {
  const doc = await loadAuthorizedRequest(checkId(req.params.id), req.user);
  const a = await RequestAttachment.findOne({ _id: checkId(req.params.aid), request: doc._id });
  if (!a) throw new HttpError(404, 'Attachment not found');
  const abs = path.join(UPLOAD_DIR, path.basename(a.storedFilename)); // basename blocks traversal
  if (!abs.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(abs)) throw new HttpError(404, 'File is no longer available');
  res.set({ 'Content-Type': a.mimeType, 'X-Content-Type-Options': 'nosniff' });
  res.attachment(a.originalFilename);
  res.sendFile(abs);
}));

export default r;
