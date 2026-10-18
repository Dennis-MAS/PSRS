// DOM helper: strings are always inserted as text nodes, never parsed as HTML (XSS-safe).
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const clear = (el) => { el.replaceChildren(); return el; };
export const fmtDate = (d, time = false) => (d ? new Date(d).toLocaleString('en-KE', { dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}) }) : '-');
export const STATUS_LABEL = { SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', AWAITING_INFORMATION: 'Awaiting information', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const statusBadge = (s) => h('span', { class: `badge b-${s}` }, STATUS_LABEL[s] || s);
export const pill = (s) => h('span', { class: `badge b-${s}` }, s);
// UI hint only. The server enforces transitions.
export const NEXT = { SUBMITTED: ['UNDER_REVIEW', 'REJECTED'], UNDER_REVIEW: ['IN_PROGRESS', 'AWAITING_INFORMATION', 'REJECTED'], AWAITING_INFORMATION: ['UNDER_REVIEW'], IN_PROGRESS: ['AWAITING_INFORMATION', 'RESOLVED', 'REJECTED'] };
export const HOME = { citizen: '/citizen/dashboard.html', officer: '/officer/dashboard.html', admin: '/admin/dashboard.html' };

export function toast(msg, type = '') {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `toast ${type}` }, msg); box.append(t); setTimeout(() => t.remove(), 4500);
}
export const alertBox = (msg, type = 'error') => h('div', { class: `alert ${type}`, role: type === 'error' ? 'alert' : 'status' }, msg);

export function field({ label, name, type = 'text', required, value, hint, options, rows, ...rest }) {
  let input;
  if (type === 'select') input = h('select', { id: name, name, required, ...rest }, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value ?? '') }, o.label)));
  else if (type === 'textarea') { input = h('textarea', { id: name, name, required, rows, ...rest }); input.value = value ?? ''; }
  else input = h('input', { id: name, name, type, required, value, ...rest });
  return h('div', { class: 'field', 'data-field': name }, h('label', { for: name }, label, required ? ' *' : ''), input, hint ? h('div', { class: 'hint' }, hint) : null, h('div', { class: 'field-error', 'aria-live': 'polite' }));
}
export function showErrors(form, err) {
  form.querySelectorAll('.field').forEach((f) => { f.classList.remove('invalid'); const e = f.querySelector('.field-error'); if (e) e.textContent = ''; });
  let general = err.message;
  for (const [k, msg] of Object.entries(err.fields || {})) {
    const f = form.querySelector(`[data-field="${k}"]`);
    if (f) { f.classList.add('invalid'); const e = f.querySelector('.field-error'); if (e) e.textContent = msg; general = err.status === 422 ? 'Please fix the highlighted fields.' : general; }
  }
  let box = form.querySelector('.form-alert');
  if (!box) { box = h('div', { class: 'form-alert' }); form.prepend(box); }
  box.replaceChildren(alertBox(general));
  form.querySelector('.invalid input, .invalid select, .invalid textarea')?.focus();
}
export const clearErrors = (form) => { form.querySelector('.form-alert')?.replaceChildren(); form.querySelectorAll('.field').forEach((f) => { f.classList.remove('invalid'); const e = f.querySelector('.field-error'); if (e) e.textContent = ''; }); };

export async function withBusy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Working...');
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

export function openModal(title, body) {
  const dlg = h('dialog', {}, h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'btn secondary sm', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, 'Close')), h('div', { class: 'modal-body' }, body));
  dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal(); return dlg;
}
export function confirmDialog(message, { confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const dlg = openModal('Please confirm', h('div', { class: 'stack' }, h('p', {}, message), h('div', { class: 'row' },
      h('button', { class: `btn ${danger ? 'danger' : ''}`, type: 'button', onclick: () => { answer = true; dlg.close(); } }, confirmText),
      h('button', { class: 'btn secondary', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
    dlg.addEventListener('close', () => resolve(answer));
  });
}

export function pager(pg, onPage) {
  return h('div', { class: 'pager' }, h('span', { class: 'muted small' }, `${pg.total} result${pg.total === 1 ? '' : 's'} · page ${pg.page} of ${pg.pages}`),
    h('div', { class: 'row' }, h('button', { class: 'btn secondary sm', disabled: pg.page <= 1, onclick: () => onPage(pg.page - 1) }, 'Previous'), h('button', { class: 'btn secondary sm', disabled: pg.page >= pg.pages, onclick: () => onPage(pg.page + 1) }, 'Next')));
}
export const empty = (title, text, action) => h('div', { class: 'empty' }, h('strong', {}, title), text, action ? h('div', { style: null }, h('br'), action) : null);
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const loading = () => h('p', { class: 'muted center' }, h('span', { class: 'spinner' }), ' Loading...');

// Simple three-step view of the detailed statuses (mirrors the server's PUBLIC_STATUS).
export const PUBLIC_STATUS = { SUBMITTED: 'Pending', UNDER_REVIEW: 'Pending', AWAITING_INFORMATION: 'Pending', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', REJECTED: 'Closed', CANCELLED: 'Closed' };
export function progressTracker(status) {
  const steps = ['Pending', 'In Progress', 'Resolved'];
  const now = PUBLIC_STATUS[status]; const idx = steps.indexOf(now);
  if (idx < 0) return h('div', { class: 'tracker closed', role: 'img', 'aria-label': `Closed: ${STATUS_LABEL[status]}` }, h('span', { class: 'step bad' }, `Closed: ${STATUS_LABEL[status]}`));
  return h('ol', { class: 'tracker', 'aria-label': `Progress: ${now}` }, steps.map((s, i) => h('li', { class: `step ${i < idx ? 'done' : i === idx ? 'current' : ''}`, 'aria-current': i === idx ? 'step' : null }, s)));
}

// Toggle switch row used on the settings page: a real checkbox styled as a switch.
export function switchField({ label, name, checked, hint }) {
  return h('label', { class: 'switch' }, h('input', { type: 'checkbox', name, checked: !!checked }), h('span', {}, h('span', { class: 't' }, label), hint ? h('span', { class: 'd' }, hint) : null));
}
