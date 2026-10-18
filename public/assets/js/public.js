// Public (logged-out) pages: home, info pages, services, login, registration, tracker.
import { get, post, qs, setCsrf } from './api.js';
import { HOME, STATUS_LABEL, alertBox, clear, clearErrors, debounce, empty, field, fmtDate, h, loading, pager, progressTracker, showErrors, statusBadge, toast, withBusy } from './utilities.js';
import { cacheUser, mountPublic, publicSettings } from './layout.js';

const { main, user } = await mountPublic();
const page = document.body.dataset.page;
const IMG = (n) => `/assets/images/${n}.svg`;
const img = (n, alt, cls = '') => h('img', { src: IMG(n), alt, class: cls, loading: 'lazy', width: 360 });
const section = (cls, ...kids) => h('section', { class: `section ${cls || ''}` }, h('div', { class: 'container' }, kids));
const safeNext = () => { const n = new URLSearchParams(location.search).get('next'); return n && n.startsWith('/') && !n.startsWith('//') ? n : null; };
const link = (t, href, cls = '') => h('a', { href, class: cls }, t);
const faq = (items) => items.map(([q, a]) => h('details', {}, h('summary', {}, q), h('p', { class: 'muted' }, a)));

function wave() { // decorative curve (SVG needs the SVG namespace)
  const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 1440 56'); s.setAttribute('preserveAspectRatio', 'none'); s.setAttribute('class', 'wave'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M0 56V30Q360-6 720 26T1440 18V56Z'); s.append(p); return s;
}
const pageHero = (title, lead, image, alt) => h('section', { class: 'page-hero' }, h('div', { class: 'container' }, h('div', {}, h('h1', {}, title), h('p', {}, lead)), img(image, alt)));
const cta = (title, text) => h('div', { class: 'cta-band' }, h('h2', {}, title), h('p', {}, text), h('div', { class: 'row', style: null }, link('Create a free account', '/register.html', 'btn'), ' ', link('Explore services', '/services.html', 'btn')));

function serviceCard(s) {
  return h('article', { class: 'card hover svc-card' }, h('div', { class: 'icon', 'aria-hidden': 'true' }, s.icon || '📄'), h('h3', {}, s.name), h('p', { class: 'muted' }, s.description),
    h('div', { class: 'meta' }, `${s.department?.name || ''} · about ${s.estimatedProcessingDays} day${s.estimatedProcessingDays === 1 ? '' : 's'} (illustrative)`), link('View details', `/service-details.html?slug=${encodeURIComponent(s.slug)}`, 'btn secondary sm'));
}
const termsNote = h('p', { class: 'small muted' }, 'By continuing you agree to our ', h('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, 'Terms & Conditions'), ' and ', h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy Notice'), '.');

const STEPS = [
  ['step-account', 'Create an account', 'Register with your name, email and a password. Accept the terms and you are in within a minute.', ['Free for every citizen', 'Passwords are stored hashed', 'Only you can see your requests']],
  ['step-service', 'Select a service', 'Browse categories such as streetlights, water issues and garbage collection, and read what each one needs.', ['Search or filter by department', 'See illustrative processing times', 'Read the instructions first']],
  ['step-submit', 'Submit a request', 'Pick the category, tell us where the problem is, describe it and optionally attach a photo.', ['Location and description required', 'Photo or PDF is optional', 'You get a unique reference number']],
  ['step-track', 'Track progress online', 'Follow your request from Pending to In Progress to Resolved, and reply if an officer needs more information.', ['Notifications for every change', 'Full timeline of what happened', 'Track with just the reference number']]
];

const pages = {
  async home() {
    main.append(h('section', { class: 'hero' }, h('div', { class: 'container' },
      h('div', { class: 'stack' }, h('span', { class: 'chip' }, '🌈 Friendly · Free · Fast'), h('h1', {}, 'Public Services, ', h('em', {}, 'Made Simpler.')), h('p', {}, 'Submit public service requests, track progress, and stay informed through one convenient digital platform.'),
        h('div', { class: 'row' }, link('Explore Services', '/services.html', 'btn'), link('Submit a Request', '/citizen/submit-request.html', 'btn ghost')),
        h('div', { class: 'row' }, ['💡 Streetlights|streetlight', '🚰 Water|water', '🗑️ Garbage|garbage', '🚧 Roads|infrastructure'].map((c) => { const [t, q] = c.split('|'); return link(t, `/services.html?q=${q}`, 'chip'); }))),
      img('hero-city', 'A friendly neighbourhood with a streetlight, a tap and a bin', 'art'))), wave());
    const list = h('div', { class: 'grid g3' }, loading());
    main.append(section('', h('h2', { class: 'title' }, 'Services you can request'), h('p', { class: 'lead' }, 'Pick a category and tell us what needs fixing. Every service is an example category for this demonstration.'), list, h('p', { class: 'center' }, h('br'), link('See all services →', '/services.html', 'btn secondary'))));
    get('/services?limit=6').then((r) => { clear(list).append(...(r.items.length ? r.items.map(serviceCard) : [empty('No services available yet', 'Check back soon.')])); }).catch((e) => clear(list).append(alertBox(e.message)));
    main.append(h('section', { class: 'section alt', id: 'how' }, h('div', { class: 'container' }, h('h2', { class: 'title' }, 'How it works'), h('p', { class: 'lead' }, 'Four easy steps from problem to solution.'),
      h('ol', { class: 'steps' }, STEPS.map(([i, t, d]) => h('li', {}, img(i, t), h('h3', {}, t), h('p', { class: 'muted' }, d)))), h('p', { class: 'center' }, h('br'), link('See the full walkthrough →', '/how-it-works.html', 'btn secondary')))));
    main.append(section('', h('h2', { class: 'title' }, 'Why you will love PSRS'), h('div', { class: 'grid g3' },
      [['📱', 'Accessible', 'Request services from any device, at any hour.', 'sky'], ['🔍', 'Transparent', 'See every status change and officer comment in one place.', 'mint'], ['🛡️', 'Private', 'You only ever see your own requests.', 'lav'], ['⚡', 'Efficient', 'Officers see assigned work and respond faster.', 'lemon'], ['🧾', 'Accountable', 'Every change is recorded with who did it and why.', 'peach'], ['📂', 'Organised', 'Requests, photos and replies stay together.', 'pink']]
        .map(([e, t, d, c]) => h('div', { class: `card hover tint-${c}` }, h('div', { style: null, class: 'icon' }, e), h('h3', {}, `${e} ${t}`), h('p', {}, d))))));
    main.append(h('section', { class: 'section alt', id: 'help' }, h('div', { class: 'container' }, h('h2', { class: 'title' }, 'Quick answers'), faq([
      ['Does PSRS issue official documents?', 'No. This is an independent demonstration project. Requests are example categories and no real government documents are issued.'],
      ['How do I follow my request?', 'Log in and open your dashboard, or use Track with your reference number. Each request shows a progress tracker and timeline.'],
      ['Can I cancel a request?', 'Yes, while it is still pending and has not started review.']]), h('p', { class: 'center' }, h('br'), link('Visit the Help centre →', '/help.html', 'btn secondary')))));
    main.append(section('', cta('Ready to get something fixed?', 'Create an account in a minute and send your first request.')));
  },

  async 'how-it-works'() {
    main.append(pageHero('How it works', 'From “this needs fixing” to “it is fixed”, in four simple steps. Here is exactly what happens at each stage.', 'step-track', 'A progress tracker with a map pin'));
    main.append(section('', ...STEPS.map(([i, t, d, pts], n) => h('div', { class: `split ${n % 2 ? 'flip' : ''}` }, h('div', { class: 'stack' }, h('span', { class: 'chip' }, `Step ${n + 1}`), h('h2', {}, t), h('p', {}, d), h('ul', { class: 'pointlist' }, pts.map((p) => h('li', {}, p)))), img(i, t)))));
    main.append(h('section', { class: 'section alt' }, h('div', { class: 'container' }, h('h2', { class: 'title' }, 'The journey of a request'), h('p', { class: 'lead' }, 'Citizens see three simple stages. Behind the scenes officers use a few more detailed statuses.'),
      h('div', { class: 'card stack' }, progressTracker('IN_PROGRESS'), h('p', { class: 'muted center small' }, 'Example: this request is currently In Progress.')),
      h('div', { class: 'grid g3', style: null }, [['SUBMITTED', 'Your request arrived and has a reference number.'], ['UNDER_REVIEW', 'An officer is checking the details.'], ['AWAITING_INFORMATION', 'The officer needs something from you. Reply in the comments.'], ['IN_PROGRESS', 'Work to fix the issue has started.'], ['RESOLVED', 'The issue is sorted and you are notified.'], ['REJECTED', 'It could not be accepted, and you are told why. You can also cancel while it is still pending.']].map(([s, d]) => h('div', { class: 'card flat' }, statusBadge(s), h('p', { class: 'muted' }, d)))))));
    main.append(section('', h('h2', { class: 'title' }, 'Who does what'), h('div', { class: 'grid g3' },
      [['🧑', 'Citizens', 'Register, submit requests, add photos, reply to officers, cancel pending requests and follow progress.', 'mint'], ['🧑‍🔧', 'Service officers', 'Review requests for their department, assign work, update statuses, comment and keep internal notes.', 'sky'], ['🛡️', 'Administrators', 'Manage users, services and departments, watch analytics, export reports and review the audit log.', 'lav']].map(([e, t, d, c]) => h('div', { class: `card hover tint-${c}` }, h('h3', {}, `${e} ${t}`), h('p', {}, d)))),
      h('p', { class: 'center' }, h('br'), link('Track a request now', '/track.html', 'btn secondary'))));
    main.append(section('', cta('Try it yourself', 'It takes about a minute to sign up.')));
  },

  async help() {
    const contact = h('p', { class: 'muted' }, 'Support details have not been set up yet.');
    main.append(pageHero('Help centre', 'Answers to common questions, and where to go when you are stuck.', 'help-support', 'A friendly support chat'));
    main.append(section('', h('div', { class: 'row', style: null }, [['📍 Track a request', '/track.html'], ['✍️ Register', '/register.html'], ['🔑 Citizen login', '/login.html'], ['🔁 Reset password', '/forgot-password.html'], ['🛡️ Staff portal', '/staff-login.html'], ['📜 Terms', '/terms.html']].map(([t, u]) => link(t, u, 'chip'))), h('br'),
      h('div', { class: 'grid g2' }, h('div', {}, h('h2', {}, 'Getting started'), faq([['How do I create an account?', 'Choose Register, fill in your details, accept the Terms and Conditions and create your account. You are signed in straight away.'], ['What is a reference number?', 'Every request gets a unique number like PSRS-2026-000123. Use it on the Track page to see the status without logging in.'], ['Is PSRS an official government service?', 'No. It is an independent demonstration and is not affiliated with the Government of Kenya or eCitizen.']]),
        h('h2', {}, 'Requests'), faq([['What can I report?', 'Streetlights, water issues, garbage collection, infrastructure, complaints, inquiries and more. Pick the closest category.'], ['What does Awaiting information mean?', 'An officer needs more details. Open the request and reply in the comments, and it goes back to review.'], ['Can I cancel?', 'Yes, from the request page while the status is still Submitted.'], ['How long will it take?', 'Each service shows an illustrative time. Real times depend on the officers handling your request.']])),
      h('div', {}, h('h2', {}, 'Photos & files'), faq([['Can I attach a photo?', 'Yes, optionally. JPEG, PNG or PDF files are accepted, within the size limit shown for the category.'], ['Who can see my photo?', 'Only you and the officers responsible for your request. Files are stored privately.'], ['My upload was rejected', 'Check the file type and size. Files are checked by their content, so renamed files are refused.']]),
        h('h2', {}, 'Accounts & security'), faq([['I forgot my password', 'Use Reset password and we will email you a link (valid for 30 minutes). If emails are not set up on this site, ask an administrator for help.'], ['I did not get my activation email', 'Check your spam folder, then use “Resend activation email” on the login page. The link works for 24 hours. An administrator can also activate your account.'], ['Why was I locked out?', 'After five wrong passwords your account pauses for 15 minutes to protect it.'], ['I am staff. Where do I log in?', 'Use the Staff portal. Staff accounts are created by an administrator and cannot sign in through the citizen login.']])))));
    main.append(h('section', { class: 'section alt' }, h('div', { class: 'container' }, h('div', { class: 'card tint-sky stack' }, h('h2', {}, '💬 Still stuck?'), contact))));
    get('/settings/public').then(({ settings: s }) => { if (s.supportEmail || s.supportPhone) clear(contact).append('Reach us at ', [s.supportEmail, s.supportPhone].filter(Boolean).join(' or '), '.'); }).catch(() => {});
  },

  async about() {
    main.append(pageHero('About PSRS', 'A friendly digital front desk for public services: report a problem, follow it through, and see it fixed.', 'about-team', 'Citizens, officers and administrators working together'));
    main.append(section('', h('div', { class: 'split' }, h('div', { class: 'stack' }, h('h2', {}, 'Our mission'), h('p', {}, 'The Public Service Request System shows how a mini eCitizen-style platform can work. Citizens submit requests, officers process them, and administrators watch over the whole service with clear numbers.'), h('p', {}, 'We care about three things: accessibility, accountability and transparency. Everyone can ask for help, every action is recorded, and everyone can see where their request stands.')), img('step-service', 'Service categories')),
      h('h2', { class: 'title' }, 'What we believe'), h('div', { class: 'grid g4' }, [['🤝', 'Accessible', 'Simple pages that work on phones and computers.', 'mint'], ['🔎', 'Transparent', 'Clear status and a full timeline.', 'sky'], ['🧾', 'Accountable', 'Every change has a name and a time.', 'lemon'], ['🔒', 'Private', 'Your data is only for you and your officer.', 'lav']].map(([e, t, d, c]) => h('div', { class: `card hover tint-${c}` }, h('h3', {}, `${e} ${t}`), h('p', {}, d))))));
    main.append(h('section', { class: 'section alt' }, h('div', { class: 'container' }, h('h2', { class: 'title' }, 'What it does'), h('div', { class: 'grid g3' },
      [['Citizens', ['Register and log in', 'Submit requests with category, location, description and an optional photo', 'Track progress and reply to officers']], ['Officers', ['See requests for their department', 'Assign and update statuses', 'Comment and keep internal notes']], ['Administrators', ['Manage users, services and departments', 'Open vs resolved analytics', 'Reports, CSV export and audit log']]].map(([t, pts]) => h('div', { class: 'card' }, h('h3', {}, t), h('ul', { class: 'pointlist' }, pts.map((p) => h('li', {}, p)))))),
      h('h2', { class: 'title', style: null }, h('br'), 'Built with'), h('div', { class: 'row', style: null }, ['HTML5', 'CSS3', 'Vanilla JavaScript', 'Node.js', 'Express', 'MongoDB', 'Mongoose', 'Chart.js'].map((t) => h('span', { class: 'chip' }, t))))));
    main.append(section('', h('div', { class: 'alert warn' }, h('strong', {}, 'Important: '), 'PSRS is an independent demonstration project. It is not affiliated with or endorsed by the Government of Kenya or eCitizen, uses no official logos and cannot issue real government documents.'), cta('Join in', 'Make a free account and try the whole journey.')));
  },

  async services() {
    const state = { q: new URLSearchParams(location.search).get('q') || '', department: '', page: 1, limit: 9 }; const results = h('div', {});
    const dept = h('select', { 'aria-label': 'Department', onchange: (e) => { state.department = e.target.value; state.page = 1; load(); } }, h('option', { value: '' }, 'All departments'));
    main.append(pageHero('Services directory', 'Find the category that matches your problem. These are example request categories for demonstration.', 'step-service', 'Service categories'),
      h('div', { class: 'container section' }, h('div', { class: 'filters' }, h('input', { type: 'search', value: state.q, placeholder: '🔍 Search services', 'aria-label': 'Search services', oninput: debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }) }), dept), results));
    get('/departments').then((r) => dept.append(...r.items.map((d) => h('option', { value: d._id }, d.name)))).catch(() => {});
    async function load() {
      clear(results).append(loading());
      try { const r = await get('/services' + qs(state)); clear(results);
        if (!r.items.length) return results.append(empty('No services found', 'Try a different search or department.'));
        results.append(h('div', { class: 'grid g3' }, r.items.map(serviceCard)), pager(r.pagination, (p) => { state.page = p; load(); }));
      } catch (e) { clear(results).append(alertBox(e.message)); }
    }
    load();
  },

  async 'service-details'() {
    const slug = new URLSearchParams(location.search).get('slug'); const box = h('div', { class: 'container section' }, loading()); main.append(box);
    if (!slug) return clear(box).append(alertBox('No service selected.'), link('← Back to services', '/services.html', 'btn secondary'));
    try {
      const { service: s } = await get(`/services/${encodeURIComponent(slug || '')}`); clear(box);
      box.append(h('p', {}, link('← Back to services', '/services.html')), h('div', { class: 'card stack' }, h('div', { class: 'svc-card' }, h('div', { class: 'icon' }, s.icon)), h('h1', {}, s.name), h('p', {}, s.description),
        h('dl', { class: 'kv' }, h('div', {}, h('dt', {}, 'Department'), h('dd', {}, s.department?.name)), h('div', {}, h('dt', {}, 'Illustrative processing time'), h('dd', {}, `about ${s.estimatedProcessingDays} days`)), h('div', {}, h('dt', {}, 'Attachments'), h('dd', {}, `${s.allowedAttachmentTypes.map((t) => t.split('/')[1].toUpperCase()).join(', ')}, up to ${(s.maximumAttachmentSize / 1048576).toFixed(1)} MB`))),
        s.instructions ? h('div', {}, h('h3', {}, 'Instructions'), h('p', {}, s.instructions)) : null, s.requiredInformation?.length ? h('div', {}, h('h3', {}, 'Information you will need'), h('ul', { class: 'pointlist' }, s.requiredInformation.map((x) => h('li', {}, x)))) : null,
        h('div', {}, link('Submit a request', `/citizen/submit-request.html?service=${s._id}`, 'btn'))));
    } catch (e) { clear(box).append(alertBox(e.status === 404 ? 'That service was not found.' : e.message)); }
  },

  async login() {
    if (user) return location.replace(HOME[user.role]);
    const f = h('form', { novalidate: true }, field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'username' }), field({ label: 'Password', name: 'password', type: 'password', required: true, autocomplete: 'current-password' }),
      h('button', { class: 'btn', type: 'submit' }, 'Log in'), h('p', { class: 'small' }, link('Forgot your password?', '/forgot-password.html')));
    f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f); if (!f.reportValidity()) return;
      try { const r = await withBusy(f.querySelector('button'), () => post('/auth/login', { email: f.elements.email.value, password: f.elements.password.value, portal: 'citizen' })); setCsrf(r.csrfToken); cacheUser(r.user); location.href = safeNext() || HOME[r.user.role]; } catch (err) {
        showErrors(f, err);
        if (err.fields?.activation) f.querySelector('.form-alert').append(h('button', { class: 'btn secondary sm', type: 'button', onclick: async (e) => { await withBusy(e.currentTarget, () => post('/auth/resend-activation', { email: f.elements.email.value })).catch(() => {}); toast('If your account is waiting for activation, a new email is on its way.', 'success'); } }, '📧 Resend activation email')); } });
    main.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' }, h('div', { class: 'auth-badge' }, '🎈'), h('h1', {}, 'Welcome back!'), h('p', { class: 'muted' }, 'Log in to submit and track your requests.'), f, termsNote, h('hr'), h('p', { class: 'small muted' }, 'New here? ', link('Create an account', '/register.html')), h('p', { class: 'small muted' }, 'Officer or administrator? ', link('Go to the Staff portal', '/staff-login.html')))));
  },

  async 'staff-login'() {
    if (user) return location.replace(HOME[user.role]);
    const f = h('form', { novalidate: true }, field({ label: 'Staff email', name: 'email', type: 'email', required: true, autocomplete: 'username' }), field({ label: 'Password', name: 'password', type: 'password', required: true, autocomplete: 'current-password' }), h('button', { class: 'btn', type: 'submit' }, 'Enter staff portal'));
    f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f); if (!f.reportValidity()) return;
      try { const r = await withBusy(f.querySelector('button'), () => post('/auth/login', { email: f.elements.email.value, password: f.elements.password.value, portal: 'staff' })); setCsrf(r.csrfToken); cacheUser(r.user); location.href = safeNext() || HOME[r.user.role]; } catch (err) { showErrors(f, err); } });
    main.append(h('div', { class: 'auth-wrap staff' }, h('div', { class: 'card auth-card' }, h('div', { class: 'auth-badge' }, '🛡️'), h('h1', {}, 'Staff portal'), h('p', { class: 'muted' }, 'For service officers and administrators. Staff accounts are created by an administrator.'), f, termsNote, h('hr'), h('p', { class: 'small muted' }, 'Not staff? ', link('Citizen login', '/login.html')))));
  },

  async register() {
    if (user) return location.replace(HOME[user.role]);
    const cfg = await publicSettings();
    if (cfg.registrationOpen === false) return main.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-card center' }, h('div', { class: 'auth-badge' }, '🚪'), h('h1', {}, 'Registration is closed'), h('p', { class: 'muted' }, 'New accounts are paused right now. If you already have an account you can still log in.'), link('Go to login', '/login.html', 'btn'))));
    const accept = h('input', { type: 'checkbox', id: 'acceptTerms', name: 'acceptTerms' });
    const f = h('form', { novalidate: true }, field({ label: 'Full name', name: 'fullName', required: true, autocomplete: 'name' }), field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'email' }),
      field({ label: 'Phone number', name: 'phone', type: 'tel', autocomplete: 'tel', hint: 'Optional, e.g. +254 700 000 000' }), field({ label: 'Password', name: 'password', type: 'password', required: true, autocomplete: 'new-password', minlength: 8, hint: 'At least 8 characters with upper case, lower case and a number.' }),
      field({ label: 'Confirm password', name: 'confirmPassword', type: 'password', required: true, autocomplete: 'new-password' }),
      h('div', { class: 'field', 'data-field': 'acceptTerms' }, h('label', { class: 'check', for: 'acceptTerms' }, accept, h('span', {}, 'I have read and accept the ', h('a', { href: '/terms.html', target: '_blank', rel: 'noopener' }, 'Terms & Conditions'), ' and ', h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy Notice'), '.')), h('div', { class: 'field-error' })),
      h('button', { class: 'btn', type: 'submit' }, 'Create account'));
    f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f);
      const bad = {}; if (f.elements.password.value !== f.elements.confirmPassword.value) bad.confirmPassword = 'Passwords do not match'; if (!accept.checked) bad.acceptTerms = 'You must accept the Terms and Conditions';
      if (Object.keys(bad).length) return showErrors(f, { status: 422, message: 'Please fix the highlighted fields.', fields: bad });
      if (!f.reportValidity()) return;
      try { const r = await withBusy(f.querySelector('button'), () => post('/auth/register', { fullName: f.elements.fullName.value, email: f.elements.email.value, phone: f.elements.phone.value, password: f.elements.password.value, confirmPassword: f.elements.confirmPassword.value, acceptTerms: true })); if (r.requiresActivation) return showInbox(f.elements.email.value, r); setCsrf(r.csrfToken); cacheUser(r.user); location.href = HOME.citizen; } catch (err) { showErrors(f, err); } });
    const card = h('div', { class: 'card auth-card' });
    function showInbox(addr, r) { // account created, waiting for the emailed activation link
      clear(card).append(h('div', { class: 'auth-badge' }, '📬'), h('h1', {}, 'Check your inbox'), h('p', {}, 'We sent an activation link to ', h('strong', {}, addr), '. Open it to activate your account, then log in.'), r.emailSent ? null : alertBox(r.message, 'warn'), h('p', { class: 'small muted' }, 'The link works for 24 hours. Check your spam folder if you cannot find it.'),
        h('div', { class: 'row' }, h('button', { class: 'btn secondary', type: 'button', onclick: async (e) => { await withBusy(e.currentTarget, () => post('/auth/resend-activation', { email: addr })).catch(() => {}); toast('Another email is on its way.', 'success'); } }, 'Resend email'), link('Go to login', '/login.html', 'btn')));
    }
    main.append(h('div', { class: 'auth-wrap' }, card)); card.append(h('div', { class: 'auth-badge' }, '🌱'), h('h1', {}, 'Create your account'), h('p', { class: 'muted' }, cfg.activationRequired ? 'We will email you a link to activate your account.' : 'Citizen accounts only. Staff accounts are created by an administrator.'), f, h('p', { class: 'small muted' }, 'Already registered? ', link('Log in', '/login.html')));
  },

  async activate() {
    const token = new URLSearchParams(location.search).get('token'); const card = h('div', { class: 'card auth-card center' }, h('div', { class: 'auth-badge' }, '⏳'), h('h1', {}, 'Activating your account...'), loading());
    main.append(h('div', { class: 'auth-wrap' }, card));
    const show = (badge, title, body, ok) => clear(card).append(h('div', { class: 'auth-badge' }, badge), h('h1', {}, title), h('p', { class: 'muted' }, body), link(ok ? 'Log in' : 'Back to login', '/login.html', 'btn'));
    if (!/^[a-f0-9]{64}$/.test(token || '')) return show('🤔', 'Link not recognised', 'This activation link is incomplete. Open the link from your email again, or request a new one from the login page.', false);
    try { const r = await post('/auth/activate', { token }); show('🎉', 'Account activated!', r.message, true); }
    catch (err) { show('😕', 'Could not activate', err.message, false); }
  },

  async 'forgot-password'() {
    const token = new URLSearchParams(location.search).get('token'); const card = h('div', { class: 'card auth-card' }); main.append(h('div', { class: 'auth-wrap' }, card));
    if (token) {
      const f = h('form', { novalidate: true }, field({ label: 'New password', name: 'password', type: 'password', required: true, autocomplete: 'new-password' }), field({ label: 'Confirm new password', name: 'confirmPassword', type: 'password', required: true, autocomplete: 'new-password' }), h('button', { class: 'btn', type: 'submit' }, 'Set new password'));
      f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f);
        try { await withBusy(f.querySelector('button'), () => post('/auth/reset-password', { token, password: f.elements.password.value, confirmPassword: f.elements.confirmPassword.value })); toast('Password updated', 'success'); setTimeout(() => { location.href = '/login.html'; }, 900); } catch (err) { showErrors(f, err); } });
      card.append(h('div', { class: 'auth-badge' }, '🔑'), h('h1', {}, 'Choose a new password'), f);
    } else {
      const f = h('form', { novalidate: true }, field({ label: 'Email', name: 'email', type: 'email', required: true }), h('button', { class: 'btn', type: 'submit' }, 'Send reset link'));
      f.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(f);
        try { const r = await withBusy(f.querySelector('button'), () => post('/auth/forgot-password', { email: f.elements.email.value }));
          f.replaceChildren(alertBox(r.emailEnabled ? r.message + ' It can take a minute, and the link works for 30 minutes.' : 'If that email is registered, a reset link has been prepared. Email sending is not set up on this server, so ask an administrator or check the server log.', r.emailEnabled ? 'success' : 'info'), r.devResetLink ? h('p', { class: 'small' }, 'Development mode: ', link('open reset link', r.devResetLink)) : null);
        } catch (err) { showErrors(f, err); } });
      card.append(h('div', { class: 'auth-badge' }, '🔁'), h('h1', {}, 'Reset your password'), f, h('p', { class: 'small' }, link('Citizen login', '/login.html'), ' · ', link('Staff portal', '/staff-login.html')));
    }
  },

  async track() {
    const out = h('div', { class: 'stack' });
    const f = h('form', { novalidate: true }, field({ label: 'Reference number', name: 'reference', required: true, placeholder: 'PSRS-2026-000001', autocomplete: 'off' }), h('button', { class: 'btn', type: 'submit' }, 'Track request'));
    const q = new URLSearchParams(location.search).get('ref');
    async function lookup(ref) {
      clear(out);
      try {
        const { tracking: t } = await get(`/track/${encodeURIComponent(ref.trim())}`);
        out.append(h('div', { class: 'card stack' }, h('h2', {}, t.referenceNumber), h('p', { class: 'muted' }, `${t.category} · ${t.department}`), progressTracker(t.status),
          h('ol', { class: 'timeline' }, t.history.map((x, i) => h('li', { class: i === t.history.length - 1 ? 'now' : '' }, h('strong', {}, STATUS_LABEL[x.status] || x.status), h('div', { class: 'small muted' }, fmtDate(x.at, true))))), h('p', { class: 'small muted' }, 'Log in to see comments and details of your own requests.')));
      } catch (err) { out.append(alertBox(err.status === 404 ? 'No request found with that reference number. Check it and try again.' : err.message)); }
    }
    f.addEventListener('submit', (e) => { e.preventDefault(); clearErrors(f); if (!f.elements.reference.value.trim()) return showErrors(f, { message: 'Enter a reference number', fields: { reference: 'Required' } }); withBusy(f.querySelector('button'), () => lookup(f.elements.reference.value)); });
    main.append(pageHero('Track a request', 'Enter the reference number you received when you submitted. Only the status is shown here.', 'step-track', 'Tracking progress'), h('div', { class: 'container section stack' }, h('div', { class: 'card' }, f), out));
    if (q) { f.elements.reference.value = q; lookup(q); }
  }
};

const legal = (title, intro, sections) => () => main.append(h('div', { class: 'container section' }, h('div', { class: 'legal stack' }, h('h1', {}, title), h('p', { class: 'muted' }, 'Effective 18 October 2026 · Independent demonstration project'), h('p', {}, intro),
  h('div', { class: 'toc' }, sections.map(([t], i) => h('a', { class: 'chip', href: `#s${i + 1}` }, `${i + 1}. ${t}`))),
  sections.map(([t, body], i) => h('section', { id: `s${i + 1}`, class: 'card flat' }, h('h2', {}, `${i + 1}. ${t}`), body.map((p) => h('p', {}, p)))))));
pages.terms = legal('Terms & Conditions', 'Please read these terms before creating an account or using PSRS. By registering or logging in you agree to them.', [
  ['Acceptance', ['By creating an account, logging in or using PSRS you agree to these Terms & Conditions and our Privacy Notice. If you do not agree, please do not use the service.']],
  ['A demonstration project', ['PSRS is an independent demonstration. It is not affiliated with or endorsed by the Government of Kenya or eCitizen, uses no official logos and cannot issue real government documents.', 'Nothing submitted here is a real application, and no response is an official decision.']],
  ['Your account', ['Citizen accounts are created by registering. Staff accounts are created only by an administrator and sign in through the Staff portal.', 'Keep your password secret and tell us if you suspect misuse. You are responsible for activity under your account. Accounts that abuse the system may be suspended.']],
  ['Acceptable use', ['Give accurate information. Do not submit false, abusive or unlawful content, and do not try to access other people’s data or interfere with the system.']],
  ['Requests, photos and files', ['Only upload PDF, JPEG or PNG files that you have the right to share and that do not show other people without their consent.', 'Files are checked automatically and stored privately. We may remove content that breaks these terms.']],
  ['Staff access', ['Officers and administrators may view and process requests within their responsibilities. Their important actions are recorded in an audit log.']],
  ['Privacy', ['How we handle your information is explained in the Privacy Notice, which forms part of these terms.']],
  ['Availability', ['The service is provided as is, may change or be unavailable at any time, and may be reset because it is a demonstration.']],
  ['Limitation of liability', ['To the fullest extent allowed by law, the project owners are not liable for losses from using this demonstration. Do not rely on it for real public services.']],
  ['Changes to these terms', ['We may update these terms. Continued use after an update means you accept the new version.']],
  ['Contact', ['Questions about these terms? Visit the Help centre.']]]);
pages.privacy = legal('Privacy Notice', 'This notice explains what PSRS collects, why, and who can see it.', [
  ['What we collect', ['Account details (name, email, optional phone), your requests (category, location, description), optional photos or PDFs, comments, notifications, and basic security records such as login time.']],
  ['How we use it', ['To run your account, process and track your requests, notify you of changes, produce anonymous statistics and keep the service secure.']],
  ['Who can see it', ['You can see your own data. Officers see requests for their department. Administrators see account and request information for oversight. Reports and exports leave out personal details.']],
  ['Storage and security', ['Passwords are stored hashed. Attachments are stored privately and served only to authorised users. Important actions are recorded in an audit log.']],
  ['Cookies', ['PSRS uses one essential session cookie to keep you signed in. It does not use advertising or tracking cookies.']],
  ['Keeping your data', ['This is a demonstration, so please do not enter real sensitive information. Data may be deleted when the demo is reset.']],
  ['Your choices', ['You can update your profile at any time and ask an administrator to suspend or remove your account.']],
  ['Children', ['PSRS is not intended for children under 13.']],
  ['Contact', ['Questions about privacy? Visit the Help centre.']]]);

await (pages[page] || (() => main.append(h('div', { class: 'container section' }, alertBox('Page not found')))))();
