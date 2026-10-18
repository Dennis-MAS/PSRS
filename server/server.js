import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import { connectDatabase } from './config/database.js';
import { createApp } from './app.js';
import { User } from './models/index.js';

const port = Number(process.env.PORT || 3000);
const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_TEST || undefined;

if (process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Copy .env.example to .env first.');
  process.exit(1);
}

await connectDatabase(uri);

async function seedDemoUsers() {
  if (await User.estimatedDocumentCount() > 0) return;
  const password = process.env.SEED_ADMIN_PASSWORD || 'Demo#2026pass';
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const users = [
    { fullName: 'Demo Administrator', email: 'admin@psrs.test', role: 'admin', department: null },
    { fullName: 'Amina Officer', email: 'officer1@psrs.test', role: 'officer', department: null },
    { fullName: 'Brian Officer', email: 'officer2@psrs.test', role: 'officer', department: null },
    { fullName: 'Cynthia Officer', email: 'officer3@psrs.test', role: 'officer', department: null },
    { fullName: 'Dan Officer', email: 'officer4@psrs.test', role: 'officer', department: null },
    { fullName: 'Wanjiru Citizen', email: 'citizen1@psrs.test', role: 'citizen', department: null },
    { fullName: 'Otieno Citizen', email: 'citizen2@psrs.test', role: 'citizen', department: null },
    { fullName: 'Fatuma Citizen', email: 'citizen3@psrs.test', role: 'citizen', department: null },
  ];
  for (const u of users) {
    await User.updateOne({ email: u.email }, { $set: { ...u, passwordHash, accountStatus: 'active', emailVerified: true, acceptedTermsAt: now } }, { upsert: true });
  }
  console.log(`Demo accounts seeded. Password for all demo accounts: ${password}`);
}

await seedDemoUsers();
// SESSION_STORE=memory is for local demos on MongoDB-compatible servers without TTL indexes; never use it in production.
const sessionStore = process.env.SESSION_STORE === 'memory' && process.env.NODE_ENV !== 'production'
  ? undefined
  : MongoStore.create({ client: mongoose.connection.getClient(), collectionName: 'sessions' });
const app = createApp({ sessionStore });
const server = app.listen(port, () => console.log(`PSRS running on http://localhost:${port}`));
const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
process.on('SIGTERM', stop); process.on('SIGINT', stop);
