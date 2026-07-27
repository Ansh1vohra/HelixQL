import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";

let mongod: MongoMemoryServer | undefined;

export async function setupTestDb(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  await connectToDatabase();
}

export async function teardownTestDb(): Promise<void> {
  await mongoose.disconnect();
  await mongod?.stop();
}

export async function clearTestDb(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
