import mongoose from 'mongoose';
import { z } from 'zod';
import { Counter } from '../models/index.js';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function checkId(id) {
  if (typeof id !== 'string' || id.length !== 24 || !mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid id');
  return id;
}

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const details = {};
    for (const i of r.error.issues) details[i.path.join('.') || '_'] = i.message;
    throw new HttpError(422, 'Validation failed', details);
  }
  return r.data;
}

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

export async function paginate(model, filter, { page, limit }, { sort = { createdAt: -1 }, populate = [], select } = {}) {
  let q = model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
  if (select) q = q.select(select);
  for (const p of populate) q = q.populate(p);
  const [items, total] = await Promise.all([q, model.countDocuments(filter)]);
  return { items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

// Collision-resistant reference: atomic counter per year, never count()
export async function nextReference(year = new Date().getFullYear()) {
  const c = await Counter.findOneAndUpdate({ _id: `request-${year}` }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
  return `PSRS-${year}-${String(c.seq).padStart(6, '0')}`;
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Neutralise spreadsheet formula injection
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
