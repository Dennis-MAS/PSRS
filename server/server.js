import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import { connectDatabase } from './config/database.js';
import { createApp } from './app.js';
import { User, Setting, Department } from './models/index.js';
import { DEFS } from './services/settings.js';

const port = Number(process.env.PORT || 3000);
const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_TEST || undefined;

if (process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Copy .env.example to .env first.');
  process.exit(1);
}

await connectDatabase(uri);

async function seedDemoUsers() {
  const password = process.env.SEED_ADMIN_PASSWORD || 'Demo#2026pass';
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const deptData = [
    ['Public Works', 'Department responsible for roads, street infrastructure, and public works maintenance.'],
    ['Water and Sanitation', 'Department responsible for drainage, water services, waste management, and sanitation.'],
    ['County Services', 'Department responsible for public amenities, community services, and health-related complaints.']
  ];
  const depts = {};
  for (const [name, description] of deptData) {
    depts[name] = await Department.findOneAndUpdate({ name }, { name, description, contactInformation: 'service@county.gov', status: 'active' }, { upsert: true, returnDocument: 'after' });
  }
  const users = [
    { fullName: 'Demo Administrator', email: 'admin@psrs.test', role: 'admin', department: null },
    { fullName: 'Amina Officer', email: 'officer1@psrs.test', role: 'officer', department: depts['Public Works']._id },
    { fullName: 'Brian Officer', email: 'officer2@psrs.test', role: 'officer', department: depts['Water and Sanitation']._id },
    { fullName: 'Cynthia Officer', email: 'officer3@psrs.test', role: 'officer', department: depts['County Services']._id },
    { fullName: 'Dan Officer', email: 'officer4@psrs.test', role: 'officer', department: depts['Public Works']._id },
    { fullName: 'Eunice Officer', email: 'officer5@psrs.test', role: 'officer', department: depts['Water and Sanitation']._id },
    { fullName: 'Felix Officer', email: 'officer6@psrs.test', role: 'officer', department: depts['County Services']._id },
    { fullName: 'Wanjiru Citizen', email: 'citizen1@psrs.test', role: 'citizen', department: null },
    { fullName: 'Otieno Citizen', email: 'citizen2@psrs.test', role: 'citizen', department: null },
    { fullName: 'Fatuma Citizen', email: 'citizen3@psrs.test', role: 'citizen', department: null },
  ];
  let created = 0;
  for (const u of users) {
    const res = await User.updateOne({ email: u.email }, { $set: { ...u, passwordHash, accountStatus: 'active', emailVerified: true, acceptedTermsAt: now } }, { upsert: true });
    if (res.upsertedCount) created++;
  }
  console.log(`Demo accounts ensured (${created} new). Password for all demo accounts: ${password}`);
}

async function seedDefaultSettings() {
  for (const [key, def] of Object.entries(DEFS)) {
    await Setting.updateOne({ _id: key }, { $setOnInsert: { value: String(def.def) } }, { upsert: true });
  }
  // Always start with maintenance mode off so an old stuck flag does not lock everyone out.
  // Admins can re-enable it from Admin → Settings after the deploy.
  await Setting.updateOne({ _id: 'maintenanceMode' }, { $set: { value: 'false' } }, { upsert: true });
}

await seedDemoUsers();
await seedDefaultSettings();
console.log('Default settings ensured (maintenanceMode off unless you enable it in Admin Settings).');
// SESSION_STORE=memory is for local demos on MongoDB-compatible servers without TTL indexes; never use it in production.
const sessionStore = process.env.SESSION_STORE === 'memory' && process.env.NODE_ENV !== 'production'
  ? undefined
  : MongoStore.create({ client: mongoose.connection.getClient(), collectionName: 'sessions' });
const app = createApp({ sessionStore });
const server = app.listen(port, () => console.log(`PSRS running on http://localhost:${port}`));
const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
process.on('SIGTERM', stop); process.on('SIGINT', stop);
