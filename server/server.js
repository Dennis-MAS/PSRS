import 'dotenv/config';
import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import { connectDatabase } from './config/database.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is not set. Copy .env.example to .env first.'); process.exit(1); }

await connectDatabase(uri);
// SESSION_STORE=memory is for local demos on MongoDB-compatible servers without TTL indexes; never use it in production.
const sessionStore = process.env.SESSION_STORE === 'memory' && process.env.NODE_ENV !== 'production'
  ? undefined
  : MongoStore.create({ client: mongoose.connection.getClient(), collectionName: 'sessions' });
const app = createApp({ sessionStore });
const server = app.listen(port, () => console.log(`PSRS running on http://localhost:${port}`));
const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
process.on('SIGTERM', stop); process.on('SIGINT', stop);
