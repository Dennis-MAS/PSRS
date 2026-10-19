# Public Service Request System (PSRS)

Public Service Request System built for the ICT Intern recruitment examination (October 2026).

Citizens register, browse services, submit requests, attach documents, track progress and reply to officers. Officers process requests inside their department. Administrators manage users, services, departments, reports and audit logs.

## Stack
HTML5 · CSS3 · vanilla JavaScript (no frameworks) · Node.js 20+ · Express · MongoDB + Mongoose · Zod · bcrypt · Helmet · express-rate-limit · express-session (+ connect-mongo) · Multer · Chart.js (served locally from `node_modules`) · Vitest + Supertest.

## Exam requirements at a glance
| Requirement | Where it lives |
|---|---|
| Citizen registration / login | `server/routes/auth.js`, `public/assets/js/public.js` (login, register) |
| Submit request: category, location, description, optional image | Category = a service (seeded: Broken Streetlight, Water Issue, Garbage Collection and more). Form in `citizen.js` (`submit-request`), image via `POST /requests/:id/attachments` (PNG/JPEG/PDF, signature-checked, shown as a thumbnail) |
| Admin dashboard | `/admin/dashboard.html`, `server/routes/admin.js` |
| Status tracking Pending → In Progress → Resolved | Three-step tracker on every request (`progressTracker`), backed by the detailed workflow below (`server/services/workflow.js`) |
| Basic analytics: open vs resolved | Admin dashboard cards (open cases, resolved cases, resolution rate) and the "Open vs resolved cases" chart, plus reports page and CSV export |
| Bonus features | Public tracker by reference number (`/track.html`, no personal data), officer portal with departmental access, internal notes, in-app notifications, audit log, CSV export, request summary download, password reset, account lockout, duplicate-submission protection, site announcement banner |

## Project structure
```
server/   app.js (middleware + routing) · server.js (startup) · routes/ (one file per area) · models/ (Mongoose) · services/ (workflow rules, notifications, audit) · middleware/ · utils/
public/   HTML pages · assets/css (main.css, dashboard.css) · assets/js: api.js (fetch + CSRF) · utilities.js (safe DOM helpers) · layout.js (nav/sidebar/guards) · public.js · citizen.js · staff.js · requests.js (shared views)
database/ seed.js        tests/ psrs.test.js        storage/ private uploads
```
Conventions: routes only parse input and call shared services; every request is validated with Zod; authorization lives in middleware and in database query scopes (`requestScope`); the frontend never uses `innerHTML`.

## Quick start
**Fastest (no MongoDB install):** `npm install` then `npm run demo`, and open <http://localhost:3000>. This starts a temporary in-memory database with demo data (it needs internet the first time to download a MongoDB binary, and data is lost when you stop it).

**Important:** if a page is blank, it was opened without the server. Always open the site through the server (`http://localhost:3000`). Double-clicking an `.html` file will not work because the pages load their scripts and data from the Express server.

```bash
npm install
cp .env.example .env          # then edit MONGODB_URI and SESSION_SECRET
npm run seed                  # optional demo data (development only)
npm start                     # http://localhost:3000
npm test                      # uses MONGODB_URI_TEST (a separate database, which is dropped on each run)
```
**MongoDB:** install Community Server locally (`mongodb://127.0.0.1:27017/psrs`) or create a free MongoDB Atlas cluster, add your IP to the access list, and put the `mongodb+srv://...` string in `MONGODB_URI`.

Demo accounts after seeding (password `Demo#2026pass`, or `SEED_ADMIN_PASSWORD`): `admin@psrs.test`, `officer1@psrs.test` and `officer4@psrs.test` (Public Works), `officer2@psrs.test` and `officer5@psrs.test` (Water and Sanitation), `officer3@psrs.test` and `officer6@psrs.test` (County Services), `citizen1@psrs.test`.
Seeding refuses to run when `NODE_ENV=production` unless `ALLOW_SEED=true`. The app works on an empty database; create the first admin by seeding or by promoting a user directly in the database.

## Environment variables
| Name | Purpose |
|---|---|
| `NODE_ENV` | `development`, `production`, `test` |
| `PORT` | HTTP port (default 3000) |
| `MONGODB_URI`, `MONGODB_URI_TEST` | Main and test databases |
| `SESSION_SECRET` | Required in production |
| `SESSION_MAX_AGE_HOURS` | Session lifetime (default 8) |
| `TRUST_PROXY` | `true` behind a reverse proxy/PaaS so secure cookies work |
| `UPLOAD_DIR` | Private attachment folder (default `storage/uploads`, outside `public/`) |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Brevo email (HTTP API, not SMTP). Leave blank to run without email |
| `APP_URL` | Public site address used in email links, e.g. `https://psrs.example.com`. Required in production |
| `SESSION_STORE=memory` | Dev-only escape hatch for MongoDB-compatible servers without TTL indexes. Ignored in production |

## Pages and design
Public: Home, Services, How it works, Track, About, Help, Terms & Conditions, Privacy Notice. Illustrations are original SVG files in `public/assets/images` (no external images or fonts, so the strict CSP stays intact).
Logins are separate: **citizens** use `/login.html`, **officers and administrators** use `/staff-login.html`. The API enforces this with a `portal` field (a staff account is refused by the citizen login and vice versa). Registration always creates a citizen and requires accepting the Terms & Conditions (the acceptance time is stored).
Dashboards use a fixed sidebar on desktop and a slide-in drawer with an overlay on mobile; the page shell renders instantly from a cached copy of the user's display name and role while the server confirms the session in the background, so the sidebar does not flicker. Every page has a footer pinned to the bottom.

## Email with Brevo (HTTP API, not SMTP)
1. Create a Brevo account and verify a sender address (Brevo → Senders, domains & dedicated IPs).
2. Create an API key (Brevo → SMTP & API → API keys). Use the **API key**, not the SMTP key.
3. Put `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (the verified sender), `BREVO_SENDER_NAME` and `APP_URL` in `.env`, then restart.
4. Open **Admin → Settings → Email**: *Check connection* shows whether Brevo accepted the key, and *Send test email* sends a real message.
Emails the system sends: **account activation** (and a welcome after activating), **password reset**, **staff invitation** (a link to choose their own password), **request received**, **status changes**, **comments/replies** and **assignments**. All templates are branded, escape user text and include a plain-text version. Email never blocks the app: if Brevo is down the action still succeeds, the failure is logged and visible in **Audit logs** (`email.failed`). Citizens can switch email updates off in their Profile.
Account activation: turn on *Require email activation* in Settings. New citizens must click the emailed link (valid 24 hours) before logging in; the login page offers *Resend activation email*, and admins can *Activate now* or resend from the Users page. If Brevo is not configured, accounts activate immediately instead of locking people out.

## Admin settings (all take effect immediately)
General: site name, tagline, support email/phone, announcement banner. Access: open/close registration, require email activation, maintenance mode (pauses new requests), allow citizens to cancel, auto-assign new requests to the least busy officer, maximum attachments. Email: master switch plus request received / status change / comment / assignment.

## Roles
- **Citizen**: own profile and requests only; submit, comment/reply, upload, cancel (while `SUBMITTED`), download a text summary.
- **Officer**: requests in their department or assigned to them; assign to officers of the same department, change status, citizen comments, internal notes.
- **Administrator**: everything above across departments, plus users, services, departments, reports/CSV, audit logs, settings.
Registration always creates a citizen; the browser can never choose a role. Every rule is enforced in the API, not just the UI.

## Workflow
`SUBMITTED → UNDER_REVIEW | CANCELLED | REJECTED`, `UNDER_REVIEW → IN_PROGRESS | AWAITING_INFORMATION | REJECTED`, `AWAITING_INFORMATION → UNDER_REVIEW`, `IN_PROGRESS → AWAITING_INFORMATION | RESOLVED | REJECTED`. Comments are mandatory for awaiting-information, resolved and rejected. A citizen reply to an information request moves the request back to `UNDER_REVIEW`.

## API (`/api/v1`, JSON, session cookie + `X-CSRF-Token` header on every non-GET)
- **Auth**: `GET /auth/csrf`, `POST /auth/register|login|logout|forgot-password|reset-password|change-password`, `GET|PATCH /auth/me`
- **Public tracker**: `GET /track/:reference` (status only, rate limited)
- **Services**: `GET /services` (q, department, page, limit), `GET /services/:idOrSlug`, `POST /services`, `PATCH /services/:id`, `PATCH /services/:id/status` (admin writes)
- **Departments**: `GET /departments`, `POST /departments`, `PATCH /departments/:id`, `PATCH /departments/:id/status`
- **Requests**: `POST /requests`, `GET /requests/my`, `GET /requests/my/stats`, `GET /requests/:id`, `GET /requests/:id/history`, `GET /requests/:id/summary`, `POST /requests/:id/comments`, `POST /requests/:id/cancel`, `POST /requests/:id/attachments` (multipart `file`), `GET /requests/:id/attachments/:aid`
- **Officer** (officers and admins): `GET /officer/requests`, `GET /officer/dashboard`, `GET /officer/requests/:id/assignees`, `PATCH /officer/requests/:id/assign|status`, `POST /officer/requests/:id/internal-notes`
- **Notifications**: `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`
- **Admin**: `GET /admin/dashboard`, `GET|POST /admin/users`, `PATCH /admin/users/:id/role|status|department`, `GET /admin/reports`, `GET /admin/reports/export`, `GET /admin/audit-logs`, `GET|PUT /admin/settings`
- `GET /api/health`, `GET /api/v1/settings/public`
Errors use `{ success:false, message, errors? }`; lists return `{ items, pagination }`.
Differences from the brief: the all-requests admin view reuses `/officer/requests` (admins see every department); user creation and department assignment endpoints were added; models live in one file, `server/models/index.js`.

## Data model
`User` (role, department) · `Department` · `Service` (→ Department) · `ServiceRequest` (→ User citizen, Service, Department, assignedOfficer) · `RequestStatusHistory`, `RequestComment` (visibility `internal|citizen`), `RequestAttachment` (→ ServiceRequest) · `Notification` (→ User, Request) · `AuditLog` · `Counter` (atomic reference numbers `PSRS-YYYY-000001`) · `PasswordReset` (hashed token) · `Setting`. Indexes: unique email, slug, reference; per-citizen unique `submissionKey` (duplicate-submit guard).

## Security summary
Helmet + strict CSP (no inline scripts/styles, no CDNs), server-side Zod validation, `query parser = simple` and typed schemas (NoSQL operator injection), bcrypt (cost 12), account lockout after 5 failures plus rate limits, HTTP-only SameSite session cookies (`Secure` in production) with session regeneration on login, synchroniser-token CSRF, ownership/department checks inside database queries, mass-assignment protection, private uploads validated by file signature and served only through authorised endpoints, DOM built with `textContent` (no `innerHTML`), CSV formula-injection neutralised, audit log for admin actions. See `SECURITY.md` for limitations.

## Deployment (Render, Railway, Fly.io or any Node host)
1. Create a MongoDB Atlas cluster and a database user; allow the host's egress IPs.
2. Set `NODE_ENV=production`, `MONGODB_URI`, `SESSION_SECRET` (long random), `TRUST_PROXY=true`, and a persistent disk path for `UPLOAD_DIR`.
3. Build command `npm install --omit=dev`, start command `npm start`, health check `/api/health`. Serve over HTTPS.
No deployment has been performed or verified for this repository.

## What was actually verified
- `npm test`: **34 tests passed**, run against **FerretDB 1.24 (SQLite backend)** because a real `mongod` could not be installed in the build environment. FerretDB implements most, not all, of the MongoDB API, so please re-run `npm test` against real MongoDB or Atlas before relying on it. Covered: registration/login/sessions/CSRF, duplicate accounts, password hashing, authorization, reference generation, ownership, department restriction, separate citizen/staff logins, terms acceptance, Brevo email payloads (API stubbed), account activation, password-reset emails, staff invitations, event emails and opt-outs, admin settings that change behaviour, status transitions and history, public tracker privacy, open-vs-resolved figures, notifications, service management, attachments (valid, disguised executable, access control), dashboard figures, CSV export.
- All HTML/CSS/JS files are served (HTTP 200) and JavaScript passes a syntax check.
- Every page (public, citizen, officer, admin) was loaded with its real JavaScript in a simulated DOM against the running server with no runtime errors, and the submit-request, registration (with and without accepting the terms) and both login forms were driven end to end. This is not a visual check.
- **Not done:** the interface was not opened in a real browser (none available), so how it actually *looks* (colours, spacing, the mobile sidebar drawer, animations) is untested by me. Please click through each role once.

## Known limitations / future work
- No multi-document MongoDB transactions: request creation compensates by deleting the request if the history write fails; other writes are ordered so a partial failure leaves a valid request.
- Emails were verified against a local mock of Brevo's API and unit tests with the API stubbed. They have **not** been sent through a real Brevo account from here, so use *Send test email* in Settings once your key is in place.
- Admin dashboard day/month bucketing and averages are computed in Node over at most 20,000 rows; use aggregation pipelines for large datasets.
- Files are stored on local disk; use object storage on ephemeral hosts. No virus scanning.
- Sessions are not invalidated on password reset; no 2FA; no accessibility audit beyond semantic markup and visible focus.

## Troubleshooting
`MONGODB_URI is not set` → create `.env`. `ECONNREFUSED 27017` → start MongoDB. `Invalid or missing CSRF token` → reload the page (new session). Login works but pages bounce to login in production → set `TRUST_PROXY=true` and use HTTPS.
