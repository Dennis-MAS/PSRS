import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { z } from 'zod';
import { PasswordReset, User } from '../models/index.js';
import { csrfToken, requireAuth } from '../middleware/auth.js';
import { HttpError, parse, wrap } from '../utils/helpers.js';
import { loginLimiter, registerLimiter, resetLimiter } from '../utils/limiters.js';
import { audit } from '../services/records.js';
import { getSettings, isEmailConfigured } from '../services/settings.js';
import { appUrl, queueTemplate, sendTemplate } from '../services/email.js';

const r = Router();
const password = z.string().min(8, 'At least 8 characters').max(72, 'At most 72 characters')
  .regex(/[a-z]/, 'Add a lowercase letter').regex(/[A-Z]/, 'Add an uppercase letter').regex(/\d/, 'Add a number');
const phone = z.string().trim().regex(/^\+?[0-9\s-]{7,15}$/, 'Enter a valid phone number');
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email, phone: phone.optional().or(z.literal('')), password, confirmPassword: z.string(),
  acceptTerms: z.literal(true, { message: 'You must accept the Terms and Conditions' })
}).refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

const regen = (req) => new Promise((res, rej) => req.session.regenerate((e) => (e ? rej(e) : res())));
const login = async (req, user) => { await regen(req); req.session.userId = String(user._id); return csrfToken(req); };

// One live token per user and purpose; only a hash is stored.
export async function createToken(userId, purpose, minutes) {
  await PasswordReset.deleteMany({ user: userId, purpose, usedAt: null });
  const token = crypto.randomBytes(32).toString('hex');
  await PasswordReset.create({ user: userId, purpose, tokenHash: sha(token), expiresAt: new Date(Date.now() + minutes * 60000) });
  return token;
}
async function sendActivation(req, user) {
  const base = appUrl(req);
  if (!base) throw new HttpError(500, 'APP_URL is not configured, so activation links cannot be built');
  const token = await createToken(user._id, 'activation', 24 * 60);
  return (await sendTemplate('activation', user, { link: `${base}/activate.html?token=${token}` })).sent;
}

r.get('/csrf', (req, res) => res.json({ success: true, csrfToken: csrfToken(req) }));

r.post('/register', registerLimiter, wrap(async (req, res) => {
  const cfg = await getSettings();
  if (!cfg.registrationOpen) throw new HttpError(403, 'Registration is currently closed');
  const d = parse(registerSchema, req.body);
  if (await User.exists({ email: d.email })) throw new HttpError(409, 'An account with this email already exists', { email: 'Already registered' });
  // Activation needs working email; without Brevo configured accounts are active immediately.
  const needActivation = cfg.requireEmailVerification && isEmailConfigured();
  // role is never read from the request body
  const user = await User.create({ fullName: d.fullName, email: d.email, phone: d.phone || undefined, passwordHash: await bcrypt.hash(d.password, 12), role: 'citizen', acceptedTermsAt: new Date(), emailVerified: !needActivation });
  await audit(user._id, 'auth.register', 'User', user._id, { activationRequired: needActivation });
  if (needActivation) {
    const emailSent = await sendActivation(req, user);
    return res.status(201).json({ success: true, requiresActivation: true, emailSent, message: emailSent ? 'Check your email for the activation link.' : 'Your account was created but we could not send the activation email. Use “resend” or contact support.' });
  }
  const token = await login(req, user);
  const base = appUrl(req);
  if (base && isEmailConfigured() && cfg.emailEnabled) queueTemplate('welcome', user, { url: `${base}/citizen/dashboard.html` });
  res.status(201).json({ success: true, user, csrfToken: token });
}));

r.post('/login', loginLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ email, password: z.string().min(1).max(72), portal: z.enum(['citizen', 'staff']).optional() }), req.body);
  const user = await User.findOne({ email: d.email }).select('+passwordHash');
  const bad = () => new HttpError(401, 'Incorrect email or password');
  if (user?.lockUntil && user.lockUntil > new Date()) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes');
  const ok = await bcrypt.compare(d.password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      user.failedLogins += 1;
      if (user.failedLogins >= 5) { user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); user.failedLogins = 0; }
      await user.save();
    }
    throw bad();
  }
  if (user.accountStatus !== 'active') throw new HttpError(403, 'This account is suspended. Contact support');
  if (!user.emailVerified) throw new HttpError(403, 'Please activate your account first. We sent an activation link to your email', { activation: 'required' });
  // Citizens and staff sign in through separate portals (checked only after the password is correct).
  if (d.portal === 'citizen' && user.role !== 'citizen') throw new HttpError(403, 'This is the citizen login. Staff accounts must use the Staff Portal');
  if (d.portal === 'staff' && user.role === 'citizen') throw new HttpError(403, 'The Staff Portal is for officers and administrators. Please use the citizen login');
  user.failedLogins = 0; user.lockUntil = undefined; await user.save();
  const token = await login(req, user);
  await audit(user._id, 'auth.login', 'User', user._id);
  res.json({ success: true, user, csrfToken: token });
}));

r.post('/activate', resetLimiter, wrap(async (req, res) => {
  const { token } = parse(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid link') }), req.body);
  const rec = await PasswordReset.findOne({ tokenHash: sha(token), purpose: 'activation', usedAt: null, expiresAt: { $gt: new Date() } });
  if (!rec) throw new HttpError(400, 'This activation link is invalid or has expired. You can request a new one from the login page');
  const user = await User.findById(rec.user);
  if (!user) throw new HttpError(400, 'This activation link is invalid');
  user.emailVerified = true; await user.save();
  rec.usedAt = new Date(); await rec.save();
  await audit(user._id, 'auth.activate', 'User', user._id);
  const base = appUrl(req);
  if (base && isEmailConfigured()) queueTemplate('welcome', user, { url: `${base}/login.html` });
  res.json({ success: true, message: 'Your account is active. You can log in now.' });
}));

r.post('/resend-activation', resetLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ email }), req.body);
  const user = await User.findOne({ email: d.email, accountStatus: 'active', emailVerified: false });
  if (user && isEmailConfigured()) await sendActivation(req, user);
  res.json({ success: true, message: 'If that account is waiting for activation, a new link has been sent.' }); // same answer either way
}));

r.post('/logout', wrap(async (req, res) => {
  await new Promise((resolve) => req.session.destroy(resolve));
  res.clearCookie('psrs.sid');
  res.json({ success: true });
}));

r.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not signed in' });
  res.json({ success: true, user: req.user, csrfToken: csrfToken(req) });
});

r.patch('/me', requireAuth, wrap(async (req, res) => {
  const d = parse(z.object({ fullName: z.string().trim().min(2).max(120), phone: phone.optional().or(z.literal('')), emailNotifications: z.boolean().optional() }), req.body);
  req.user.fullName = d.fullName; req.user.phone = d.phone || undefined;
  if (d.emailNotifications !== undefined) req.user.emailNotifications = d.emailNotifications;
  await req.user.save();
  res.json({ success: true, user: req.user });
}));

r.post('/change-password', requireAuth, wrap(async (req, res) => {
  const d = parse(z.object({ currentPassword: z.string().min(1), newPassword: password }), req.body);
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await bcrypt.compare(d.currentPassword, user.passwordHash))) throw new HttpError(422, 'Current password is incorrect', { currentPassword: 'Incorrect' });
  user.passwordHash = await bcrypt.hash(d.newPassword, 12); await user.save();
  await audit(user._id, 'auth.password_change', 'User', user._id);
  res.json({ success: true });
}));

r.post('/forgot-password', resetLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ email }), req.body);
  const emailOn = isEmailConfigured();
  const out = { success: true, emailEnabled: emailOn, message: emailOn ? 'If that email is registered, we have sent a reset link. Check your inbox.' : 'If that email is registered, a reset link has been prepared.' };
  const user = await User.findOne({ email: d.email, accountStatus: 'active' });
  if (user) {
    const base = appUrl(req);
    const token = await createToken(user._id, 'reset', 30);
    const path = `/forgot-password.html?token=${token}`;
    if (emailOn && base) queueTemplate('reset', user, { link: base + path });
    else if (process.env.NODE_ENV !== 'production') { // no Brevo: log the link (and show it in development only)
      console.log(`[dev] password reset link for ${user.email}: ${path}`);
      if (process.env.NODE_ENV === 'development') out.devResetLink = path;
    }
  }
  res.json(out);
}));

r.post('/reset-password', resetLimiter, wrap(async (req, res) => {
  const d = parse(z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password, confirmPassword: z.string() })
    .refine((x) => x.password === x.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }), req.body);
  const rec = await PasswordReset.findOne({ tokenHash: sha(d.token), purpose: 'reset', usedAt: null, expiresAt: { $gt: new Date() } });
  if (!rec) throw new HttpError(400, 'This reset link is invalid or has expired');
  const user = await User.findById(rec.user);
  user.passwordHash = await bcrypt.hash(d.password, 12); user.emailVerified = true; await user.save(); // following the emailed link proves ownership
  rec.usedAt = new Date(); await rec.save();
  await audit(user._id, 'auth.password_reset', 'User', user._id);
  res.json({ success: true, message: 'Password updated. You can now log in.' });
}));

export default r;
