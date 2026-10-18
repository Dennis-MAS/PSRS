// One-command demo: starts a throwaway in-memory MongoDB, seeds demo data and runs the app.
// Usage: npm run demo   (needs internet the first time to download a MongoDB binary)
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri('psrs');
process.env.NODE_ENV ||= 'development';
process.env.SESSION_SECRET ||= 'demo-only-secret';
await import('../database/seed.js');
await import('../server/server.js');
const stop = async () => { await mongod.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
console.log('Demo ready. Log in with admin@psrs.test / Demo#2026pass');
