import { AuditLog, Notification, RequestStatusHistory, ServiceRequest, User } from '../models/index.js';
import { HttpError } from '../utils/helpers.js';
import { canTransition, NEEDS_COMMENT } from './workflow.js';
import { appUrl, isEmailConfigured, queueTemplate } from './email.js';
import { getSettings } from './settings.js';

export const audit = (actor, action, entityType, entityId, metadata = {}) =>
  AuditLog.create({ actor, action, entityType, entityId: String(entityId), metadata }).catch((e) => console.error('audit failed', e.message));

const EMAIL_TEMPLATE = { emailOnSubmit: 'requestSubmitted', emailOnStatus: 'statusChanged', emailOnComment: 'newComment', emailOnAssign: 'assigned' };

// In-app notification, plus an email when the admin setting, the user's preference and Brevo allow it.
export async function notify(recipient, request, title, message, emailKey, ctx = {}) {
  await Notification.create({ recipient, request, title, message }).catch((e) => console.error('notify failed', e.message));
  if (!emailKey) return;
  try {
    const cfg = await getSettings();
    if (!isEmailConfigured() || !cfg.emailEnabled || !cfg[emailKey]) return;
    const user = await User.findById(recipient).select('fullName email role accountStatus emailNotifications emailVerified');
    if (!user || user.accountStatus !== 'active' || user.emailNotifications === false || user.emailVerified === false) return;
    const base = appUrl();
    if (!base) return console.warn('[email] APP_URL is not set, skipping email');
    const url = `${base}/${user.role === 'citizen' ? 'citizen' : 'officer'}/request-details.html?id=${request}`;
    queueTemplate(EMAIL_TEMPLATE[emailKey], user, { ...ctx, url });
  } catch (e) { console.error('notify email failed', e.message); }
}

// Least-busy active officer of a department (used when "auto-assign" is on).
export async function pickLeastBusyOfficer(deptId) {
  const officers = await staffForDepartment(deptId);
  if (!officers.length) return null;
  const rows = await ServiceRequest.aggregate([{ $match: { assignedOfficer: { $in: officers.map((o) => o._id) }, status: { $nin: ['RESOLVED', 'REJECTED', 'CANCELLED'] } } }, { $group: { _id: '$assignedOfficer', n: { $sum: 1 } } }]);
  const load = new Map(rows.map((x) => [String(x._id), x.n]));
  return officers.sort((a, b) => (load.get(String(a._id)) || 0) - (load.get(String(b._id)) || 0))[0];
}

// Access rule shared by every request endpoint (applied inside the DB query)
export function requestScope(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'officer') {
    const or = [{ assignedOfficer: user._id }];
    if (user.department) or.push({ department: user.department });
    return { $or: or };
  }
  return { citizen: user._id };
}

export async function loadAuthorizedRequest(id, user) {
  const doc = await ServiceRequest.findOne({ _id: id, ...requestScope(user) });
  if (!doc) throw new HttpError(404, 'Request not found');
  return doc;
}

// Central status change. No transactions (standalone MongoDB): the request is
// updated first with an optimistic status filter, then dependent records are written.
export async function changeStatus(request, newStatus, actor, comment) {
  const from = request.status;
  if (!canTransition(from, newStatus)) throw new HttpError(409, `Cannot move a request from ${from} to ${newStatus}`);
  if (NEEDS_COMMENT.has(newStatus) && !comment?.trim()) throw new HttpError(422, 'A comment or reason is required for this status', { comment: 'Required' });
  const set = { status: newStatus };
  if (newStatus === 'RESOLVED') { set.resolvedAt = new Date(); set.resolutionSummary = comment; }
  const updated = await ServiceRequest.findOneAndUpdate({ _id: request._id, status: from }, set, { returnDocument: 'after' });
  if (!updated) throw new HttpError(409, 'Request was changed by someone else. Reload and try again');
  await RequestStatusHistory.create({ request: request._id, previousStatus: from, newStatus, changedBy: actor._id, comment });
  const titles = { UNDER_REVIEW: 'Request under review', IN_PROGRESS: 'Request in progress', AWAITING_INFORMATION: 'More information needed', RESOLVED: 'Request resolved', REJECTED: 'Request rejected', CANCELLED: 'Request cancelled' };
  const msg = `${updated.referenceNumber}: status is now ${newStatus.replace(/_/g, ' ').toLowerCase()}.${comment ? ' ' + comment : ''}`;
  const ctx = { reference: updated.referenceNumber, title: updated.title, status: newStatus, comment };
  if (String(actor._id) !== String(updated.citizen)) await notify(updated.citizen, updated._id, titles[newStatus] || 'Status updated', msg, 'emailOnStatus', ctx);
  else if (updated.assignedOfficer) await notify(updated.assignedOfficer, updated._id, titles[newStatus], msg, 'emailOnComment', { reference: updated.referenceNumber, comment: comment || msg, from: actor.fullName });
  await audit(actor._id, 'request.status', 'ServiceRequest', updated._id, { from, to: newStatus });
  return updated;
}

export const staffForDepartment = (deptId) => User.find({ role: 'officer', department: deptId, accountStatus: 'active' }).select('fullName email department').populate('department', 'name').sort({ fullName: 1 });
