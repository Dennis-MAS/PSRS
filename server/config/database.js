import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memoryServer;

export async function connectDatabase(uri) {
  const targetUri = uri || process.env.MONGODB_URI || process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/psrs';
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(targetUri, { serverSelectionTimeoutMS: 8000 });
    return mongoose.connection;
  } catch (error) {
    const shouldFallbackToMemory =
      !uri ||
      /localhost|127\.0\.0\.1/.test(targetUri) ||
      process.env.NODE_ENV === 'test' ||
      process.env.USE_IN_MEMORY_DB === 'true';

    if (!shouldFallbackToMemory) {
      throw error;
    }

    if (!memoryServer) {
      const dbName = (() => {
        try {
          return new URL(targetUri).pathname.replace(/^\//, '') || 'psrs';
        } catch {
          return 'psrs';
        }
      })();

      memoryServer = await MongoMemoryServer.create({ instance: { dbName } });
    }

    await mongoose.disconnect().catch(() => {});
    await mongoose.connect(memoryServer.getUri(), { serverSelectionTimeoutMS: 8000 });
    return mongoose.connection;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect().catch(() => {});
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
