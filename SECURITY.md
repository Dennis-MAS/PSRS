# Security notes

Controls: see "Security summary" in README.md.

Known limitations
- Rate limiting and lockout state use in-process/user-record storage; behind several instances use a shared limiter store.
- Uploaded files are validated by size, type and magic bytes but are not malware-scanned.
- Password reset has no email channel; tokens are single-use, hashed at rest, and expire after 30 minutes.
- Existing sessions are not revoked on password reset or role change (suspended accounts are rejected on the next request).
- Demo seed credentials are public and must never be used in production (`npm run seed` is blocked there by default).
- No automated dependency or penetration testing has been run. Run `npm audit` before deploying.

Reporting: this is a demonstration project; report issues to the repository owner.
