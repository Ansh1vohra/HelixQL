import mongoose from "mongoose";
import { getEnv } from "@/lib/env";

/**
 * Next.js dev/serverless environments can re-import this module across hot
 * reloads or concurrent invocations. Cache the connection promise on the
 * global object so we never open more than one connection pool per process.
 */
declare global {
  // eslint-disable-next-line no-var
  var __helixqlMongooseConn: Promise<typeof mongoose> | undefined;
}

export function connectToDatabase(): Promise<typeof mongoose> {
  if (!global.__helixqlMongooseConn) {
    const { MONGODB_URI } = getEnv();
    mongoose.set("strictQuery", true);
    global.__helixqlMongooseConn = mongoose.connect(MONGODB_URI, {
      maxPoolSize: 20,
    });
  }
  return global.__helixqlMongooseConn;
}
