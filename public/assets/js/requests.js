import { downloadFile, get, patch, post, api, qs } from './api.js';
import { publicSettings } from './layout.js';
import { progressTracker, NEXT, STATUS_LABEL, alertBox, clear, confirmDialog, debounce, empty, field, fmtDate, h, loading, pager, showErrors, clearErrors, statusBadge, toast, withBusy } from './utilities.js';

const detailUrl = (user, id) => `/${user.role === 'citizen' ? 'citizen' : 'officer'}/request-details.html?id=${id}`;

// ---------- citizen: list with search, filter, sort, pagination ----------
export function requestsTable(host, user, { limit = 10 } = {}) {
  const state = { q: '', status: '', sort: 'submittedAt', dir: 'desc', page: 1, limit };
  const results = h('div', {});
  const search = h('input', { type: 'search', placeholder: 'Reference or title', 'aria-label': 'Search requests', oninput: debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }) });
  const status = h('select', { 'aria-label': 'Filter by status', onchange: (e) => { state.status = e.target.value; state.page = 1; load(); } }, h('option', { value: '' }, 'All statuses'), Object.entries(STATUS_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  const sort = h('select', { 'aria-label': 'Sort', onchange: (e) => { const [s, d] = e.target.value.split(':'); state.sort = s; state.dir = d; load(); } },
    h('option', { value: 'submittedAt:desc' }, 'Newest first'), h('option', { value: 'submittedAt:asc' }, 'Oldest first'), h('option', { value: 'updatedAt:desc' }, 'Recently updated'));
  host.append(h('div', { class: 'filters' }, search, status, sort), results);
  async function load() {
    clear(results).append(loading());
    try {
      const r = await get('/requests/my' + qs(state));
      clear(results);
      if (!r.items.length) return results.append(empty(state.q || state.status ? 'No matching requests' : 'You have not submitted any requests yet', state.q || state.status ? 'Try a different search or filter.' : 'Pick a service and submit your first request.', state.q || state.status ? null : h('a', { class: 'btn', href: '/citizen/submit-request.html' }, 'Submit a request')));
      results.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Reference', 'Request', 'Service', 'Department', 'Submitted', 'Status', 'Last updated', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, r.items.map((x) => h('tr', {}, h('td', {}, x.referenceNumber), h('td', {}, x.title), h('td', {}, x.service?.name), h('td', {}, x.department?.name), h('td', {}, fmtDate(x.submittedAt)), h('td', {}, statusBadge(x.status)), h('td', {}, fmtDate(x.updatedAt)),
          h('td', { class: 'actions' }, h('a', { class: 'btn secondary sm', href: detailUrl(user, x._id) }, 'View details'))))))), pager(r.pagination, (p) => { state.page = p; load(); }));
    } catch (e) { clear(results).append(alertBox(e.message)); }
  }
  load();
}

// ---------- shared request detail (citizen, officer, admin) ----------
export async function renderRequestDetail(main, user, id) {
  if (!/^[a-f\d]{24}$/i.test(id || '')) return main.replaceChildren(alertBox('This request link is not valid.'));
  const staff = user.role !== 'citizen';
  const cfg = await publicSettings();
  async function render() {
    clear(main).append(loading());
    let d;
    try { d = await get(`/requests/${id}`); } catch (e) { return clear(main).append(alertBox(e.status === 404 ? 'This request does not exist or you do not have access to it.' : e.message)); }
    const r = d.request; const open = !['RESOLVED', 'REJECTED', 'CANCELLED'].includes(r.status);
    clear(main);
    main.append(h('div', { class: 'page-head' }, h('h1', {}, r.referenceNumber), statusBadge(r.status), h('span', { class: 'grow' }),
      h('button', { class: 'btn secondary sm', onclick: () => downloadFile(`/requests/${id}/summary`, `${r.referenceNumber}.txt`).catch((e) => toast(e.message, 'error')) }, 'Download summary'),
      !staff && r.status === 'SUBMITTED' && cfg.allowCitizenCancel !== false ? h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmDialog('Cancel this request? This cannot be undone.', { confirmText: 'Cancel request', danger: true })) { try { await post(`/requests/${id}/cancel`); toast('Request cancelled', 'success'); render(); } catch (e) { toast(e.message, 'error'); } } } }, 'Cancel request') : null));

    main.append(h('div', { class: 'card' }, progressTracker(r.status)));
    const kv = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v || '-'));
    main.append(h('div', { class: 'card stack' }, h('h2', {}, r.title), h('dl', { class: 'kv' }, kv('Service', r.service?.name), kv('Department', r.department?.name), kv('Submitted', fmtDate(r.submittedAt, true)), kv('Last updated', fmtDate(r.updatedAt, true)),
      kv('Assigned officer', r.assignedOfficer?.fullName || 'Not yet assigned'), kv('Location', r.location), staff ? kv('Citizen', `${r.citizen?.fullName}${r.citizen?.email ? ' (' + r.citizen.email + ')' : ''}`) : null),
      h('p', { style: null }, r.description), r.resolutionSummary ? alertBox(`Resolution: ${r.resolutionSummary}`, 'success') : null,
      r.status === 'AWAITING_INFORMATION' && !staff ? alertBox('The officer needs more information. Reply in the comments below to send it.', 'warn') : null));

    main.append(h('div', { class: 'grid g2', style: null },
      h('div', { class: 'card' }, h('h3', {}, 'Progress timeline'), h('ol', { class: 'timeline' }, d.history.map((x, i) => h('li', { class: i === d.history.length - 1 ? 'now' : '' },
        h('strong', {}, STATUS_LABEL[x.newStatus] || x.newStatus), h('div', { class: 'small muted' }, `${fmtDate(x.createdAt, true)}${x.changedBy ? ' · ' + x.changedBy.fullName : ''}`), x.comment ? h('div', {}, x.comment) : null)))),
      h('div', { class: 'card stack' }, h('h3', {}, 'Attachments'),
        d.attachments.length ? d.attachments.map((a) => h('div', { class: 'stack' }, a.mimeType.startsWith('image/') ? h('img', { class: 'thumb', src: `/api/v1/requests/${id}/attachments/${a._id}`, alt: `Photo: ${a.originalFilename}`, loading: 'lazy' }) : null, h('div', { class: 'row' }, h('a', { href: `/api/v1/requests/${id}/attachments/${a._id}` }, a.originalFilename), h('span', { class: 'muted small' }, `${(a.fileSize / 1024).toFixed(0)} KB`)))) : h('p', { class: 'muted' }, 'No attachments.'),
        !staff && open ? uploadForm(id, render) : null)));

    main.append(h('div', { class: 'card stack' }, h('h3', {}, 'Comments'),
      d.comments.length ? d.comments.map((c) => h('div', { class: `comment ${c.visibility}` }, h('div', { class: 'small muted' }, `${c.author?.fullName || 'User'} (${c.author?.role})${c.visibility === 'internal' ? ' · Internal note, not visible to the citizen' : ''} · ${fmtDate(c.createdAt, true)}`), h('div', {}, c.comment))) : h('p', { class: 'muted' }, 'No comments yet.'),
      open || staff ? commentForm(`/requests/${id}/comments`, staff ? 'Reply to citizen' : 'Add a comment or reply', render, { visibility: 'citizen' }) : null));

    if (staff) {
      main.append(h('div', { class: 'card stack' }, h('h3', {}, 'Officer actions'), h('div', { class: 'grid g2' }, assignForm(id, r, render), statusForm(id, r, render)), commentForm(`/officer/requests/${id}/internal-notes`, 'Add internal note (staff only)', render)));
    }
  }
  render();
}

function commentForm(path, label, done, extra = {}) {
  const f = h('form', { novalidate: true }, field({ label, name: 'comment', type: 'textarea', required: true, rows: 3, maxlength: 2000 }), h('button', { class: 'btn', type: 'submit' }, 'Post'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); clearErrors(f); const text = f.elements.comment.value.trim();
    if (!text) return showErrors(f, { message: 'Write something first', fields: { comment: 'Required' } });
    try { await withBusy(f.querySelector('button'), () => post(path, { comment: text, ...extra })); toast('Posted', 'success'); done(); } catch (err) { showErrors(f, err); }
  });
  return f;
}

function uploadForm(id, done) {
  const input = h('input', { type: 'file', name: 'file', accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', 'aria-label': 'Choose a file' });
  const f = h('form', { class: 'stack' }, h('div', { class: 'field', 'data-field': 'file' }, h('label', { for: 'up' }, 'Add a supporting document'), input, h('div', { class: 'hint' }, 'PDF, JPEG or PNG, up to 5 MB.'), h('div', { class: 'field-error' })), h('button', { class: 'btn secondary sm', type: 'submit' }, 'Upload'));
  input.id = 'up';
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); clearErrors(f);
    if (!input.files[0]) return showErrors(f, { message: 'Choose a file first', fields: { file: 'Required' } });
    const fd = new FormData(); fd.append('file', input.files[0]);
    try { await withBusy(f.querySelector('button'), () => api(`/requests/${id}/attachments`, { method: 'POST', form: fd })); toast('File uploaded', 'success'); done(); } catch (err) { showErrors(f, err); }
  });
  return f;
}

function assignForm(id, r, done) {
  const sel = h('select', { id: 'assignee', name: 'officerId' }, h('option', { value: '' }, 'Loading officers...'));
  get(`/officer/requests/${id}/assignees`).then(({ items }) => { 
    clear(sel).append(h('option', { value: '' }, items.length ? 'Unassigned' : 'No officers available'), 
      items.map((o) => h('option', { value: o._id, selected: String(o._id) === String(r.assignedOfficer?._id) }, `${o.fullName} (${o.department?.name || 'Department not set'})`)));
  }).catch((e) => { clear(sel).append(h('option', { value: '' }, 'Failed to load officers')); });
  const f = h('form', { novalidate: true }, h('div', { class: 'field', 'data-field': 'officerId' }, h('label', { for: 'assignee' }, 'Assign to officer'), sel, h('div', { class: 'field-error' })), h('button', { class: 'btn secondary', type: 'submit', disabled: ['RESOLVED', 'REJECTED', 'CANCELLED'].includes(r.status) }, 'Assign/Unassign'));
  f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f); 
    try { await withBusy(f.querySelector('button'), () => patch(`/officer/requests/${id}/assign`, { officerId: sel.value || null })); toast(sel.value ? 'Request assigned' : 'Request unassigned', 'success'); done(); } catch (err) { showErrors(f, err); } });
  return f;
}

function statusForm(id, r, done) {
  const next = NEXT[r.status] || [];
  if (!next.length) return h('div', {}, h('div', { class: 'lbl' }, 'Status'), h('p', { class: 'muted' }, `This request is ${STATUS_LABEL[r.status].toLowerCase()} and cannot be changed.`));
  const f = h('form', { novalidate: true }, field({ label: 'Change status', name: 'status', type: 'select', options: next.map((s) => ({ value: s, label: STATUS_LABEL[s] })) }),
    field({ label: 'Comment for the citizen', name: 'comment', type: 'textarea', rows: 3, hint: 'Required when requesting information, resolving or rejecting.' }), h('button', { class: 'btn', type: 'submit' }, 'Update status'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); clearErrors(f);
    if (f.elements.status.value === 'REJECTED' && !(await confirmDialog('Reject this request? The citizen will be notified.', { confirmText: 'Reject', danger: true }))) return;
    try { await withBusy(f.querySelector('button'), () => patch(`/officer/requests/${id}/status`, { status: f.elements.status.value, comment: f.elements.comment.value.trim() })); toast('Status updated', 'success'); done(); } catch (err) { showErrors(f, err); }
  });
  return f;
}

// ---------- notifications (citizen + officer) ----------
export async function renderNotifications(main, user) {
  const list = h('div', { class: 'card flat', style: null }); let page = 1;
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Notifications'), h('span', { class: 'grow' }), h('button', { class: 'btn secondary sm', onclick: async () => { await patch('/notifications/read-all'); toast('All marked as read', 'success'); load(); } }, 'Mark all as read')), list);
  async function load() {
    clear(list).append(loading());
    try {
      const r = await get(`/notifications?page=${page}&limit=15`); clear(list);
      if (!r.items.length) return list.append(empty('No notifications yet', 'Updates about your requests will appear here.'));
      r.items.forEach((n) => list.append(h('div', { class: `notif ${n.readAt ? '' : 'unread'}` }, h('div', { class: 'grow' }, h('strong', {}, n.title), h('div', {}, n.message), h('div', { class: 'small muted' }, fmtDate(n.createdAt, true))),
        n.request ? h('a', { class: 'btn secondary sm', href: detailUrl(user, n.request._id), onclick: () => { if (!n.readAt) patch(`/notifications/${n._id}/read`).catch(() => {}); } }, 'Open request') : null,
        !n.readAt ? h('button', { class: 'btn secondary sm', onclick: async () => { await patch(`/notifications/${n._id}/read`); load(); } }, 'Mark read') : null)));
      list.append(pager(r.pagination, (p) => { page = p; load(); }));
    } catch (e) { clear(list).append(alertBox(e.message)); }
  }
  load();
}
