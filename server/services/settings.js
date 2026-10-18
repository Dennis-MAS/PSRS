// Admin-editable settings, stored as key/value rows with typed defaults and a short cache.
import { Setting } from '../models/index.js';

export const DEFS = {
  siteName: { type: 'string', def: 'PSRS' },
  tagline: { type: 'string', def: 'Public Services, Made Simpler.' },
  supportEmail: { type: 'string', def: '' },
  supportPhone: { type: 'string', def: '' },
  announcement: { type: 'string', def: '' },
  registrationOpen: { type: 'bool', def: true },
  requireEmailVerification: { type: 'bool', def: false },
  maintenanceMode: { type: 'bool', def: false },
  allowCitizenCancel: { type: 'bool', def: true },
  autoAssign: { type: 'bool', def: false },
  maxAttachments: { type: 'int', def: 5 },
  emailEnabled: { type: 'bool', def: true },
  emailOnSubmit: { type: 'bool', def: true },
  emailOnStatus: { type: 'bool', def: true },
  emailOnComment: { type: 'bool', def: true },
  emailOnAssign: { type: 'bool', def: true }
};

export const isEmailConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);

const parse = (d, raw) => {
  if (raw == null) return d.def;
  if (d.type === 'bool') return raw === 'true';
  if (d.type === 'int') return Number.isFinite(Number(raw)) ? Number(raw) : d.def;
  return String(raw);
};
let cache = null; let cachedAt = 0;

export async function getSettings() {
  if (cache && Date.now() - cachedAt < 5000) return cache;
  const rows = await Setting.find({ _id: { $in: Object.keys(DEFS) } });
  const map = new Map(rows.map((r) => [r._id, r.value]));
  cache = Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, parse(d, map.get(k))]));
  cachedAt = Date.now();
  return cache;
}

export async function saveSettings(patch) {
  await Promise.all(Object.entries(patch).filter(([k]) => k in DEFS).map(([k, v]) => Setting.updateOne({ _id: k }, { value: String(v) }, { upsert: true })));
  cache = null;
  return getSettings();
}

// Safe subset exposed to anyone (used for branding, banners and form behaviour).
export async function publicSettings() {
  const s = await getSettings();
  return {
    siteName: s.siteName, tagline: s.tagline, supportEmail: s.supportEmail, supportPhone: s.supportPhone, announcement: s.announcement,
    registrationOpen: s.registrationOpen, maintenanceMode: s.maintenanceMode, allowCitizenCancel: s.allowCitizenCancel, maxAttachments: s.maxAttachments,
    activationRequired: s.requireEmailVerification && isEmailConfigured()
  };
}
