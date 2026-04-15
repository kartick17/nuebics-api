import mongoose from "mongoose";

export async function connectTestDb() {
  const uri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("TEST_MONGODB_URI not set");
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
}

export async function truncateAll() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

export async function disconnectTestDb() {
  await mongoose.disconnect();
}
