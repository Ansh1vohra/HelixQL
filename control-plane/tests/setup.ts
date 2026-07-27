// Shared non-secret test defaults. Real deployments must never reuse these.
// Tests that touch the database (see dbTestUtils.ts) overwrite MONGODB_URI
// with a mongodb-memory-server URI before it's ever read by getEnv().
process.env.MONGODB_URI ??= "mongodb://localhost:27017/helixql_unused_placeholder";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.SESSION_SECRET ??= "s".repeat(32);
process.env.API_TOKEN_HMAC_SECRET ??= "h".repeat(32);
process.env.API_TOKEN_ENCRYPTION_KEY ??= "1".repeat(64);
process.env.GATEWAY_INTERNAL_SECRET ??= "g".repeat(32);
