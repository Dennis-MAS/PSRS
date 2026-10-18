// Single place for talking to the backend: CSRF handling, JSON, consistent errors.
let csrf = null;
export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields || {}; }
}
export const setCsrf = (t) => { if (t) csrf = t; };
async function loadCsrf() { const r = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' }); csrf = (await r.json()).csrfToken; }

export async function api(path, { method = 'GET', body, form } = {}, retried = false) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { if (!csrf) await loadCsrf(); opts.headers['X-CSRF-Token'] = csrf; }
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (form) opts.body = form;
  let res;
  try { res = await fetch('/api/v1' + path, opts); } catch { throw new ApiError(0, 'Cannot reach the server. Check your connection and try again'); }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 403 && /CSRF/i.test(data?.message || '') && !retried) { await loadCsrf(); return api(path, { method, body, form }, true); }
    throw new ApiError(res.status, data?.message || 'Something went wrong', data?.errors);
  }
  if (data?.csrfToken) csrf = data.csrfToken;
  return data;
}
export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const patch = (p, body) => api(p, { method: 'PATCH', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

export async function downloadFile(path, filename) {
  const res = await fetch('/api/v1' + path, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
