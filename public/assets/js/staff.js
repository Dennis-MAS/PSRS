import { downloadFile, get, patch, post, put, qs } from './api.js';
import { switchField, STATUS_LABEL, alertBox, clear, clearErrors, confirmDialog, debounce, empty, field, fmtDate, h, loading, openModal, pager, pill, showErrors, statusBadge, toast, withBusy } from './utilities.js';
import { mountDashboard } from './layout.js';
import { renderNotifications, renderRequestDetail } from './requests.js';

const area = document.body.dataset.area; const page = document.body.dataset.page;
const { main, user } = await mountDashboard(area === 'admin' ? ['admin'] : ['officer', 'admin'], 'staff');
const title = (t, ...extra) => h('div', { class: 'page-head' }, h('h1', {}, t), ...extra);
const table = (heads, rows) => h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((t) => h('th', {}, t)))), h('tbody', {}, rows)));
const td = (...k) => h('td', {}, ...k);
const metric = (l, n, c = '') => h('div', { class: `card metric ${c}` }, h('span', { class: 'n' }, n ?? '-'), h('span', { class: 'l' }, l));
const optionsOf = (items, first) => [h('option', { value: '' }, first), ...items.map((i) => h('option', { value: i._id }, i.name))];

// ---------- requests list (officer + admin) ----------
function staffRequests(host, { limit = 10 } = {}) {
  const state = { q: '', status: '', service: '', department: '', from: '', to: '', mine: '', page: 1, limit };
  const results = h('div', {}); const reload = () => { state.page = 1; load(); };
  const svc = h('select', { 'aria-label': 'Service', onchange: (e) => { state.service = e.target.value; reload(); } }, h('option', { value: '' }, 'All services'));
  const dept = h('select', { 'aria-label': 'Department', onchange: (e) => { state.department = e.target.value; reload(); } }, h('option', { value: '' }, 'All departments'));
  get('/services?limit=100&includeInactive=1').then((r) => svc.append(...r.items.map((s) => h('option', { value: s._id }, s.name)))).catch(() => {});
  if (user.role === 'admin') get('/departments?includeInactive=1').then((r) => dept.append(...r.items.map((d) => h('option', { value: d._id }, d.name)))).catch(() => {});
  host.append(h('div', { class: 'filters' }, h('input', { type: 'search', placeholder: 'Reference number', 'aria-label': 'Search by reference', oninput: debounce((e) => { state.q = e.target.value.trim(); reload(); }) }),
    h('select', { 'aria-label': 'Status', onchange: (e) => { state.status = e.target.value; reload(); } }, h('option', { value: '' }, 'All statuses'), Object.entries(STATUS_LABEL).map(([v, l]) => h('option', { value: v }, l))), svc, user.role === 'admin' ? dept : null,
    h('input', { type: 'date', 'aria-label': 'From date', onchange: (e) => { state.from = e.target.value; reload(); } }), h('input', { type: 'date', 'aria-label': 'To date', onchange: (e) => { state.to = e.target.value; reload(); } }),
    user.role === 'officer' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { state.mine = e.target.checked ? '1' : ''; reload(); } }), 'Assigned to me') : null), results);
  async function load() {
    clear(results).append(loading());
    try {
      const r = await get('/officer/requests' + qs(state)); clear(results);
      if (!r.items.length) return results.append(empty('No requests found', 'Adjust the filters or check back later.'));
      results.append(table(['Reference', 'Request', 'Service', 'Department', 'Officer', 'Submitted', 'Status', ''], r.items.map((x) => h('tr', {}, td(x.referenceNumber), td(x.title), td(x.service?.name), td(x.department?.name), 
        user.role === 'admin' && !['RESOLVED', 'REJECTED', 'CANCELLED'].includes(x.status) 
          ? td(h('div', { class: 'row' }, 
              h('span', { id: `off-${x._id}-lbl`, class: 'small' }, x.assignedOfficer?.fullName || 'Unassigned'),
              h('button', { class: 'btn secondary xs', onclick: () => inlineAssign(x, results, reload) }, 'Assign...')
            ))
          : td(x.assignedOfficer?.fullName || 'Unassigned'), 
        td(fmtDate(x.submittedAt)), td(statusBadge(x.status)),
        h('td', { class: 'actions' }, h('a', { class: 'btn secondary sm', href: `/officer/request-details.html?id=${x._id}` }, 'Open'))))), pager(r.pagination, (p) => { state.page = p; load(); }));
    } catch (e) { clear(results).append(alertBox(e.message)); }
  }
  load();
}

function inlineAssign(req, host, done) {
  const dlg = openModal(`Assign ${req.referenceNumber}`, h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', { for: `sel-${req._id}` }, 'Officer'), h('select', { id: `sel-${req._id}` }, h('option', { value: '' }, 'Loading...'))),
    h('div', { class: 'row' }, h('button', { class: 'btn', id: `ok-${req._id}` }, 'Assign/Unassign'), h('button', { class: 'btn secondary', id: `cl-${req._id}` }, 'Cancel')),
    h('div', { id: `msg-${req._id}`, class: 'small muted' })
  ));
  const sel = dlg.querySelector('select');
  const ok = dlg.querySelector(`#ok-${req._id}`);
  const cl = dlg.querySelector(`#cl-${req._id}`);
  const msg = dlg.querySelector(`#msg-${req._id}`);
  ok.disabled = true;
  get(`/officer/requests/${req._id}/assignees`).then(({ items }) => {
    clear(sel).append(h('option', { value: '' }, items.length ? 'Unassigned' : 'No officers available'));
    items.forEach((o) => sel.append(h('option', { value: o._id, selected: String(o._id) === String(req.assignedOfficer?._id) }, `${o.fullName} (${o.department?.name || 'Department not set'})`)));
    ok.disabled = false;
  }).catch(() => { sel.innerHTML = '<option value="">Failed to load</option>'; ok.disabled = false; });
  cl.onclick = () => dlg.close();
  ok.onclick = async () => {
    msg.textContent = '';
    try {
      await withBusy(ok, () => patch(`/officer/requests/${req._id}/assign`, { officerId: sel.value || null }));
      toast(sel.value ? 'Assigned' : 'Unassigned', 'success');
      dlg.close();
      done();
      const lbl = document.getElementById(`off-${req._id}-lbl`);
      if (lbl) lbl.textContent = sel.value ? (sel.selectedOptions[0]?.textContent || 'Assigned') : 'Unassigned';
    } catch (e) {
      msg.textContent = e.message;
      toast(e.message, 'error');
    }
  };
}
const loadChart = () => (window.Chart ? Promise.resolve() : new Promise((res, rej) => { const s = Object.assign(document.createElement('script'), { src: '/vendor/chart/chart.umd.js', onload: res, onerror: rej }); document.head.append(s); }));
const COLORS = { SUBMITTED: '#2563eb', UNDER_REVIEW: '#d97706', AWAITING_INFORMATION: '#f59e0b', IN_PROGRESS: '#0891b2', RESOLVED: '#16a34a', REJECTED: '#dc2626', CANCELLED: '#6b7280' };
const chartCard = (t, cls = '') => { const c = h('canvas', { 'aria-label': t, role: 'img' }); return [h('div', { class: `card ${cls}` }, h('h3', {}, t), h('div', { class: 'chart-box' }, c)), c]; };

// ---------- service / department / user forms ----------
function serviceForm(svc, departments, done) {
  const types = ['application/pdf', 'image/jpeg', 'image/png'];
  const f = h('form', { novalidate: true }, field({ label: 'Name', name: 'name', required: true, value: svc?.name }), field({ label: 'Short description', name: 'description', type: 'textarea', rows: 3, required: true, value: svc?.description }),
    field({ label: 'Instructions', name: 'instructions', type: 'textarea', rows: 3, value: svc?.instructions }),
    field({ label: 'Responsible department', name: 'department', type: 'select', required: true, value: svc?.department?._id || svc?.department || '', options: [{ value: '', label: 'Choose department' }, ...departments.map((d) => ({ value: d._id, label: d.name }))] }),
    field({ label: 'Required information (one per line)', name: 'requiredInformation', type: 'textarea', rows: 3, value: (svc?.requiredInformation || []).join('\n') }),
    h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Allowed attachment types'), h('div', { class: 'row' }, types.map((t) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'type', value: t, checked: !svc || svc.allowedAttachmentTypes.includes(t) }), t.split('/')[1].toUpperCase())))),
    field({ label: 'Maximum attachment size (MB)', name: 'maximumAttachmentSizeMb', type: 'number', step: '0.1', min: '0.1', max: '10', value: svc ? (svc.maximumAttachmentSize / 1048576).toFixed(1) : '5' }),
    field({ label: 'Illustrative processing time (days)', name: 'estimatedProcessingDays', type: 'number', min: '1', value: svc?.estimatedProcessingDays ?? 7 }), field({ label: 'Icon (emoji)', name: 'icon', value: svc?.icon || '📄', maxlength: 8 }),
    h('button', { class: 'btn', type: 'submit' }, svc ? 'Save changes' : 'Create service'));
  f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f);
    const body = { name: f.elements.name.value.trim(), description: f.elements.description.value.trim(), instructions: f.elements.instructions.value.trim() || undefined, department: f.elements.department.value, requiredInformation: f.elements.requiredInformation.value.split('\n').map((x) => x.trim()).filter(Boolean),
      allowedAttachmentTypes: [...f.querySelectorAll('input[name=type]:checked')].map((x) => x.value), maximumAttachmentSizeMb: Number(f.elements.maximumAttachmentSizeMb.value), estimatedProcessingDays: Number(f.elements.estimatedProcessingDays.value), icon: f.elements.icon.value.trim() || undefined };
    try { await withBusy(f.querySelector('button'), () => (svc ? patch(`/services/${svc._id}`, body) : post('/services', body))); toast('Service saved', 'success'); done(); } catch (err) { showErrors(f, err); } });
  return f;
}
function simpleForm(item, fields, submitText, action, done) {
  const f = h('form', { novalidate: true }, fields.map(([label, name, type, req]) => field({ label, name, type: type || 'text', rows: 3, required: req, value: item?.[name] })), h('button', { class: 'btn', type: 'submit' }, submitText));
  f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f); try { await withBusy(f.querySelector('button'), () => action(Object.fromEntries(fields.map(([, n]) => [n, f[n].value.trim()])))); toast('Saved', 'success'); done(); } catch (err) { showErrors(f, err); } });
  return f;
}

const pages = {
  // ----- officer -----
  async dashboard() {
    if (area === 'admin') return adminDashboard();
    main.append(title('Officer dashboard'));
    const stats = h('div', { class: 'grid g4' }, loading()); main.append(stats);
    const recent = h('div', {}); main.append(h('h2', {}, 'Recently updated requests'), recent);
    try {
      const r = await get('/officer/dashboard'); const s = r.stats;
      clear(stats).append(metric('Assigned to me', s.assignedToMe, 'blue'), metric('Pending review', s.pendingReview, 'amber'), metric('In progress', s.inProgress, 'blue'), metric('Awaiting citizen information', s.awaitingInformation, 'amber'), metric('Resolved', s.resolved, 'green'));
      recent.append(r.recent.length ? table(['Reference', 'Request', 'Citizen', 'Updated', 'Status', ''], r.recent.map((x) => h('tr', {}, td(x.referenceNumber), td(x.title), td(x.citizen?.fullName), td(fmtDate(x.updatedAt, true)), td(statusBadge(x.status)), td(h('a', { class: 'btn secondary sm', href: `/officer/request-details.html?id=${x._id}` }, 'Open'))))) : empty('Nothing to review yet', 'Requests for your department will appear here.'));
      main.append(h('p', {}, h('a', { class: 'btn', href: '/officer/requests.html' }, 'Open all requests')));
    } catch (e) { clear(stats).append(alertBox(e.message)); }
  },
  async requests() { main.append(title(area === 'admin' ? 'All requests' : 'Requests')); const host = h('div', {}); main.append(host); staffRequests(host); },
  async 'request-details'() { await renderRequestDetail(main, user, new URLSearchParams(location.search).get('id')); },
  async notifications() { await renderNotifications(main, user); },

  // ----- admin -----
  async services() {
    const host = h('div', {}); let depts = []; main.append(title('Services', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => { const dlg = openModal('New service', serviceForm(null, depts, () => { dlg.close(); load(); })); } }, 'New service')), host);
    depts = (await get('/departments?includeInactive=1')).items;
    async function load() {
      clear(host).append(loading());
      try { const r = await get('/services?limit=100&includeInactive=1'); clear(host);
        host.append(r.items.length ? table(['Service', 'Department', 'Days', 'Status', ''], r.items.map((s) => h('tr', {}, td(`${s.icon || ''} ${s.name}`), td(s.department?.name), td(s.estimatedProcessingDays), td(pill(s.status)),
          h('td', { class: 'actions' }, h('button', { class: 'btn secondary sm', onclick: () => { const dlg = openModal('Edit service', serviceForm(s, depts, () => { dlg.close(); load(); })); } }, 'Edit'), ' ',
            h('button', { class: `btn sm ${s.status === 'active' ? 'danger' : ''}`, onclick: async () => { const next = s.status === 'active' ? 'inactive' : 'active'; if (next === 'inactive' && !(await confirmDialog(`Deactivate "${s.name}"? New requests will no longer be accepted.`, { danger: true, confirmText: 'Deactivate' }))) return; try { await patch(`/services/${s._id}/status`, { status: next }); load(); } catch (e) { toast(e.message, 'error'); } } }, s.status === 'active' ? 'Deactivate' : 'Activate'))))) : empty('No services yet', 'Create the first service.'));
      } catch (e) { clear(host).append(alertBox(e.message)); }
    }
    load();
  },

  async departments() {
    const host = h('div', {}); const flds = [['Name', 'name', 'text', true], ['Description', 'description', 'textarea'], ['Contact information', 'contactInformation']];
    main.append(title('Departments', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => { const dlg = openModal('New department', simpleForm(null, flds, 'Create department', (b) => post('/departments', b), () => { dlg.close(); load(); })); } }, 'New department')), host);
    async function load() {
      clear(host).append(loading());
      try { const r = await get('/departments?includeInactive=1'); clear(host);
        host.append(r.items.length ? table(['Department', 'Contact', 'Status', ''], r.items.map((d) => h('tr', {}, td(h('strong', {}, d.name), h('div', { class: 'small muted' }, d.description || '')), td(d.contactInformation || '-'), td(pill(d.status)),
          h('td', { class: 'actions' }, h('button', { class: 'btn secondary sm', onclick: () => { const dlg = openModal('Edit department', simpleForm(d, flds, 'Save changes', (b) => patch(`/departments/${d._id}`, b), () => { dlg.close(); load(); })); } }, 'Edit'), ' ',
            h('button', { class: 'btn secondary sm', onclick: async () => { try { await patch(`/departments/${d._id}/status`, { status: d.status === 'active' ? 'inactive' : 'active' }); load(); } catch (e) { toast(e.message, 'error'); } } }, d.status === 'active' ? 'Deactivate' : 'Activate'))))) : empty('No departments', 'Create one to get started.'));
      } catch (e) { clear(host).append(alertBox(e.message)); }
    }
    load();
  },

  async users() {
    const state = { q: '', role: '', accountStatus: '', page: 1, limit: 10 }; const host = h('div', {}); let depts = [];
    const reload = () => { state.page = 1; load(); };
    const sel = (label, key, opts) => h('select', { 'aria-label': label, onchange: (e) => { state[key] = e.target.value; reload(); } }, opts.map(([v, l]) => h('option', { value: v }, l)));
    main.append(title('Users', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => staffModal() }, 'Add staff account')),
      h('div', { class: 'filters' }, h('input', { type: 'search', placeholder: 'Name or email', 'aria-label': 'Search users', oninput: debounce((e) => { state.q = e.target.value.trim(); reload(); }) }), sel('Role', 'role', [['', 'All roles'], ['citizen', 'Citizen'], ['officer', 'Officer'], ['admin', 'Administrator']]), sel('Status', 'accountStatus', [['', 'Any status'], ['active', 'Active'], ['suspended', 'Suspended']])), host);
    depts = (await get('/departments?includeInactive=1')).items;
    const deptOpts = (v) => [{ value: '', label: 'No department' }, ...depts.map((d) => ({ value: d._id, label: d.name }))].map((o) => ({ ...o, value: o.value, selected: o.value === v }));
    function staffModal() {
      const f = h('form', { novalidate: true }, field({ label: 'Full name', name: 'fullName', required: true }), field({ label: 'Email', name: 'email', type: 'email', required: true }), field({ label: 'Temporary password', name: 'password', type: 'password', required: true, autocomplete: 'new-password', hint: 'Temporary password (8+ characters, upper and lower case, a number). If email is set up, the person also gets a link to choose their own.' }),
        field({ label: 'Role', name: 'role', type: 'select', options: [{ value: 'officer', label: 'Service officer' }, { value: 'admin', label: 'Administrator' }] }), field({ label: 'Department (officers)', name: 'department', type: 'select', options: deptOpts('') }), h('button', { class: 'btn', type: 'submit' }, 'Create account'));
      const dlg = openModal('Add staff account', f);
      f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f); try { const r = await withBusy(f.querySelector('button'), () => post('/admin/users', { fullName: f.elements.fullName.value.trim(), email: f.elements.email.value.trim(), password: f.elements.password.value, role: f.elements.role.value, department: f.elements.department.value || undefined })); toast(r.invited ? 'Account created. An email invitation was sent.' : 'Account created', 'success'); dlg.close(); load(); } catch (err) { showErrors(f, err); } });
    }
    function roleModal(u) {
      const f = h('form', { novalidate: true }, field({ label: 'Role', name: 'role', type: 'select', value: u.role, options: [{ value: 'citizen', label: 'Citizen' }, { value: 'officer', label: 'Service officer' }, { value: 'admin', label: 'Administrator' }] }), field({ label: 'Department (officers)', name: 'department', type: 'select', options: deptOpts(u.department?._id || '') }), h('button', { class: 'btn', type: 'submit' }, 'Save role'));
      const dlg = openModal(`Change role: ${u.fullName}`, f);
      f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f); try { await withBusy(f.querySelector('button'), () => patch(`/admin/users/${u._id}/role`, { role: f.elements.role.value, department: f.elements.department.value || null })); toast('Role updated', 'success'); dlg.close(); load(); } catch (err) { showErrors(f, err); } });
    }
    async function load() {
      clear(host).append(loading());
      try { const r = await get('/admin/users' + qs(state)); clear(host);
        host.append(table(['Name', 'Email', 'Role', 'Department', 'Status', ''], r.items.map((u) => h('tr', {}, td(u.fullName), td(u.email), td(u.role), td(u.department?.name || '-'), td(pill(u.accountStatus), u.emailVerified === false ? [' ', h('span', { class: 'badge b-warn' }, 'Not activated')] : null),
          h('td', { class: 'actions' }, String(u._id) === String(user._id) ? h('span', { class: 'muted small' }, 'You') : [u.emailVerified === false ? [h('button', { class: 'btn secondary sm', onclick: async () => { try { await patch(`/admin/users/${u._id}/activate`); toast('Account activated', 'success'); load(); } catch (e) { toast(e.message, 'error'); } } }, 'Activate now'), ' ', h('button', { class: 'btn secondary sm', onclick: async (e) => { try { await withBusy(e.currentTarget, () => post(`/admin/users/${u._id}/resend-activation`)); toast('Activation email sent', 'success'); } catch (err) { toast(err.message, 'error'); } } }, 'Resend email'), ' '] : null, h('button', { class: 'btn secondary sm', onclick: () => roleModal(u) }, 'Change role'), ' ',
            h('button', { class: `btn sm ${u.accountStatus === 'active' ? 'danger' : ''}`, onclick: async () => { const next = u.accountStatus === 'active' ? 'suspended' : 'active'; if (next === 'suspended' && !(await confirmDialog(`Suspend ${u.fullName}? They will not be able to log in.`, { danger: true, confirmText: 'Suspend' }))) return; try { await patch(`/admin/users/${u._id}/status`, { accountStatus: next }); load(); } catch (e) { toast(e.message, 'error'); } } }, u.accountStatus === 'active' ? 'Suspend' : 'Reactivate')])))),
          pager(r.pagination, (p) => { state.page = p; load(); }));
      } catch (e) { clear(host).append(alertBox(e.message)); }
    }
    load();
  },

  async reports() {
    const state = { from: '', to: '', department: '', status: '' }; const host = h('div', { class: 'stack' });
    const dept = h('select', { 'aria-label': 'Department', onchange: (e) => { state.department = e.target.value; load(); } }, h('option', { value: '' }, 'All departments'));
    get('/departments?includeInactive=1').then((r) => dept.append(...r.items.map((d) => h('option', { value: d._id }, d.name)))).catch(() => {});
    main.append(title('Reports', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: (e) => withBusy(e.currentTarget, () => downloadFile('/admin/reports/export' + qs(state), 'psrs-requests.csv').catch((err) => toast(err.message, 'error'))) }, 'Export CSV')),
      h('div', { class: 'filters' }, h('div', { class: 'field' }, h('label', { for: 'rf' }, 'From'), h('input', { id: 'rf', type: 'date', onchange: (e) => { state.from = e.target.value; load(); } })), h('div', { class: 'field' }, h('label', { for: 'rt' }, 'To'), h('input', { id: 'rt', type: 'date', onchange: (e) => { state.to = e.target.value; load(); } })), dept,
        h('select', { 'aria-label': 'Status', onchange: (e) => { state.status = e.target.value; load(); } }, h('option', { value: '' }, 'All statuses'), Object.entries(STATUS_LABEL).map(([v, l]) => h('option', { value: v }, l)))), host);
    const mini = (heads, rows) => (rows.length ? table(heads, rows.map((r) => h('tr', {}, r.map((c) => td(c))))) : h('p', { class: 'muted' }, 'No data for these filters.'));
    async function load() {
      clear(host).append(loading());
      try { const r = await get('/admin/reports' + qs(state)); const t = r.totals; clear(host);
        host.append(h('div', { class: 'grid g4' }, metric('Requests received', t.received), metric('Resolved in range', t.resolvedInRange, 'green'), metric('Outstanding', t.outstanding, 'amber'), metric('Awaiting information', t.awaitingInformation, 'amber'), metric('Avg processing (days)', t.avgProcessingDays ?? 'n/a')),
          h('div', { class: 'grid g2' }, h('div', {}, h('h3', {}, 'By status'), mini(['Status', 'Requests'], r.byStatus.map((x) => [STATUS_LABEL[x.name] || x.name, x.count]))), h('div', {}, h('h3', {}, 'By department'), mini(['Department', 'Requests'], r.byDepartment.map((x) => [x.name, x.count])))),
          h('div', { class: 'grid g2' }, h('div', {}, h('h3', {}, 'By service'), mini(['Service', 'Requests'], r.byService.map((x) => [x.name, x.count]))), h('div', {}, h('h3', {}, 'Officer workload (open requests)'), mini(['Officer', 'Open'], r.officerWorkload.map((x) => [x.name, x.open])))));
      } catch (e) { clear(host).append(alertBox(e.message)); }
    }
    load();
  },

  async 'audit-logs'() {
    const state = { action: '', page: 1, limit: 20 }; const host = h('div', {});
    main.append(title('Audit logs'), h('div', { class: 'filters' }, h('input', { type: 'search', placeholder: 'Action prefix, e.g. request or user', 'aria-label': 'Filter by action', oninput: debounce((e) => { state.action = e.target.value.trim(); state.page = 1; load(); }) })), host);
    async function load() {
      clear(host).append(loading());
      try { const r = await get('/admin/audit-logs' + qs(state)); clear(host);
        host.append(r.items.length ? table(['When', 'Actor', 'Action', 'Entity', 'Details'], r.items.map((l) => h('tr', {}, td(fmtDate(l.createdAt, true)), td(l.actor ? `${l.actor.fullName} (${l.actor.role})` : 'System'), td(l.action), td(`${l.entityType || ''} ${l.entityId || ''}`), td(h('code', { class: 'small' }, JSON.stringify(l.metadata || {}).slice(0, 160))))), pager(r.pagination, (p) => { state.page = p; load(); })) : empty('No audit entries', 'Actions will be recorded here.'));
      } catch (e) { clear(host).append(alertBox(e.message)); }
    }
    load();
  },

  async settings() {
    main.append(title('Settings')); let data;
    try { data = await get('/admin/settings'); } catch (e) { return main.append(alertBox(e.message)); }
    const s = data.settings; const em = data.email;
    const status = h('div', { class: 'stack' }); const testTo = h('input', { type: 'email', id: 'testTo', placeholder: 'you@example.com', 'aria-label': 'Send a test email to', value: user.email });
    async function checkStatus(btn) {
      clear(status).append(h('p', { class: 'muted small' }, 'Checking...'));
      try {
        const r = await (btn ? withBusy(btn, () => get('/admin/email/status')) : get('/admin/email/status')); const st = r.status; clear(status);
        if (!st.configured) status.append(h('p', { class: 'muted small' }, 'Email is not configured on this server yet. The application will keep working without email until BREVO_API_KEY and BREVO_SENDER_EMAIL are provided in the server environment.'));
        else if (st.connected) status.append(h('p', {}, h('span', { class: 'status-dot ok' }), h('strong', {}, 'Connected to Brevo'), st.account ? ` (${st.account})` : '', h('br'), h('span', { class: 'muted small' }, `Sending as ${r.senderName || 'PSRS'} <${r.senderEmail}>`)));
        else status.append(alertBox(`Brevo rejected the connection: ${st.error}. Check the API key and that the sender address is verified in Brevo.`, 'error'));
      } catch (e) { clear(status).append(alertBox(e.message)); }
    }
    const f = h('form', { novalidate: true, class: 'stack' },
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h3', {}, '🏷️ General'), field({ label: 'Site name', name: 'siteName', required: true, value: s.siteName, maxlength: 40, hint: 'Shown in the navigation, footer and emails.' }), field({ label: 'Tagline', name: 'tagline', value: s.tagline, maxlength: 100, hint: 'Shown in the footer.' }),
          field({ label: 'Support email', name: 'supportEmail', type: 'email', value: s.supportEmail, hint: 'Shown in the footer and Help centre.' }), field({ label: 'Support phone', name: 'supportPhone', value: s.supportPhone }),
          field({ label: 'Site announcement', name: 'announcement', type: 'textarea', rows: 2, value: s.announcement, maxlength: 300, hint: 'A banner at the top of every page. Leave empty to hide.' })),
        h('div', { class: 'card' }, h('h3', {}, '🔐 Access and requests'),
          switchField({ label: 'Open registration', name: 'registrationOpen', checked: s.registrationOpen, hint: 'Turn off to stop new citizen sign-ups.' }),
          switchField({ label: 'Require email activation', name: 'requireEmailVerification', checked: s.requireEmailVerification, hint: em.configured ? 'New citizens must click the emailed link before they can log in.' : 'Needs Brevo to be set up first. Until then accounts activate immediately.' }),
          switchField({ label: 'Maintenance mode', name: 'maintenanceMode', checked: s.maintenanceMode, hint: 'Pauses new requests and shows a banner. Everything else keeps working.' }),
          switchField({ label: 'Citizens can cancel requests', name: 'allowCitizenCancel', checked: s.allowCitizenCancel, hint: 'While a request is still Submitted.' }),
          switchField({ label: 'Auto-assign new requests', name: 'autoAssign', checked: s.autoAssign, hint: 'Gives each new request to the least busy officer in its department.' }),
          field({ label: 'Maximum attachments per request', name: 'maxAttachments', type: 'number', min: '1', max: '10', value: s.maxAttachments }))),
      h('div', { class: 'card' }, h('h3', {}, '📧 Email (Brevo)'),
        h('div', { class: 'grid g2' }, h('div', { class: 'stack' }, status, h('div', { class: 'row' }, h('button', { class: 'btn secondary sm', type: 'button', onclick: (e) => checkStatus(e.currentTarget) }, 'Check connection')),
            h('div', { class: 'field', style: null }, h('label', { for: 'testTo' }, 'Send a test email to'), testTo, h('div', { class: 'row', style: null }, h('button', { class: 'btn secondary sm', type: 'button', onclick: async (e) => { try { const r = await withBusy(e.currentTarget, () => post('/admin/email/test', { to: testTo.value.trim() })); toast(r.message, 'success'); } catch (err) { toast(err.message, 'error'); } } }, 'Send test email'))),
            h('p', { class: 'hint' }, 'Emails send through Brevo once configured on the server.')),
          h('div', {}, switchField({ label: 'Send emails', name: 'emailEnabled', checked: s.emailEnabled, hint: 'Master switch for notification emails. Activation and password emails always send.' }),
            switchField({ label: 'Request received', name: 'emailOnSubmit', checked: s.emailOnSubmit, hint: 'Confirmation to the citizen.' }), switchField({ label: 'Status changes', name: 'emailOnStatus', checked: s.emailOnStatus, hint: 'Under review, in progress, resolved and so on.' }),
            switchField({ label: 'Comments and replies', name: 'emailOnComment', checked: s.emailOnComment }), switchField({ label: 'Assignments', name: 'emailOnAssign', checked: s.emailOnAssign, hint: 'Tells the officer a request is theirs.' })))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, '💾 Save settings'), h('a', { class: 'btn secondary', href: '/admin/audit-logs.html' }, 'View audit log (includes email activity)')));
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); clearErrors(f); const el = f.elements; const on = (n) => el[n].checked;
      const body = { siteName: el.siteName.value.trim(), tagline: el.tagline.value.trim(), supportEmail: el.supportEmail.value.trim(), supportPhone: el.supportPhone.value.trim(), announcement: el.announcement.value.trim(),
        registrationOpen: on('registrationOpen'), requireEmailVerification: on('requireEmailVerification'), maintenanceMode: on('maintenanceMode'), allowCitizenCancel: on('allowCitizenCancel'), autoAssign: on('autoAssign'), maxAttachments: Number(el.maxAttachments.value),
        emailEnabled: on('emailEnabled'), emailOnSubmit: on('emailOnSubmit'), emailOnStatus: on('emailOnStatus'), emailOnComment: on('emailOnComment'), emailOnAssign: on('emailOnAssign') };
      try { await withBusy(f.querySelector('button[type=submit]'), () => put('/admin/settings', body)); toast('Settings saved', 'success'); } catch (err) { showErrors(f, err); }
    });
    main.append(f); checkStatus();
  }
};

async function adminDashboard() {
  main.append(title('Administrator dashboard')); const stats = h('div', { class: 'metrics' }, loading()); const charts = h('div', { class: 'charts' }); main.append(stats, h('div', { style: null }), charts);
  try {
    const [d] = await Promise.all([get('/admin/dashboard'), loadChart()]); const m = d.metrics; const c = d.charts;
    clear(stats).append(metric('Open cases', m.openCases, 'amber'), metric('Resolved cases', m.resolved, 'green'), metric('Resolution rate', m.resolutionRate + '%', 'green'), metric('Total requests', m.total), metric('New (last 7 days)', m.newSubmissions, 'blue'), metric('Pending review', m.pendingReview, 'amber'), metric('Awaiting information', m.awaitingInformation, 'amber'), metric('In progress', m.inProgress, 'blue'), metric('Rejected', m.rejected, 'red'), metric('Avg resolution (days)', m.avgResolutionDays ?? 'n/a'));
    const [c0, o] = chartCard('Open vs resolved cases', 'c-a'), [c1, a] = chartCard('Requests by status', 'c-b'), [c2, b] = chartCard('Requests by department', 'c-c'), [c3, cc] = chartCard('Requests over time (30 days)', 'c-d'), [c4, dd] = chartCard('Average days to resolve, by month', 'c-e');
    charts.append(c0, c1, c2, c3, c4);
    const keys = Object.keys(c.byStatus); const opts = { responsive: true, maintainAspectRatio: false };
    const ov = c.openVsResolved;
    new window.Chart(o, { type: 'doughnut', data: { labels: ['Open', 'Resolved', 'Rejected or cancelled'], datasets: [{ data: [ov.open, ov.resolved, ov.closedOther], backgroundColor: ['#d97706', '#16a34a', '#6b7280'] }] }, options: opts });
    new window.Chart(a, { type: 'doughnut', data: { labels: keys.map((k) => STATUS_LABEL[k]), datasets: [{ data: keys.map((k) => c.byStatus[k]), backgroundColor: keys.map((k) => COLORS[k]) }] }, options: opts });
    new window.Chart(b, { type: 'bar', data: { labels: c.byDepartment.map((x) => x.name), datasets: [{ label: 'Requests', data: c.byDepartment.map((x) => x.count), backgroundColor: '#13315c' }] }, options: { ...opts, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    new window.Chart(cc, { type: 'line', data: { labels: c.overTime.map((x) => x.date), datasets: [{ label: 'Submitted', data: c.overTime.map((x) => x.count), borderColor: '#14532d', tension: .25 }] }, options: { ...opts, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    new window.Chart(dd, { type: 'line', data: { labels: c.resolutionTrend.map((x) => x.month), datasets: [{ label: 'Avg days', data: c.resolutionTrend.map((x) => x.avgDays), borderColor: '#d97706', tension: .25 }] }, options: { ...opts, scales: { y: { beginAtZero: true } } } });
  } catch (e) { clear(stats).append(alertBox(e.message)); }
}

await (pages[page] || (() => main.append(alertBox('Page not found'))))();
