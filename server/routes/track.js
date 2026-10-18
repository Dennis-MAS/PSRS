import { Router } from 'express';
import { RequestStatusHistory, ServiceRequest } from '../models/index.js';
import { HttpError, wrap } from '../utils/helpers.js';
import { PUBLIC_STATUS } from '../services/workflow.js';
import { resetLimiter } from '../utils/limiters.js';

const r = Router();
// Anyone with a reference number can see its status. Only non-personal fields are returned.
r.get('/:reference', resetLimiter, wrap(async (req, res) => {
  const ref = String(req.params.reference).toUpperCase();
  if (!/^PSRS-\d{4}-\d{6}$/.test(ref)) throw new HttpError(404, 'No request found with that reference number');
  const doc = await ServiceRequest.findOne({ referenceNumber: ref }).populate('service', 'name').populate('department', 'name');
  if (!doc) throw new HttpError(404, 'No request found with that reference number');
  const history = await RequestStatusHistory.find({ request: doc._id }).sort({ createdAt: 1 }).select('newStatus createdAt');
  res.json({ success: true, tracking: {
    referenceNumber: doc.referenceNumber, category: doc.service?.name, department: doc.department?.name, status: doc.status,
    publicStatus: PUBLIC_STATUS[doc.status], submittedAt: doc.submittedAt, updatedAt: doc.updatedAt,
    history: history.map((h) => ({ status: h.newStatus, at: h.createdAt }))
  } });
}));
export default r;
