import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Department, Service } from '../models/index.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, checkId, escapeRegex, pageQuery, paginate, parse, wrap } from '../utils/helpers.js';
import { audit } from '../services/records.js';

export const services = Router();
export const departments = Router();
const admin = requireRole('admin');
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'service';
const MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const id24 = z.string().length(24);

const serviceBody = z.object({
  name: z.string().trim().min(3).max(150),
  description: z.string().trim().min(10).max(600),
  instructions: z.string().trim().max(2000).optional(),
  department: id24,
  requiredInformation: z.array(z.string().trim().min(1).max(200)).max(15).default([]),
  allowedAttachmentTypes: z.array(z.enum(MIME)).default(MIME),
  maximumAttachmentSizeMb: z.number().min(0.1).max(10).default(5),
  estimatedProcessingDays: z.number().int().min(1).max(365).default(7),
  icon: z.string().trim().max(8).optional()
});
const toDoc = (d) => { const { maximumAttachmentSizeMb, ...rest } = d; return { ...rest, maximumAttachmentSize: Math.round(maximumAttachmentSizeMb * 1048576) }; };

services.get('/', wrap(async (req, res) => {
  const q = parse(pageQuery.extend({ q: z.string().max(100).optional(), department: id24.optional(), includeInactive: z.enum(['0', '1']).optional() }), req.query);
  const filter = {};
  if (!(req.user?.role === 'admin' && q.includeInactive === '1')) filter.status = 'active';
  if (q.department) filter.department = q.department;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); filter.$or = [{ name: rx }, { description: rx }]; }
  res.json({ success: true, ...(await paginate(Service, filter, q, { sort: { name: 1 }, populate: [{ path: 'department', select: 'name' }] })) });
}));

services.get('/:id', wrap(async (req, res) => {
  const key = req.params.id;
  const s = await (/^[a-f\d]{24}$/i.test(key) ? Service.findById(key) : Service.findOne({ slug: String(key).toLowerCase() })).populate('department', 'name contactInformation');
  if (!s || (s.status !== 'active' && req.user?.role !== 'admin')) throw new HttpError(404, 'Service not found');
  res.json({ success: true, service: s });
}));

services.post('/', admin, wrap(async (req, res) => {
  const d = toDoc(parse(serviceBody, req.body));
  if (!(await Department.exists({ _id: d.department }))) throw new HttpError(422, 'Department not found', { department: 'Not found' });
  let slug = slugify(d.name);
  if (await Service.exists({ slug })) slug += '-' + crypto.randomBytes(2).toString('hex');
  const s = await Service.create({ ...d, slug });
  await audit(req.user._id, 'service.create', 'Service', s._id, { name: s.name });
  res.status(201).json({ success: true, service: s });
}));

services.patch('/:id', admin, wrap(async (req, res) => {
  const d = toDoc(parse(serviceBody.partial(), req.body));
  if (d.department && !(await Department.exists({ _id: d.department }))) throw new HttpError(422, 'Department not found', { department: 'Not found' });
  const s = await Service.findByIdAndUpdate(checkId(req.params.id), d, { returnDocument: 'after', runValidators: true });
  if (!s) throw new HttpError(404, 'Service not found');
  await audit(req.user._id, 'service.update', 'Service', s._id, { fields: Object.keys(d) });
  res.json({ success: true, service: s });
}));

services.patch('/:id/status', admin, wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['active', 'inactive']) }), req.body);
  const s = await Service.findByIdAndUpdate(checkId(req.params.id), { status }, { returnDocument: 'after' });
  if (!s) throw new HttpError(404, 'Service not found');
  await audit(req.user._id, 'service.status', 'Service', s._id, { status });
  res.json({ success: true, service: s });
}));

const deptBody = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).optional(), contactInformation: z.string().trim().max(300).optional() });

departments.get('/', wrap(async (req, res) => {
  const all = req.user?.role === 'admin' && req.query.includeInactive === '1';
  res.json({ success: true, items: await Department.find(all ? {} : { status: 'active' }).sort({ name: 1 }) });
}));
departments.post('/', admin, wrap(async (req, res) => {
  const d = await Department.create(parse(deptBody, req.body));
  await audit(req.user._id, 'department.create', 'Department', d._id, { name: d.name });
  res.status(201).json({ success: true, department: d });
}));
departments.patch('/:id', admin, wrap(async (req, res) => {
  const d = await Department.findByIdAndUpdate(checkId(req.params.id), parse(deptBody.partial(), req.body), { returnDocument: 'after', runValidators: true });
  if (!d) throw new HttpError(404, 'Department not found');
  await audit(req.user._id, 'department.update', 'Department', d._id);
  res.json({ success: true, department: d });
}));
departments.patch('/:id/status', admin, wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['active', 'inactive']) }), req.body);
  const d = await Department.findByIdAndUpdate(checkId(req.params.id), { status }, { returnDocument: 'after' });
  if (!d) throw new HttpError(404, 'Department not found');
  await audit(req.user._id, 'department.status', 'Department', d._id, { status });
  res.json({ success: true, department: d });
}));
