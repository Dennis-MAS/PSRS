import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });

export const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INFORMATION', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CANCELLED'];
export const ROLES = ['citizen', 'officer', 'admin'];

const userSchema = new Schema({
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  phone: { type: String, trim: true, maxlength: 20 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, default: 'citizen', index: true },
  department: ref('Department', { default: null }),
  accountStatus: { type: String, enum: ['active', 'suspended'], default: 'active' },
  acceptedTermsAt: Date,
  emailVerified: { type: Boolean, default: true }, // false only while an activation email is pending
  emailNotifications: { type: Boolean, default: true },
  failedLogins: { type: Number, default: 0 },
  lockUntil: Date,
  deletedAt: Date,
  profilePicture: { type: String, default: null }
}, { timestamps: true });
userSchema.set('toJSON', { transform: (_d, r) => { delete r.passwordHash; delete r.failedLogins; delete r.lockUntil; delete r.__v; return r; } });

const departmentSchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 500 },
  contactInformation: { type: String, trim: true, maxlength: 300 },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' }
}, { timestamps: true });

const serviceSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 150 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, required: true, maxlength: 600 },
  instructions: { type: String, maxlength: 2000 },
  department: ref('Department', { required: true, index: true }),
  requiredInformation: [{ type: String, maxlength: 200 }],
  allowedAttachmentTypes: { type: [String], default: ['application/pdf', 'image/jpeg', 'image/png'] },
  maximumAttachmentSize: { type: Number, default: 5 * 1024 * 1024 },
  estimatedProcessingDays: { type: Number, default: 7, min: 1 },
  icon: { type: String, default: '📄' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true }
}, { timestamps: true });
serviceSchema.index({ name: 'text', description: 'text' });

const requestSchema = new Schema({
  referenceNumber: { type: String, required: true, unique: true },
  citizen: ref('User', { required: true, index: true }),
  service: ref('Service', { required: true }),
  department: ref('Department', { required: true, index: true }),
  assignedOfficer: ref('User', { default: null, index: true }),
  title: { type: String, required: true, trim: true, maxlength: 150 },
  description: { type: String, required: true, maxlength: 4000 },
  location: { type: String, trim: true, maxlength: 200 },
  contactPreference: { type: String, enum: ['email', 'phone'], default: 'email' },
  status: { type: String, enum: STATUSES, default: 'SUBMITTED', index: true },
  resolutionSummary: { type: String, maxlength: 2000 },
  submittedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  submissionKey: String
}, { timestamps: true });
requestSchema.index({ citizen: 1, submissionKey: 1 }, { unique: true, partialFilterExpression: { submissionKey: { $type: 'string' } } });

const historySchema = new Schema({
  request: ref('ServiceRequest', { required: true, index: true }),
  previousStatus: String,
  newStatus: { type: String, required: true },
  changedBy: ref('User'),
  comment: String
}, { timestamps: { createdAt: true, updatedAt: false } });

const commentSchema = new Schema({
  request: ref('ServiceRequest', { required: true, index: true }),
  author: ref('User', { required: true }),
  comment: { type: String, required: true, maxlength: 2000 },
  visibility: { type: String, enum: ['internal', 'citizen'], required: true }
}, { timestamps: true });

const attachmentSchema = new Schema({
  request: ref('ServiceRequest', { required: true, index: true }),
  uploadedBy: ref('User', { required: true }),
  originalFilename: String,
  storedFilename: { type: String, required: true },
  mimeType: String,
  fileSize: Number,
  storagePath: { type: String, select: false }
}, { timestamps: { createdAt: true, updatedAt: false } });

const notificationSchema = new Schema({
  recipient: ref('User', { required: true, index: true }),
  request: ref('ServiceRequest'),
  title: { type: String, required: true },
  message: { type: String, required: true },
  readAt: Date
}, { timestamps: { createdAt: true, updatedAt: false } });

const auditSchema = new Schema({
  actor: ref('User'),
  action: { type: String, required: true, index: true },
  entityType: String,
  entityId: String,
  metadata: Schema.Types.Mixed
}, { timestamps: { createdAt: true, updatedAt: false } });

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const resetSchema = new Schema({
  user: ref('User', { required: true }),
  purpose: { type: String, enum: ['reset', 'activation'], default: 'reset' },
  tokenHash: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  usedAt: Date
});
const settingSchema = new Schema({ _id: String, value: String });

export const User = model('User', userSchema);
export const Department = model('Department', departmentSchema);
export const Service = model('Service', serviceSchema);
export const ServiceRequest = model('ServiceRequest', requestSchema);
export const RequestStatusHistory = model('RequestStatusHistory', historySchema);
export const RequestComment = model('RequestComment', commentSchema);
export const RequestAttachment = model('RequestAttachment', attachmentSchema);
export const Notification = model('Notification', notificationSchema);
export const AuditLog = model('AuditLog', auditSchema);
export const Counter = model('Counter', counterSchema);
export const PasswordReset = model('PasswordReset', resetSchema);
export const Setting = model('Setting', settingSchema);
