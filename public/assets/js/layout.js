// Page chrome shared by every page: public navbar/footer and the dashboard shell.
// The shell renders instantly from a cached copy of the signed-in user (display data only),
// then the server confirms the session in the background. Real access control is on the API.
import { get, post, setCsrf } from './api.js';
import { HOME, clear, h, toast } from './utilities.js';

const KEY = 'psrs.user';
export const cachedUser = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
export const cacheUser = (u) => {
  try { if (u) sessionStorage.setItem(KEY, JSON.stringify({ _id: u._id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role })); else sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
};
export async function currentUser() {
  try { const r = await get('/auth/me'); setCsrf(r.csrfToken); cacheUser(r.user); return r.user; } catch { cacheUser(null); return null; }
}
export async function logout() {
  const staff = cachedUser()?.role !== 'citizen' && cachedUser();
  try { await post('/auth/logout'); } catch { /* ignore */ }
  cacheUser(null); location.href = staff ? '/staff-login.html' : '/login.html';
}

const NAV = {
  citizen: [['Dashboard', '/citizen/dashboard.html', '🏠'], ['Submit a request', '/citizen/submit-request.html', '✍️'], ['My requests', '/citizen/my-requests.html', '📋'], ['Notifications', '/citizen/notifications.html', '🔔'], ['Profile', '/citizen/profile.html', '🧑']],
  officer: [['Dashboard', '/officer/dashboard.html', '🏠'], ['Requests', '/officer/requests.html', '📋'], ['Notifications', '/officer/notifications.html', '🔔']],
  admin: [['Dashboard', '/admin/dashboard.html', '🏠'], ['Requests', '/admin/requests.html', '📋'], ['Services', '/admin/services.html', '🧰'], ['Departments', '/admin/departments.html', '🏢'], ['Users', '/admin/users.html', '👥'], ['Reports', '/admin/reports.html', '📊'], ['Audit logs', '/admin/audit-logs.html', '🧾'], ['Settings', '/admin/settings.html', '⚙️']]
};
const brand = () => h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'PS'), h('span', { class: 'brand-name' }, 'PSRS'));
// Public settings (site name, switches) are fetched once per page and shared.
let settingsPromise;
export const publicSettings = () => (settingsPromise ||= get('/settings/public').then((r) => r.settings).catch(() => ({})));
const initials = (n) => (n.trim().split(/\s+/).length > 1 ? n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') : n.trim().slice(0, 2)).toUpperCase();
function applyBranding(s) {
  if (!s.siteName) return;
  document.querySelectorAll('.brand-name, .site-name').forEach((e) => { e.textContent = s.siteName; });
  document.querySelectorAll('.brand-mark').forEach((e) => { e.textContent = initials(s.siteName); });
  document.title = document.title.replace(/·\s.*$/, `· ${s.siteName}`);
  if (s.tagline) document.querySelectorAll('.tagline').forEach((e) => { e.textContent = s.tagline; });
}
const li = (t, href) => h('li', {}, h('a', { href }, t));

function siteFooter() {
  return h('footer', { class: 'footer' }, h('div', { class: 'container' },
    h('div', { class: 'cols' },
      h('div', {}, brand(), h('p', { class: 'tagline' }, 'Public Services, Made Simpler.'), h('p', { class: 'support-text small' }, 'Create an account to submit and track requests.')),
      h('div', {}, h('h3', {}, 'Explore'), h('ul', { class: 'flist' }, li('Home', '/'), li('Services', '/services.html'), li('How it works', '/how-it-works.html'), li('Track a request', '/track.html'))),
      h('div', {}, h('h3', {}, 'Support'), h('ul', { class: 'flist' }, li('Help centre', '/help.html'), li('About PSRS', '/about.html'), li('Reset password', '/forgot-password.html'))),
      h('div', {}, h('h3', {}, 'Accounts & legal'), h('ul', { class: 'flist' }, li('Citizen login', '/login.html'), li('Register', '/register.html'), li('Staff portal', '/staff-login.html'), li('Terms & conditions', '/terms.html'), li('Privacy notice', '/privacy.html')))),
    h('div', { class: 'legal-line' }, h('span', {}, '© 2026 ', h('span', { class: 'site-name' }, 'PSRS'), '. Independent demonstration project.'), h('span', {}, 'Not affiliated with or endorsed by the Government of Kenya or eCitizen. No real government documents are issued.'))));
}

// ---------- public pages ----------
export async function mountPublic() {
  const cached = cachedUser();
  const here = location.pathname;
  const link = (t, href) => h('a', { href, 'aria-current': here === href || (href === '/' && here === '/index.html') ? 'page' : null }, t);
  const right = h('span', { class: 'row', style: null });
  const fill = (u) => clear(right).append(...(u ? [h('a', { class: 'btn sm', href: HOME[u.role] }, 'My dashboard')] : [link('Login', '/login.html'), h('a', { class: 'btn sm', href: '/register.html' }, 'Register')]));
  fill(cached);
  const links = h('div', { class: 'nav-links', id: 'nav-links' }, link('Home', '/'), link('Services', '/services.html'), link('How it works', '/how-it-works.html'), link('Track', '/track.html'), link('About', '/about.html'), link('Help', '/help.html'), right);
  const toggle = h('button', { class: 'nav-toggle', 'aria-expanded': 'false', 'aria-controls': 'nav-links', onclick: (e) => { const o = links.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o); } }, '☰ Menu');
  const main = h('main', { id: 'view' }); const banner = h('div', { hidden: true, class: 'banner' });
  const isAuth = ['/login.html', '/staff-login.html', '/register.html', '/forgot-password.html', '/activate.html'].includes(location.pathname);
  let footerEl = null;
  const site = h('div', { class: 'site' }, h('a', { href: '#view', class: 'btn skip' }, 'Skip to content'), h('nav', { class: 'site-nav', 'aria-label': 'Main' }, h('div', { class: 'container' }, brand(), toggle, links)), banner, main, isAuth ? null : (footerEl = siteFooter()));
  const app = document.getElementById('app'); clear(app); app.removeAttribute('aria-busy');
  app.append(site);
  publicSettings().then((s) => {
    applyBranding(s);
    if (s.maintenanceMode) { banner.textContent = '🛠️ The system is in maintenance mode. You can look around, but new requests are paused.'; banner.hidden = false; }
    else if (s.announcement) { banner.textContent = '📣 ' + s.announcement; banner.hidden = false; }
    if (footerEl && (s.supportEmail || s.supportPhone)) footerEl.querySelector('.support-text').textContent = 'Need help? ' + [s.supportEmail, s.supportPhone].filter(Boolean).join(' · ');
  });
  const user = await currentUser();
  if ((user?.role || null) !== (cached?.role || null)) fill(user);
  return { main, user };
}

// ---------- dashboards (citizen, officer, admin) ----------
export async function mountDashboard(roles, area) {
  const loginUrl = area === 'citizen' ? '/login.html' : '/staff-login.html';
  const toLogin = () => location.replace(loginUrl + '?next=' + encodeURIComponent(location.pathname + location.search));
  const never = new Promise(() => {});
  const cached = cachedUser();
  let user = cached && roles.includes(cached.role) ? cached : null;
  if (!user) {
    const u = await currentUser();
    if (!u) { toLogin(); return never; }
    if (!roles.includes(u.role)) { location.replace(HOME[u.role]); return never; }
    user = u;
  }
  const here = location.pathname;
  const close = () => { side.classList.remove('open'); scrim.classList.remove('show'); document.body.classList.remove('nav-open'); menu.setAttribute('aria-expanded', 'false'); };
  const open = () => { side.classList.add('open'); scrim.classList.add('show'); document.body.classList.add('nav-open'); menu.setAttribute('aria-expanded', 'true'); };
  const roleName = { citizen: 'Citizen portal', officer: 'Service officer portal', admin: 'Administrator portal' }[user.role];
  const side = h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Sidebar' }, brand(), h('div', { class: 'role' }, roleName),
    h('nav', { 'aria-label': 'Portal' }, NAV[user.role].map(([t, href, ico]) => h('a', { href, 'aria-current': here === href ? 'page' : null, onclick: close }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), t))),
    h('div', { class: 'side-foot' }, h('p', {}, 'Need help? ', h('a', { href: '/help.html' }, 'Help centre'))));
  const scrim = h('div', { class: 'scrim', onclick: close });
  const menu = h('button', { class: 'btn secondary sm menu', 'aria-label': 'Open menu', 'aria-controls': 'sidebar', 'aria-expanded': 'false', onclick: () => (side.classList.contains('open') ? close() : open()) }, '☰ Menu');
  const bell = h('a', { class: 'bell', href: `/${user.role}/notifications.html`, 'aria-label': 'Notifications', hidden: user.role === 'admin' }, '🔔');
  const main = h('main', { class: 'content', id: 'view' });
  const top = h('header', { class: 'topbar' }, menu, h('span', { class: 'grow' }), bell, h('span', { class: 'avatar', 'aria-hidden': 'true' }, (user.fullName || '?')[0].toUpperCase()), h('span', { class: 'small uname' }, user.fullName), h('button', { class: 'btn secondary sm', onclick: logout }, 'Log out'));
  const foot = h('footer', { class: 'dash-foot' }, h('span', {}, '© 2026 PSRS · Independent demonstration project, not affiliated with the Government of Kenya or eCitizen.'), h('span', {}, h('a', { href: '/terms.html' }, 'Terms'), ' · ', h('a', { href: '/privacy.html' }, 'Privacy'), ' · ', h('a', { href: '/help.html' }, 'Help')));
  const app = document.getElementById('app'); clear(app); app.removeAttribute('aria-busy');
  app.append(h('div', { class: 'app' }, side, scrim, h('div', { class: 'shell' }, top, main, foot)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.matchMedia('(min-width: 881px)').addEventListener('change', close);
  publicSettings().then((s) => {
    applyBranding(s);
    const note = s.maintenanceMode ? (user.role === 'citizen' ? '🛠️ Maintenance mode is on: new requests are paused for now.' : '🛠️ Maintenance mode is on: citizens cannot submit new requests.') : s.announcement ? '📣 ' + s.announcement : '';
    if (note) top.after(h('div', { class: 'banner' }, note));
  });
  if (user.role !== 'admin') get('/notifications?limit=1&unread=1').then((r) => { if (r.unread) bell.append(h('span', { class: 'count' }, r.unread > 99 ? '99+' : r.unread)); }).catch(() => {});
  if (user === cached) currentUser().then((u) => { if (!u) toLogin(); else if (!roles.includes(u.role)) location.replace(HOME[u.role]); else Object.assign(user, u); }); // confirm the session in the background
  return { main, user };
}
export { toast };
