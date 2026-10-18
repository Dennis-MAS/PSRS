import { api, get, patch, post } from './api.js';
import { switchField, alertBox, clear, clearErrors, empty, field, fmtDate, h, loading, showErrors, toast, withBusy, STATUS_LABEL } from './utilities.js';
import { cacheUser, mountDashboard, publicSettings } from './layout.js';
import { renderNotifications, renderRequestDetail, requestsTable } from './requests.js';

const { main, user } = await mountDashboard(['citizen'], 'citizen');
const page = document.body.dataset.page;
const title = (t, ...extra) => h('div', { class: 'page-head' }, h('h1', {}, t), ...extra);

const pages = {
  async dashboard() {
    main.append(title(`Welcome, ${user.fullName.split(' ')[0]}`));
    const stats = h('div', { class: 'grid g4' }, loading());
    main.append(stats);
    get('/requests/my/stats').then(({ stats: s }) => {
      const tiles = [['Total requests', s.total, ''], ['Submitted', s.SUBMITTED, 'blue'], ['Under review', s.UNDER_REVIEW, 'amber'], ['Awaiting information', s.AWAITING_INFORMATION, 'amber'], ['In progress', s.IN_PROGRESS, 'blue'], ['Resolved', s.RESOLVED, 'green'], ['Rejected', s.REJECTED, 'red']];
      clear(stats).append(...tiles.map(([l, n, c]) => h('div', { class: `card metric ${c}` }, h('span', { class: 'n' }, n), h('span', { class: 'l' }, l))));
    }).catch((e) => clear(stats).append(alertBox(e.message)));
    main.append(h('div', { class: 'card', style: null }, h('h3', {}, 'Quick actions'), h('div', { class: 'row' }, h('a', { class: 'btn', href: '/citizen/submit-request.html' }, 'Submit a Request'), h('a', { class: 'btn secondary', href: '/services.html' }, 'Browse Services'),
      h('a', { class: 'btn secondary', href: '/citizen/my-requests.html' }, 'View All Requests'), h('a', { class: 'btn secondary', href: '/citizen/notifications.html' }, 'View Notifications'), h('a', { class: 'btn secondary', href: '/citizen/profile.html' }, 'Update Profile'))));
    const host = h('div', {}); main.append(h('h2', {}, 'Recent requests'), host); requestsTable(host, user, { limit: 5 });
  },

  async 'my-requests'() { main.append(title('My requests', h('span', { class: 'grow' }), h('a', { class: 'btn', href: '/citizen/submit-request.html' }, 'Submit a request'))); const host = h('div', {}); main.append(host); requestsTable(host, user); },
  async 'request-details'() { await renderRequestDetail(main, user, new URLSearchParams(location.search).get('id')); },
  async notifications() { await renderNotifications(main, user); },

  async 'submit-request'() {
    main.append(title('Submit a request'));
    let services;
    try { services = (await get('/services?limit=100')).items; } catch (e) { return main.append(alertBox(e.message)); }
    if (!services.length) return main.append(empty('No services are available', 'An administrator has not activated any services yet.'));
    const cfg = await publicSettings(); const maxFiles = cfg.maxAttachments || 5;
    if (cfg.maintenanceMode) main.append(alertBox('The system is in maintenance mode, so new requests are paused for now. Please come back soon.', 'warn'));
    let key = crypto.randomUUID();
    const pre = new URLSearchParams(location.search).get('service');
    const info = h('div', { class: 'alert info', hidden: true });
    const files = h('input', { type: 'file', id: 'files', name: 'files', multiple: true, accept: '.pdf,.jpg,.jpeg,.png' });
    const decl = h('input', { type: 'checkbox', id: 'declaration', name: 'declaration' });
    const f = h('form', { class: 'card', novalidate: true },
      field({ label: 'Category', name: 'service', type: 'select', required: true, value: pre || '', options: [{ value: '', label: 'Choose a category (e.g. streetlight, water, garbage)' }, ...services.map((s) => ({ value: s._id, label: `${s.name} (${s.department?.name})` }))] }), info,
      field({ label: 'Request title', name: 'title', required: true, maxlength: 150 }), field({ label: 'Detailed description', name: 'description', type: 'textarea', required: true, rows: 6, maxlength: 4000 }),
      field({ label: 'Location', name: 'location', required: true, maxlength: 200, hint: 'Street, estate, ward or landmark where the problem is.' }),
      field({ label: 'Contact preference', name: 'contactPreference', type: 'select', value: 'email', options: [{ value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }] }),
      h('div', { class: 'field', 'data-field': 'files' }, h('label', { for: 'files' }, 'Photo or document (optional)'), files, h('div', { class: 'hint', id: 'fileHint' }, 'PDF, JPEG or PNG. Choose a service to see limits.'), h('div', { class: 'field-error' })),
      h('div', { class: 'field', 'data-field': 'declaration' }, h('label', { class: 'check', for: 'declaration' }, decl, 'I confirm the information I have provided is accurate.'), h('div', { class: 'field-error' })),
      h('button', { class: 'btn', type: 'submit' }, 'Submit request'));
    main.append(f);
    const current = () => services.find((s) => s._id === f.elements.service.value);
    function showService() {
      const s = current(); info.hidden = !s; if (!s) return;
      clear(info).append(h('strong', {}, s.name), h('div', {}, s.instructions || s.description), s.requiredInformation?.length ? h('div', { class: 'small' }, 'Have ready: ' + s.requiredInformation.join('; ')) : null);
      document.getElementById('fileHint').textContent = `${s.allowedAttachmentTypes.map((t) => t.split('/')[1].toUpperCase()).join(', ')}, up to ${(s.maximumAttachmentSize / 1048576).toFixed(1)} MB each, max ${maxFiles} files.`;
    }
    f.elements.service.addEventListener('change', showService); showService();

    f.addEventListener('submit', async (e) => {
      e.preventDefault(); clearErrors(f);
      const s = current(); const chosen = [...files.files];
      const bad = {};
      if (!s) bad.service = 'Choose a category';
      if (!f.elements.location.value.trim()) bad.location = 'Tell us where the problem is';
      if (!f.elements.title.value.trim()) bad.title = 'Enter a title';
      if (f.elements.description.value.trim().length < 10) bad.description = 'Describe the request in at least 10 characters';
      if (!decl.checked) bad.declaration = 'You must confirm the information is accurate';
      if (s) for (const file of chosen) { if (!s.allowedAttachmentTypes.includes(file.type)) bad.files = `${file.name}: file type not allowed`; else if (file.size > s.maximumAttachmentSize) bad.files = `${file.name}: file is too large`; }
      if (chosen.length > maxFiles) bad.files = `You can attach at most ${maxFiles} files`;
      if (cfg.maintenanceMode) bad.service = 'New requests are paused during maintenance';
      if (Object.keys(bad).length) return showErrors(f, { status: 422, message: 'Please fix the highlighted fields.', fields: bad }); // values stay in the form
      try {
        const r = await withBusy(f.querySelector('button[type=submit]'), async () => {
          const res = await post('/requests', { service: s._id, title: f.elements.title.value.trim(), description: f.elements.description.value.trim(), location: f.elements.location.value.trim() || undefined, contactPreference: f.elements.contactPreference.value, declaration: true, submissionKey: key });
          const failed = [];
          for (const file of chosen) { const fd = new FormData(); fd.append('file', file); try { await api(`/requests/${res.request._id}/attachments`, { method: 'POST', form: fd }); } catch (err) { failed.push(`${file.name}: ${err.message}`); } }
          return { ...res, failed };
        });
        key = crypto.randomUUID(); clear(main);
        main.append(title('Request submitted'), h('div', { class: 'card stack center' }, h('p', { class: 'muted' }, 'Your reference number'), h('p', { style: null, class: 'n' }, h('strong', { class: 'ref', id: 'refno' }, r.request.referenceNumber)),
          r.failed.length ? alertBox('Some files could not be attached: ' + r.failed.join(' | '), 'warn') : null,
          h('p', {}, 'Keep this number to follow your request. You will be notified when its status changes.'), h('div', { class: 'row', style: null }, h('a', { class: 'btn', href: `/citizen/request-details.html?id=${r.request._id}` }, 'Track this request'), h('a', { class: 'btn secondary', href: '/citizen/dashboard.html' }, 'Back to dashboard'))));
      } catch (err) { showErrors(f, err); }
    });
  },

  async profile() {
    main.append(title('Profile'));
    let me = user; try { me = (await get('/auth/me')).user; } catch { /* fall back to cached details */ }
    const f = h('form', { class: 'card', novalidate: true }, h('h3', {}, 'Your details'), field({ label: 'Full name', name: 'fullName', required: true, value: me.fullName }), field({ label: 'Email', name: 'email', value: me.email, disabled: true, hint: 'Email cannot be changed.' }),
      field({ label: 'Phone number', name: 'phone', type: 'tel', value: me.phone || '' }), switchField({ label: 'Email me about updates', name: 'emailNotifications', checked: me.emailNotifications !== false, hint: 'Get an email when your request is received, updated or commented on. In-app notifications always stay on.' }), h('button', { class: 'btn', type: 'submit' }, 'Save changes'));
    f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f); try { const r = await withBusy(f.querySelector('button'), () => patch('/auth/me', { fullName: f.elements.fullName.value, phone: f.elements.phone.value, emailNotifications: f.elements.emailNotifications.checked })); cacheUser(r.user); toast('Profile saved', 'success'); } catch (err) { showErrors(f, err); } });
    const p = h('form', { class: 'card', novalidate: true }, h('h3', {}, 'Change password'), field({ label: 'Current password', name: 'currentPassword', type: 'password', required: true, autocomplete: 'current-password' }),
      field({ label: 'New password', name: 'newPassword', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters with upper case, lower case and a number.' }), h('button', { class: 'btn', type: 'submit' }, 'Change password'));
    p.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(p); try { await withBusy(p.querySelector('button'), () => post('/auth/change-password', { currentPassword: p.elements.currentPassword.value, newPassword: p.elements.newPassword.value })); toast('Password changed', 'success'); p.reset(); } catch (err) { showErrors(p, err); } });
    main.append(h('div', { class: 'grid g2' }, f, p));
  }
};
await (pages[page] || (() => main.append(alertBox('Page not found'))))();
