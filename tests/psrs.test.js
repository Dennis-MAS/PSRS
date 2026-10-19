import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { createApp } from '../server/app.js';
import { connectDatabase } from '../server/config/database.js';
import { csvCell, nextReference } from '../server/utils/helpers.js';
import { canTransition } from '../server/services/workflow.js';
import { flushEmails, sendTemplate } from '../server/services/email.js';
import * as M from '../server/models/index.js';

const PASS = 'Passw0rd!x';
let app; const fx = {};

class Client {
  constructor() { this.a = request.agent(app); }
  async init() { this.t = (await this.a.get('/api/v1/auth/csrf')).body.csrfToken; return this; }
  get(p) { return this.a.get(p); }
  send(method, p, body) { return this.a[method](p).set('X-CSRF-Token', this.t).send(body); }
  post(p, b) { return this.send('post', p, b); }
  patch(p, b) { return this.send('patch', p, b); }
  async login(email, password = PASS) { const r = await this.post('/api/v1/auth/login', { email, password }); if (r.body.csrfToken) this.t = r.body.csrfToken; return r; }
}
const as = async (email) => { const c = await new Client().init(); const r = await c.login(email); expect(r.status).toBe(200); return c; };
const newReq = (c, over = {}) => c.post('/api/v1/requests', { service: String(fx.svcA._id), title: 'Broken street light', description: 'The street light outside my house has been broken for a week.', declaration: true, ...over });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/psrs_test');
  await mongoose.connection.dropDatabase();
  app = createApp();
  const passwordHash = await bcrypt.hash(PASS, 4);
  fx.deptA = await M.Department.create({ name: 'Dept A' });
  fx.deptB = await M.Department.create({ name: 'Dept B' });
  fx.svcA = await M.Service.create({ name: 'Service A', slug: 'service-a', description: 'Service for department A testing', department: fx.deptA._id });
  fx.svcOff = await M.Service.create({ name: 'Service Off', slug: 'service-off', description: 'Inactive service for testing', department: fx.deptA._id, status: 'inactive' });
  const mk = (n, role, department) => M.User.create({ fullName: n, email: `${n}@t.test`, role, department, passwordHash });
  fx.admin = await mk('admin', 'admin'); fx.offA = await mk('offa', 'officer', fx.deptA._id); fx.offB = await mk('offb', 'officer', fx.deptB._id);
  fx.c1 = await mk('citizen1', 'citizen'); fx.c2 = await mk('citizen2', 'citizen');
});
afterAll(async () => { await mongoose.disconnect(); });

describe('authentication', () => {
  it('registers citizens only, ignoring a supplied role, and hashes the password', async () => {
    const c = await new Client().init();
    const r = await c.post('/api/v1/auth/register', { fullName: 'New Person', email: 'New@T.test', password: PASS, confirmPassword: PASS, acceptTerms: true, role: 'admin' });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('citizen');
    expect(r.body.user.passwordHash).toBeUndefined();
    const u = await M.User.findOne({ email: 'new@t.test' }).select('+passwordHash');
    expect(u.passwordHash).not.toContain(PASS);
    expect(await bcrypt.compare(PASS, u.passwordHash)).toBe(true);
  });
  it('rejects duplicate emails and weak passwords', async () => {
    const c = await new Client().init();
    expect((await c.post('/api/v1/auth/register', { fullName: 'Dup', email: 'citizen1@t.test', password: PASS, confirmPassword: PASS, acceptTerms: true })).status).toBe(409);
    expect((await c.post('/api/v1/auth/register', { fullName: 'Weak', email: 'weak@t.test', password: 'abc', confirmPassword: 'abc' })).status).toBe(422);
  });
  it('requires accepting the terms to register', async () => {
    const c = await new Client().init();
    const r = await c.post('/api/v1/auth/register', { fullName: 'No Terms', email: 'noterms@t.test', password: PASS, confirmPassword: PASS });
    expect(r.status).toBe(422); expect(r.body.errors.acceptTerms).toBeTruthy();
    expect(await M.User.countDocuments({ email: 'noterms@t.test' })).toBe(0);
    expect((await M.User.findOne({ email: 'new@t.test' })).acceptedTermsAt).toBeTruthy();
  });
  it('keeps citizen and staff logins separate', async () => {
    const c = await new Client().init();
    expect((await c.login('offa@t.test', PASS).then(() => c.post('/api/v1/auth/login', { email: 'offa@t.test', password: PASS, portal: 'citizen' }))).status).toBe(403);
    expect((await c.post('/api/v1/auth/login', { email: 'admin@t.test', password: PASS, portal: 'citizen' })).status).toBe(403);
    expect((await c.post('/api/v1/auth/login', { email: 'citizen1@t.test', password: PASS, portal: 'staff' })).status).toBe(403);
    const staffOk = await c.post('/api/v1/auth/login', { email: 'offa@t.test', password: PASS, portal: 'staff' });
    expect(staffOk.status).toBe(200); c.t = staffOk.body.csrfToken; // a successful login rotates the CSRF token
    expect((await c.post('/api/v1/auth/login', { email: 'citizen1@t.test', password: PASS, portal: 'citizen' })).status).toBe(200);
  });
  it('logs in, returns the session user, and logs out', async () => {
    const c = await new Client().init();
    const bad = await c.login('citizen1@t.test', 'wrong');
    expect(bad.status).toBe(401); expect(bad.body.message).toBe('Incorrect email or password');
    expect((await c.login('nobody@t.test')).body.message).toBe('Incorrect email or password');
    expect((await c.login('citizen1@t.test')).status).toBe(200);
    expect((await c.get('/api/v1/auth/me')).body.user.email).toBe('citizen1@t.test');
    await c.post('/api/v1/auth/logout', {});
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });
  it('blocks state changes without a CSRF token and rejects operator objects', async () => {
    const c = await new Client().init();
    expect((await c.a.post('/api/v1/auth/login').send({ email: 'citizen1@t.test', password: PASS })).status).toBe(403);
    expect((await c.post('/api/v1/auth/login', { email: { $ne: '' }, password: { $ne: '' } })).status).toBe(422);
  });
});

describe('request lifecycle', () => {
  it('creates requests with unique sequential references, history and notification', async () => {
    const c = await as('citizen1@t.test');
    const a = await newReq(c); const b = await newReq(c, { title: 'Second request' });
    expect(a.status).toBe(201);
    expect(a.body.request.referenceNumber).toMatch(/^PSRS-\d{4}-\d{6}$/);
    expect(a.body.request.referenceNumber).not.toBe(b.body.request.referenceNumber);
    expect(await M.RequestStatusHistory.countDocuments({ request: a.body.request._id })).toBe(1);
    expect(await M.Notification.countDocuments({ recipient: fx.c1._id, request: a.body.request._id })).toBe(1);
    fx.req = a.body.request;
  });
  it('protects against duplicate submissions and inactive services', async () => {
    const c = await as('citizen1@t.test');
    const k = 'dup-key-12345678';
    const one = await newReq(c, { submissionKey: k }); const two = await newReq(c, { submissionKey: k });
    expect(two.body.duplicate).toBe(true);
    expect(two.body.request._id).toBe(one.body.request._id);
    expect((await newReq(c, { service: String(fx.svcOff._id) })).status).toBe(422);
    expect((await newReq(c, { declaration: false })).status).toBe(422);
  });
  it('enforces ownership', async () => {
    const other = await as('citizen2@t.test');
    expect((await other.get(`/api/v1/requests/${fx.req._id}`)).status).toBe(404);
    expect((await other.get('/api/v1/requests/my')).body.items.length).toBe(0);
    const mine = await as('citizen1@t.test');
    expect((await mine.get(`/api/v1/requests/${fx.req._id}`)).status).toBe(200);
    expect((await mine.get('/api/v1/requests/my/stats')).body.stats.total).toBeGreaterThanOrEqual(3);
  });
  it('restricts officers to their department', async () => {
    const a = await as('offa@t.test'); const b = await as('offb@t.test');
    expect((await a.get(`/api/v1/requests/${fx.req._id}`)).status).toBe(200);
    expect((await b.get(`/api/v1/requests/${fx.req._id}`)).status).toBe(404);
    expect((await b.get('/api/v1/officer/requests')).body.items.length).toBe(0);
    expect((await b.patch(`/api/v1/officer/requests/${fx.req._id}/status`, { status: 'UNDER_REVIEW' })).status).toBe(404);
  });
  it('validates status transitions, comments and writes history + notifications', async () => {
    expect(canTransition('SUBMITTED', 'RESOLVED')).toBe(false);
    const o = await as('offa@t.test'); const id = fx.req._id; const url = `/api/v1/officer/requests/${id}/status`;
    expect((await o.patch(url, { status: 'RESOLVED', comment: 'x' })).status).toBe(409);
    const ok = await o.patch(url, { status: 'UNDER_REVIEW' });
    expect(ok.status).toBe(200); expect(String(ok.body.request.assignedOfficer)).toBe(String(fx.offA._id));
    expect((await o.patch(url, { status: 'AWAITING_INFORMATION' })).status).toBe(422);
    expect((await o.patch(url, { status: 'AWAITING_INFORMATION', comment: 'Please send your ID number' })).status).toBe(200);
    expect(await M.RequestStatusHistory.countDocuments({ request: id })).toBe(3);
    expect(await M.Notification.countDocuments({ recipient: fx.c1._id, request: id, title: 'More information needed' })).toBe(1);
  });
  it('hides internal notes from citizens and reopens review on citizen reply', async () => {
    const o = await as('offa@t.test'); const id = fx.req._id;
    expect((await o.post(`/api/v1/officer/requests/${id}/internal-notes`, { comment: 'SECRET staff note' })).status).toBe(201);
    await o.post(`/api/v1/requests/${id}/comments`, { comment: 'Public staff comment', visibility: 'citizen' });
    const c = await as('citizen1@t.test');
    const detail = await c.get(`/api/v1/requests/${id}`);
    expect(JSON.stringify(detail.body)).not.toContain('SECRET');
    expect(detail.body.comments.some((x) => x.comment === 'Public staff comment')).toBe(true);
    const reply = await c.post(`/api/v1/requests/${id}/comments`, { comment: 'My ID is attached below' });
    expect(reply.status).toBe(201);
    expect((await c.get(`/api/v1/requests/${id}`)).body.request.status).toBe('UNDER_REVIEW');
    expect(JSON.stringify((await o.get(`/api/v1/requests/${id}`)).body)).toContain('SECRET');
  });
  it('only lets citizens cancel untouched requests', async () => {
    const c = await as('citizen1@t.test');
    const fresh = (await newReq(c, { title: 'Cancel me please' })).body.request;
    expect((await c.post(`/api/v1/requests/${fresh._id}/cancel`, {})).status).toBe(200);
    expect((await c.post(`/api/v1/requests/${fx.req._id}/cancel`, {})).status).toBe(409);
  });
  it('lets officers assign only same-department officers', async () => {
    const o = await as('offa@t.test');
    expect((await o.patch(`/api/v1/officer/requests/${fx.req._id}/assign`, { officerId: String(fx.offB._id) })).status).toBe(422);
    expect((await o.patch(`/api/v1/officer/requests/${fx.req._id}/assign`, { officerId: String(fx.offA._id) })).status).toBe(200);
  });
});

describe('authorization', () => {
  it('rejects anonymous and wrong-role access on the server', async () => {
    const anon = await new Client().init();
    expect((await anon.get('/api/v1/requests/my')).status).toBe(401);
    expect((await anon.get('/api/v1/admin/dashboard')).status).toBe(401);
    const c = await as('citizen1@t.test'); const o = await as('offa@t.test');
    expect((await c.get('/api/v1/admin/users')).status).toBe(403);
    expect((await c.get('/api/v1/officer/requests')).status).toBe(403);
    expect((await o.get('/api/v1/admin/reports')).status).toBe(403);
    expect((await o.post('/api/v1/requests', {})).status).toBe(403);
    expect((await c.post('/api/v1/services', { name: 'Hack' })).status).toBe(403);
  });
  it('stops admins from changing their own role', async () => {
    const a = await as('admin@t.test');
    expect((await a.patch(`/api/v1/admin/users/${fx.admin._id}/role`, { role: 'citizen' })).status).toBe(409);
  });
});

describe('notifications', () => {
  it('lists own notifications, counts unread, marks read and enforces ownership', async () => {
    const c = await as('citizen1@t.test'); const o = await as('citizen2@t.test');
    const list = await c.get('/api/v1/notifications');
    expect(list.body.unread).toBeGreaterThan(0);
    const id = list.body.items[0]._id;
    expect((await o.patch(`/api/v1/notifications/${id}/read`, {})).status).toBe(404);
    expect((await c.patch(`/api/v1/notifications/${id}/read`, {})).status).toBe(200);
    await c.patch('/api/v1/notifications/read-all', {});
    expect((await c.get('/api/v1/notifications')).body.unread).toBe(0);
  });
});

describe('services and departments', () => {
  it('lets admins create and deactivate services; inactive ones disappear from the public list', async () => {
    const a = await as('admin@t.test'); const pub = await new Client().init();
    const made = await a.post('/api/v1/services', { name: 'Brand New Service', description: 'A brand new demonstration service', department: String(fx.deptA._id) });
    expect(made.status).toBe(201);
    expect((await pub.get('/api/v1/services?q=Brand')).body.items.length).toBe(1);
    await a.patch(`/api/v1/services/${made.body.service._id}/status`, { status: 'inactive' });
    expect((await pub.get('/api/v1/services?q=Brand')).body.items.length).toBe(0);
    expect((await a.post('/api/v1/departments', { name: 'Dept C' })).status).toBe(201);
  });
});

describe('admin account deletion', () => {
  it('anonymizes the account, retains request history and clears active assignments', async () => {
    const admin = await as('admin@t.test');
    const passwordHash = await bcrypt.hash(PASS, 4);
    const person = await M.User.create({ fullName: 'History Person', email: 'history@t.test', role: 'citizen', passwordHash });
    const req = await M.ServiceRequest.create({
      referenceNumber: await nextReference(), citizen: person._id, service: fx.svcA._id, department: fx.deptA._id,
      assignedOfficer: fx.offA._id, title: 'Keep this case', description: 'This request should remain after account deletion.', status: 'SUBMITTED'
    });
    const history = await M.RequestStatusHistory.create({ request: req._id, newStatus: 'SUBMITTED', changedBy: person._id, comment: 'Original submission' });
    const comment = await M.RequestComment.create({ request: req._id, author: person._id, comment: 'Retain this comment.', visibility: 'citizen' });
    await M.Notification.create({ recipient: person._id, request: req._id, title: 'Private notification', message: 'Remove with deleted account.' });
    await M.PasswordReset.create({ user: person._id, tokenHash: 'hashed-token', expiresAt: new Date(Date.now() + 60000) });

    expect((await admin.send('delete', `/api/v1/admin/users/${person._id}`)).status).toBe(200);
    const anonymized = await M.User.findById(person._id);
    expect(anonymized.fullName).toBe('Deleted account');
    expect(anonymized.email).toBe(`deleted-${person._id}@deleted.invalid`);
    expect(anonymized.phone).toBeUndefined();
    expect(anonymized.deletedAt).toBeInstanceOf(Date);
    expect(anonymized.accountStatus).toBe('suspended');
    expect(await M.User.findOne({ email: person.email })).toBeNull();

    const retained = await M.ServiceRequest.findById(req._id);
    expect(retained).toBeTruthy();
    expect(String(retained.citizen)).toBe(String(person._id));
    expect(retained.assignedOfficer).toBeNull();
    expect(await M.RequestStatusHistory.exists({ _id: history._id })).toBeTruthy();
    expect(await M.RequestComment.exists({ _id: comment._id })).toBeTruthy();
    expect(await M.Notification.countDocuments({ recipient: person._id })).toBe(0);
    expect(await M.PasswordReset.countDocuments({ user: person._id })).toBe(0);
    expect((await admin.send('delete', `/api/v1/admin/users/${fx.admin._id}`)).status).toBe(409);
  });
});

describe('attachments', () => {
  it('accepts a real PNG, rejects disguised executables, and restricts downloads to authorised users', async () => {
    const c = await as('citizen1@t.test'); const id = fx.req._id;
    const good = await c.a.post(`/api/v1/requests/${id}/attachments`).set('X-CSRF-Token', c.t).attach('file', PNG, { filename: 'id.png', contentType: 'image/png' });
    expect(good.status).toBe(201);
    expect(good.body.attachment.storagePath).toBeUndefined();
    const bad = await c.a.post(`/api/v1/requests/${id}/attachments`).set('X-CSRF-Token', c.t).attach('file', Buffer.from('MZ\x90\x00 fake exe'), { filename: 'evil.png', contentType: 'image/png' });
    expect(bad.status).toBe(422);
    const url = `/api/v1/requests/${id}/attachments/${good.body.attachment._id}`;
    expect((await c.get(url)).status).toBe(200);
    expect((await (await as('citizen2@t.test')).get(url)).status).toBe(404);
    expect((await (await new Client().init()).get(url)).status).toBe(401);
  });
});

describe('reports', () => {
  it('matches dashboard figures to the database and exports safe CSV without personal data', async () => {
    const a = await as('admin@t.test');
    const dash = await a.get('/api/v1/admin/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.metrics.total).toBe(await M.ServiceRequest.countDocuments());
    expect(dash.body.metrics.pendingReview).toBe(await M.ServiceRequest.countDocuments({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } }));
    const rep = await a.get('/api/v1/admin/reports');
    expect(rep.body.totals.received).toBe(dash.body.metrics.total);
    const csv = await a.get('/api/v1/admin/reports/export');
    expect(csv.status).toBe(200); expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('PSRS-'); expect(csv.text).not.toContain('citizen1@t.test');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect((await a.get('/api/v1/admin/audit-logs')).body.items.length).toBeGreaterThan(0);
  });
});

describe('exam features: public tracker and open vs resolved analytics', () => {
  it('shows only non-personal status data on the public tracker', async () => {
    const pub = await new Client().init();
    const ok = await pub.get(`/api/v1/track/${fx.req.referenceNumber}`);
    expect(ok.status).toBe(200);
    expect(['Pending', 'In Progress', 'Resolved', 'Closed']).toContain(ok.body.tracking.publicStatus);
    const raw = JSON.stringify(ok.body);
    expect(raw).not.toContain('citizen1@t.test'); expect(raw).not.toContain('street light');
    expect((await pub.get('/api/v1/track/PSRS-2026-999999')).status).toBe(404);
    expect((await pub.get('/api/v1/track/not-a-reference')).status).toBe(404);
  });
  it('reports open and resolved case counts that add up', async () => {
    const o = await as('offa@t.test'); const a = await as('admin@t.test');
    const c = await as('citizen1@t.test');
    const fresh = (await newReq(c, { title: 'Analytics case one' })).body.request;
    await o.patch(`/api/v1/officer/requests/${fresh._id}/status`, { status: 'UNDER_REVIEW' });
    await o.patch(`/api/v1/officer/requests/${fresh._id}/status`, { status: 'IN_PROGRESS' });
    expect((await o.patch(`/api/v1/officer/requests/${fresh._id}/status`, { status: 'RESOLVED', comment: 'Fixed the light' })).status).toBe(200);
    const d = (await a.get('/api/v1/admin/dashboard')).body;
    const m = d.metrics; const ov = d.charts.openVsResolved;
    expect(m.resolved).toBe(await M.ServiceRequest.countDocuments({ status: 'RESOLVED' }));
    expect(m.openCases).toBe(await M.ServiceRequest.countDocuments({ status: { $nin: ['RESOLVED', 'REJECTED', 'CANCELLED'] } }));
    expect(ov.open + ov.resolved + ov.closedOther).toBe(m.total);
    expect(m.resolutionRate).toBe(Math.round((m.resolved / m.total) * 100));
  });
});

// ---------- Brevo email, activation and admin settings ----------
describe('Brevo email, account activation and settings', () => {
  let sent = []; let mode = 'ok';
  const lastTo = (addr) => [...sent].reverse().find((m) => m.body.to?.[0]?.email === addr);
  const getSettingsAs = async (a) => (await a.get('/api/v1/admin/settings')).body.settings;
  const putSettings = async (over) => { const a = await as('admin@t.test'); const cur = await getSettingsAs(a); const r = await a.send('put', '/api/v1/admin/settings', { ...cur, ...over }); expect(r.status).toBe(200); return a; };

  beforeAll(() => {
    process.env.BREVO_API_KEY = 'test-key'; process.env.BREVO_SENDER_EMAIL = 'noreply@psrs.test'; process.env.BREVO_SENDER_NAME = 'PSRS Test';
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (mode === 'fail') return { ok: false, status: 401, json: async () => ({ message: 'Key not found' }) };
      sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body || '{}') });
      return { ok: true, status: 201, json: async () => ({ messageId: '<abc@brevo>' }) };
    });
  });
  afterAll(() => { vi.unstubAllGlobals(); delete process.env.BREVO_API_KEY; delete process.env.BREVO_SENDER_EMAIL; });

  it('sends through the Brevo HTTP API with the right headers and payload', async () => {
    sent = [];
    const r = await sendTemplate('test', { email: 'someone@x.test', fullName: 'Some One' });
    expect(r.sent).toBe(true);
    const m = sent[0];
    expect(m.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(m.headers['api-key']).toBe('test-key');
    expect(m.body.sender).toEqual({ name: 'PSRS Test', email: 'noreply@psrs.test' });
    expect(m.body.to[0].email).toBe('someone@x.test');
    expect(m.body.htmlContent).toContain('Email is working'); expect(m.body.textContent).toBeTruthy();
  });
  it('escapes user-provided text inside emails', async () => {
    sent = [];
    await sendTemplate('requestSubmitted', { email: 'a@x.test', fullName: 'A' }, { reference: 'PSRS-1', title: '<script>alert(1)</script>', category: 'C', url: 'http://x' });
    expect(sent[0].body.htmlContent).not.toContain('<script>alert'); expect(sent[0].body.htmlContent).toContain('&lt;script&gt;');
  });
  it('reports Brevo errors without throwing and logs them', async () => {
    mode = 'fail'; const r = await sendTemplate('test', { email: 'a@x.test', fullName: 'A' }); mode = 'ok';
    expect(r.sent).toBe(false); expect(r.error).toContain('Key not found');
    expect(await M.AuditLog.countDocuments({ action: 'email.failed' })).toBeGreaterThan(0);
  });

  it('requires account activation by email when enabled', async () => {
    await putSettings({ requireEmailVerification: true }); sent = [];
    const c = await new Client().init();
    const reg = await c.post('/api/v1/auth/register', { fullName: 'Act Ivate', email: 'activate@t.test', password: PASS, confirmPassword: PASS, acceptTerms: true });
    expect(reg.status).toBe(201); expect(reg.body.requiresActivation).toBe(true); expect(reg.body.emailSent).toBe(true);
    expect((await c.get('/api/v1/auth/me')).status).toBe(401); // not signed in until activated
    const mail = lastTo('activate@t.test'); expect(mail.body.subject).toContain('Activate');
    const token = mail.body.htmlContent.match(/activate\.html\?token=([a-f0-9]{64})/)[1];
    const blocked = await c.login('activate@t.test');
    expect(blocked.status).toBe(403); expect(blocked.body.errors.activation).toBe('required');
    expect((await c.post('/api/v1/auth/activate', { token: 'a'.repeat(64) })).status).toBe(400);
    expect((await c.post('/api/v1/auth/activate', { token })).status).toBe(200);
    expect((await c.post('/api/v1/auth/activate', { token })).status).toBe(400); // single use
    expect((await c.login('activate@t.test')).status).toBe(200);
    await flushEmails(); expect(lastTo('activate@t.test').body.subject).toContain('Welcome');
    await putSettings({ requireEmailVerification: false });
  });
  it('resends activation links and lets admins activate manually', async () => {
    await putSettings({ requireEmailVerification: true });
    const c = await new Client().init();
    await c.post('/api/v1/auth/register', { fullName: 'Re Send', email: 'resend@t.test', password: PASS, confirmPassword: PASS, acceptTerms: true });
    sent = []; expect((await c.post('/api/v1/auth/resend-activation', { email: 'resend@t.test' })).status).toBe(200);
    expect(lastTo('resend@t.test').body.subject).toContain('Activate');
    sent = []; await c.post('/api/v1/auth/resend-activation', { email: 'citizen1@t.test' }); expect(sent.length).toBe(0); // already active: no email, same answer
    const a = await as('admin@t.test'); const u = await M.User.findOne({ email: 'resend@t.test' });
    expect((await a.patch(`/api/v1/admin/users/${u._id}/activate`, {})).status).toBe(200);
    expect((await c.login('resend@t.test')).status).toBe(200);
    await putSettings({ requireEmailVerification: false });
  });
  it('emails a password reset link and lets the user choose a new password', async () => {
    sent = []; const c = await new Client().init();
    expect((await c.post('/api/v1/auth/forgot-password', { email: 'citizen2@t.test' })).status).toBe(200);
    await flushEmails(); const token = lastTo('citizen2@t.test').body.htmlContent.match(/token=([a-f0-9]{64})/)[1];
    expect((await c.post('/api/v1/auth/reset-password', { token, password: 'NewPassw0rd!', confirmPassword: 'NewPassw0rd!' })).status).toBe(200);
    expect((await c.login('citizen2@t.test', 'NewPassw0rd!')).status).toBe(200);
    await M.User.updateOne({ email: 'citizen2@t.test' }, { passwordHash: await bcrypt.hash(PASS, 4) });
  });
  it('emails new staff a link to set their own password', async () => {
    sent = []; const a = await as('admin@t.test');
    const r = await a.post('/api/v1/admin/users', { fullName: 'New Officer', email: 'newoff@t.test', password: 'Temp1234x', role: 'officer', department: String(fx.deptA._id) });
    expect(r.status).toBe(201); expect(r.body.invited).toBe(true);
    expect(lastTo('newoff@t.test').body.htmlContent).toContain('forgot-password.html?token=');
  });

  it('emails citizens about status changes, and honours switches and personal opt-out', async () => {
    const c = await as('citizen1@t.test'); const o = await as('offa@t.test');
    const req1 = (await newReq(c, { title: 'Email status test' })).body.request; await flushEmails();
    expect(lastTo('citizen1@t.test').body.subject).toContain('Request received');
    sent = []; await o.patch(`/api/v1/officer/requests/${req1._id}/status`, { status: 'UNDER_REVIEW' }); await flushEmails();
    expect(lastTo('citizen1@t.test').body.subject).toContain(req1.referenceNumber);
    await putSettings({ emailOnStatus: false }); sent = [];
    await o.patch(`/api/v1/officer/requests/${req1._id}/status`, { status: 'IN_PROGRESS' }); await flushEmails();
    expect(lastTo('citizen1@t.test')).toBeUndefined(); // admin switched this email off (in-app notice still created)
    await putSettings({ emailOnStatus: true });
    expect((await c.patch('/api/v1/auth/me', { fullName: 'Citizen One', emailNotifications: false })).status).toBe(200); sent = [];
    await o.patch(`/api/v1/officer/requests/${req1._id}/status`, { status: 'AWAITING_INFORMATION', comment: 'Send a photo' }); await flushEmails();
    expect(lastTo('citizen1@t.test')).toBeUndefined(); // citizen opted out
    await c.patch('/api/v1/auth/me', { fullName: 'Citizen One', emailNotifications: true });
    expect(await M.Notification.countDocuments({ recipient: fx.c1._id, request: req1._id })).toBeGreaterThanOrEqual(3);
  });
  it('closes registration and blocks new requests during maintenance', async () => {
    await putSettings({ registrationOpen: false });
    const c = await new Client().init();
    expect((await c.post('/api/v1/auth/register', { fullName: 'Late', email: 'late@t.test', password: PASS, confirmPassword: PASS, acceptTerms: true })).status).toBe(403);
    await putSettings({ registrationOpen: true, maintenanceMode: true });
    const cit = await as('citizen1@t.test');
    expect((await newReq(cit)).status).toBe(503);
    expect((await new Client().init().then((x) => x.get('/api/v1/settings/public'))).body.settings.maintenanceMode).toBe(true);
    await putSettings({ maintenanceMode: false });
  });
  it('applies the cancel switch, attachment limit and auto-assignment', async () => {
    const c = await as('citizen1@t.test');
    await putSettings({ allowCitizenCancel: false });
    const r1 = (await newReq(c, { title: 'Cancel switch test' })).body.request;
    expect((await c.post(`/api/v1/requests/${r1._id}/cancel`, {})).status).toBe(403);
    await putSettings({ allowCitizenCancel: true, maxAttachments: 1 });
    const up = () => c.a.post(`/api/v1/requests/${r1._id}/attachments`).set('X-CSRF-Token', c.t).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect((await up()).status).toBe(201); expect((await up()).status).toBe(422);
    await putSettings({ maxAttachments: 5, autoAssign: true });
    const auto = (await newReq(c, { title: 'Auto assign test' })).body.request;
    const least = await M.User.findOne({ email: 'newoff@t.test' }); // created earlier, has no open work yet, so it is the least busy
    expect(String((await M.ServiceRequest.findById(auto._id)).assignedOfficer)).toBe(String(least._id));
    await putSettings({ autoAssign: false });
  });
  it('validates and saves admin settings, and exposes only safe public settings', async () => {
    const a = await as('admin@t.test'); const cur = await getSettingsAs(a);
    expect((await a.send('put', '/api/v1/admin/settings', { ...cur, maxAttachments: 99 })).status).toBe(422);
    await putSettings({ siteName: 'Kenya Fix-It', announcement: 'Scheduled downtime on Sunday' });
    const pub = (await (await new Client().init()).get('/api/v1/settings/public')).body.settings;
    expect(pub.siteName).toBe('Kenya Fix-It'); expect(pub.announcement).toContain('downtime'); expect(pub.requireEmailVerification).toBeUndefined();
    await putSettings({ siteName: 'PSRS', announcement: '' });
    expect((await (await as('citizen1@t.test')).get('/api/v1/admin/settings')).status).toBe(403);
  });
  it('sends a test email and reports Brevo status to admins only', async () => {
    const a = await as('admin@t.test'); sent = [];
    expect((await a.post('/api/v1/admin/email/test', { to: 'me@x.test' })).status).toBe(200);
    expect(lastTo('me@x.test').body.subject).toContain('test email');
    expect((await a.get('/api/v1/admin/email/status')).body.configured).toBe(true);
    mode = 'fail'; expect((await a.post('/api/v1/admin/email/test', { to: 'me@x.test' })).status).toBe(502); mode = 'ok';
    expect((await (await as('offa@t.test')).post('/api/v1/admin/email/test', { to: 'me@x.test' })).status).toBe(403);
  });
});
