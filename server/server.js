
import 'dotenv/config';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';

import { connectDatabase } from './config/database.js';
import { createApp } from './app.js';
import { User, Setting, Department } from './models/index.js';
import { DEFS } from './services/settings.js';

const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_TEST;

let server;
let shuttingDown = false;

async function seedDemoUsers() {
  // Demo accounts must never be seeded into production.
  if (isProduction || process.env.ENABLE_DEMO_SEED !== 'true') {
    console.log('Demo account seeding disabled.');
    return;
  }

  const password = process.env.SEED_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error(
      'Demo seeding requires SEED_PASSWORD with at least 12 characters.'
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const deptData = [
    [
      'Public Works',
      'Department responsible for roads, street infrastructure, and public works maintenance.'
    ],
    [
      'Water and Sanitation',
      'Department responsible for drainage, water services, waste management, and sanitation.'
    ],
    [
      'County Services',
      'Department responsible for public amenities, community services, and health-related complaints.'
    ]
  ];

  const departments = {};

  for (const [name, description] of deptData) {
    departments[name] = await Department.findOneAndUpdate(
      { name },
      {
        $set: {
          description,
          contactInformation: 'service@county.gov',
          status: 'active'
        },
        $setOnInsert: { name }
      },
      {
        upsert: true,
        returnDocument: 'after',
        runValidators: true
      }
    );
  }

  const users = [
    {
      fullName: 'Demo Administrator',
      email: 'admin@psrs.test',
      role: 'admin',
      department: null
    },
    {
      fullName: 'Amina Officer',
      email: 'officer1@psrs.test',
      role: 'officer',
      department: departments['Public Works']._id
    },
    {
      fullName: 'Brian Officer',
      email: 'officer2@psrs.test',
      role: 'officer',
      department: departments['Water and Sanitation']._id
    },
    {
      fullName: 'Cynthia Officer',
      email: 'officer3@psrs.test',
      role: 'officer',
      department: departments['County Services']._id
    },
    {
      fullName: 'Dan Officer',
      email: 'officer4@psrs.test',
      role: 'officer',
      department: departments['Public Works']._id
    },
    {
      fullName: 'Eunice Officer',
      email: 'officer5@psrs.test',
      role: 'officer',
      department: departments['Water and Sanitation']._id
    },
    {
      fullName: 'Felix Officer',
      email: 'officer6@psrs.test',
      role: 'officer',
      department: departments['County Services']._id
    },
    {
      fullName: 'Wanjiru Citizen',
      email: 'citizen1@psrs.test',
      role: 'citizen',
      department: null
    },
    {
      fullName: 'Otieno Citizen',
      email: 'citizen2@psrs.test',
      role: 'citizen',
      department: null
    },
    {
      fullName: 'Fatuma Citizen',
      email: 'citizen3@psrs.test',
      role: 'citizen',
      department: null
    }
  ];

  let created = 0;

  for (const user of users) {
    const result = await User.updateOne(
      { email: user.email },
      {
        $set: {
          ...user,
          accountStatus: 'active',
          emailVerified: true,
          acceptedTermsAt: new Date()
        },
        // Only assign the password when a demo account is first created.
        // Never overwrite an existing account's password on restart.
        $setOnInsert: {
          passwordHash
        }
      },
      {
        upsert: true,
        runValidators: true
      }
    );

    created += result.upsertedCount || 0;
  }

  console.log(`Demo accounts ensured. New accounts created: ${created}.`);
  // Never print passwords or other credentials to application logs.
}

async function seedDefaultSettings() {
  for (const [key, def] of Object.entries(DEFS)) {
    await Setting.updateOne(
      { _id: key },
      {
        $setOnInsert: {
          value: String(def.def)
        }
      },
      { upsert: true }
    );
  }

  // Do not forcibly disable maintenance mode at startup.
  // Preserve the value set by the administrator.
  console.log('Default settings ensured.');
}

async function startServer() {
  if (isProduction && !process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI must be configured in production.');
  }

  if (
    isProduction &&
    process.env.SESSION_STORE === 'memory'
  ) {
    throw new Error('In-memory sessions are not allowed in production.');
  }

  await connectDatabase(uri);

  await seedDefaultSettings();
  await seedDemoUsers();

  const sessionStore =
    !isProduction && process.env.SESSION_STORE === 'memory'
      ? undefined
      : MongoStore.create({
          client: mongoose.connection.getClient(),
          collectionName: 'sessions'
        });

  const app = createApp({ sessionStore });

  server = app.listen(port, () => {
    console.log(`PSRS server listening on port ${port}.`);
  });

  server.on('error', (error) => {
    console.error('HTTP server error:', error.message);
    void shutdown(1);
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error during shutdown:', error.message);
    exitCode = 1;
  }

  process.exitCode = exitCode;
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

startServer().catch(async (error) => {
  console.error('PSRS startup failed:', error.message);
  await shutdown(1);
});
