import mongoose from 'mongoose';

export async function connectTestDb() {
  const uri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('TEST_MONGODB_URI not set');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
}

export async function truncateAll() {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.listCollections().toArray();
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    await db.collection(name).deleteMany({});
  }
}

export async function disconnectTestDb() {
  await mongoose.disconnect();
}
