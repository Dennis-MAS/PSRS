// Transactional email through Brevo's HTTP API (https://developers.brevo.com), not SMTP.
// Email never blocks or breaks a request: failures are logged and the app keeps working.
import { AuditLog } from '../models/index.js';
import { getSettings, isEmailConfigured } from './settings.js';

export { isEmailConfigured };
const API = process.env.BREVO_API_URL || 'https://api.brevo.com/v3'; // override only for local mock servers
const inflight = new Set();
export const flushEmails = () => Promise.allSettled([...inflight]); // lets tests wait for background sends

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mask = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');

// Public base URL for links in emails. In production APP_URL must be set (never trust the Host header there).
export function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') return null;
  return req ? `${req.protocol}://${req.get('host')}` : `http://localhost:${process.env.PORT || 3000}`;
}

const log = (action, metadata) => AuditLog.create({ action, entityType: 'Email', metadata }).catch(() => {});

export async function sendEmail({ to, toName, subject, html, text, tag }) {
  if (!isEmailConfigured()) return { sent: false, skipped: true, error: 'Email is not configured (set BREVO_API_KEY and BREVO_SENDER_EMAIL)' };
  try {
    const res = await fetch(`${API}/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: process.env.BREVO_SENDER_NAME || 'PSRS', email: process.env.BREVO_SENDER_EMAIL }, to: [{ email: to, name: toName || undefined }], subject, htmlContent: html, textContent: text, tags: ['psrs', tag].filter(Boolean) }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Brevo responded with HTTP ${res.status}`);
    await log('email.sent', { to: mask(to), template: tag, messageId: data.messageId });
    return { sent: true, messageId: data.messageId };
  } catch (e) {
    console.error(`[email] ${tag || 'message'} to ${mask(to)} failed: ${e.message}`);
    await log('email.failed', { to: mask(to), template: tag, error: e.message });
    return { sent: false, error: e.message };
  }
}

export async function checkBrevo() {
  if (!isEmailConfigured()) return { configured: false };
  try {
    const res = await fetch(`${API}/account`, { headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { configured: true, connected: false, error: d.message || `HTTP ${res.status}` };
    return { configured: true, connected: true, account: d.companyName || d.email, senderEmail: process.env.BREVO_SENDER_EMAIL };
  } catch (e) { return { configured: true, connected: false, error: e.message }; }
}

// ---------- templates ----------
function layout(site, { heading, paragraphs = [], button, note }) {
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6">${t}</p>`).join('');
  const btn = button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#15803d;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;display:inline-block">${esc(button.label)}</a></p><p style="margin:0 0 14px;font-size:13px;color:#5a6b7c">Button not working? Copy this link into your browser:<br><a href="${esc(button.url)}" style="color:#1d4ed8;word-break:break-all">${esc(button.url)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f7fd;font-family:Arial,Helvetica,sans-serif;color:#1b2733"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fd;padding:24px 12px"><tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%"><tr><td style="background:#0b2545;color:#ffffff;padding:20px 28px;border-radius:20px 20px 0 0;font-size:20px;font-weight:800">${esc(site)}</td></tr><tr><td style="background:#ffffff;padding:28px;border:1px solid #e3e9f2;border-top:0"><h1 style="margin:0 0 16px;font-size:22px;color:#0b2545">${esc(heading)}</h1>${p}${btn}${note ? `<p style="margin:0;font-size:13px;color:#5a6b7c">${note}</p>` : ''}</td></tr></table></td></tr></table></body></html>`;
}
const plain = (heading, lines, url) => [heading, '', ...lines, ...(url ? ['', url] : [])].join('\n');
const hi = (u) => `Hi ${esc((u.fullName || 'there').split(' ')[0])},`;
const STATUS_TEXT = { UNDER_REVIEW: 'is now under review', IN_PROGRESS: 'is now in progress', AWAITING_INFORMATION: 'needs more information from you', RESOLVED: 'has been resolved', REJECTED: 'could not be accepted', CANCELLED: 'was cancelled' };

const T = {
  activation: (s, u, d) => ({ subject: `Activate your ${s} account`, html: layout(s, { heading: 'Activate your account', paragraphs: [hi(u), `Thanks for registering with ${esc(s)}. Please confirm your email address to activate your account.`], button: { label: 'Activate my account', url: d.link }, note: 'This link expires in 24 hours. If you did not create an account, you can ignore this email.' }), text: plain('Activate your account', [`Confirm your email to activate your ${s} account (link valid for 24 hours):`], d.link) }),
  welcome: (s, u, d) => ({ subject: `Welcome to ${s}`, html: layout(s, { heading: 'You are all set!', paragraphs: [hi(u), 'Your account is active. You can now submit requests and track their progress.'], button: { label: 'Go to my dashboard', url: d.url } }), text: plain('Welcome', ['Your account is active.'], d.url) }),
  reset: (s, u, d) => ({ subject: `Reset your ${s} password`, html: layout(s, { heading: 'Reset your password', paragraphs: [hi(u), 'We received a request to reset your password. Use the button below to choose a new one.'], button: { label: 'Choose a new password', url: d.link }, note: 'This link expires in 30 minutes and works once. If you did not ask for this, ignore this email and your password stays the same.' }), text: plain('Reset your password', ['Choose a new password (valid for 30 minutes):'], d.link) }),
  staffInvite: (s, u, d) => ({ subject: `Your ${s} staff account`, html: layout(s, { heading: 'Your staff account is ready', paragraphs: [hi(u), `An administrator created a ${esc(d.role)} account for you on ${esc(s)}. Set your own password to get started.`], button: { label: 'Set my password', url: d.link }, note: `After setting your password, sign in through the Staff portal: ${esc(d.loginUrl)}. This link is valid for 24 hours.` }), text: plain('Your staff account is ready', [`Set your password (valid 24 hours), then sign in at ${d.loginUrl}`], d.link) }),
  requestSubmitted: (s, u, d) => ({ subject: `Request received: ${d.reference}`, html: layout(s, { heading: 'We received your request', paragraphs: [hi(u), `Your request <strong>${esc(d.title)}</strong> (${esc(d.category)}) was submitted.`, `Your reference number is <strong>${esc(d.reference)}</strong>. Keep it to track progress.`], button: { label: 'Track my request', url: d.url } }), text: plain('We received your request', [`${d.title} (${d.category})`, `Reference: ${d.reference}`], d.url) }),
  statusChanged: (s, u, d) => ({ subject: `${d.reference}: ${STATUS_TEXT[d.status] || 'status updated'}`, html: layout(s, { heading: 'Your request was updated', paragraphs: [hi(u), `Your request <strong>${esc(d.title)}</strong> (${esc(d.reference)}) ${esc(STATUS_TEXT[d.status] || 'has a new status')}.`, ...(d.comment ? [`Message from the officer: “${esc(d.comment)}”`] : [])], button: { label: 'View my request', url: d.url } }), text: plain('Your request was updated', [`${d.reference} ${STATUS_TEXT[d.status] || 'has a new status'}.`, ...(d.comment ? [`Message: ${d.comment}`] : [])], d.url) }),
  newComment: (s, u, d) => ({ subject: `New comment on ${d.reference}`, html: layout(s, { heading: 'New comment', paragraphs: [hi(u), `${esc(d.from || 'Someone')} commented on ${esc(d.reference)}:`, `“${esc(d.comment)}”`], button: { label: 'Open the request', url: d.url } }), text: plain('New comment', [`${d.from || 'Someone'} commented on ${d.reference}:`, d.comment], d.url) }),
  assigned: (s, u, d) => ({ subject: `Request assigned to you: ${d.reference}`, html: layout(s, { heading: 'A request was assigned to you', paragraphs: [hi(u), `<strong>${esc(d.reference)}</strong>: ${esc(d.title)}`], button: { label: 'Open the request', url: d.url } }), text: plain('A request was assigned to you', [`${d.reference}: ${d.title}`], d.url) }),
  test: (s) => ({ subject: `${s} test email`, html: layout(s, { heading: 'Email is working 🎉', paragraphs: ['This is a test message from your Public Service Request System. Brevo accepted it for delivery.'] }), text: 'Email is working. This is a test message from your Public Service Request System.' })
};

export async function sendTemplate(type, user, data = {}) {
  const { siteName } = await getSettings();
  const m = T[type](siteName, user, data);
  return sendEmail({ to: user.email, toName: user.fullName, subject: m.subject, html: m.html, text: m.text, tag: type });
}
// Fire and forget (tracked so tests can await it).
export function queueTemplate(type, user, data) {
  const p = sendTemplate(type, user, data).catch((e) => console.error('[email]', e.message)).finally(() => inflight.delete(p));
  inflight.add(p); return p;
}
