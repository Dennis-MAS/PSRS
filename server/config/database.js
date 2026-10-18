import 'dotenv/config';
import mongoose from 'mongoose';

export async function connectDatabase(uri) {
  const targetUri = uri || process.env.MONGODB_URI || process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/psrs';
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(targetUri, { serverSelectionTimeoutMS: 8000 });
    return mongoose.connection;
  } catch (error) {
    const message =
      'No MongoDB server is available. Start a local MongoDB instance or provide a reachable Atlas URI. ' +
      'The project intentionally does not download a temporary MongoDB binary during startup.';

    if (process.env.USE_IN_MEMORY_DB === 'true') {
      throw new Error(`${message} Set USE_IN_MEMORY_DB=false to disable this fallback path.`);
    }

    throw new Error(`${message} Original error: ${error.message}`);
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect().catch(() => {});
}
