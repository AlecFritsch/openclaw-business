import { MongoClient, Db } from 'mongodb';
import { config } from './env.js';

let client: MongoClient;
let db: Db;

/**
 * Connect to MongoDB.
 * @param uri    Override the connection URI (useful for tests with mongodb-memory-server)
 * @param dbName Override the database name (defaults to parsing the URI, then 'openclaw_business')
 */
export async function connectDatabase(uri?: string, dbName?: string): Promise<void> {
  try {
    const connectionUri = uri || config.mongodbUri;
    client = new MongoClient(connectionUri);
    await client.connect();

    // Derive DB name: explicit param > URI path > fallback 'agenix'
    const resolvedDbName = dbName || extractDbName(connectionUri) || 'openclaw_business';
    db = client.db(resolvedDbName);

    // Clean up any duplicate org documents from race conditions, then create indexes
    await deduplicateOrgs(db);
    await createIndexes(db);

    if (config.nodeEnv !== 'test') {
      console.log(`Connected to MongoDB (db: ${resolvedDbName})`);
    }
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

/** Extract database name from a MongoDB connection URI */
function extractDbName(uri: string): string | null {
  try {
    const url = new URL(uri);
    const path = url.pathname.replace(/^\//, '');
    return path || null;
  } catch {
    return null;
  }
}

/** Remove duplicate organization documents that were created by concurrent auth middleware calls.
 *  Keeps the oldest document (by _id) for each clerkId and removes the rest. */
async function deduplicateOrgs(database: Db): Promise<void> {
  try {
    const orgs = database.collection('organizations');
    const pipeline = [
      { $group: { _id: '$clerkId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
    ];
    const duplicates = await orgs.aggregate(pipeline).toArray();

    for (const dup of duplicates) {
      // Keep the first (oldest) document, delete the rest
      const idsToDelete = dup.ids.slice(1);
      if (idsToDelete.length > 0) {
        const result = await orgs.deleteMany({ _id: { $in: idsToDelete } });
        console.warn(
          `⚠ Removed ${result.deletedCount} duplicate org documents for clerkId=${dup._id}`
        );
      }
    }

    // Also deduplicate users collection
    const users = database.collection('users');
    const userDuplicates = await users.aggregate([
      { $group: { _id: '$clerkId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();

    for (const dup of userDuplicates) {
      const idsToDelete = dup.ids.slice(1);
      if (idsToDelete.length > 0) {
        const result = await users.deleteMany({ _id: { $in: idsToDelete } });
        console.warn(
          `⚠ Removed ${result.deletedCount} duplicate user documents for clerkId=${dup._id}`
        );
      }
    }
  } catch (err) {
    console.warn('⚠ Deduplication check failed (non-fatal):', err);
  }
}

/** Safely create an index, ignoring duplicate key errors on unique indexes.
 *  This handles the case where duplicate documents already exist in the collection. */
async function safeCreateIndex(
  database: Db,
  collectionName: string,
  indexSpec: any,
  options?: any
): Promise<void> {
  try {
    await database.collection(collectionName).createIndex(indexSpec, options);
  } catch (err: any) {
    // E11000 = duplicate key error — means duplicates exist that prevent unique index creation.
    // Log a warning but don't crash the server. The app can still function, and the
    // duplicate data should be cleaned up separately.
    if (err?.code === 11000) {
      const idxName = typeof indexSpec === 'string' ? indexSpec : JSON.stringify(indexSpec);
      console.warn(
        `⚠ Skipped unique index ${idxName} on ${collectionName} — duplicate documents exist. ` +
        `Clean up duplicates then restart to create the index.`
      );
    } else {
      throw err;
    }
  }
}

async function createIndexes(database: Db): Promise<void> {
  await database.collection('agents').createIndex({ userId: 1 });
  await database.collection('agents').createIndex({ organizationId: 1 });
  await database.collection('agents').createIndex({ status: 1 });
  await database.collection('agents').createIndex({ createdAt: -1 });

  await safeCreateIndex(database, 'users', { clerkId: 1 }, { unique: true });
  await database.collection('users').createIndex({ email: 1 });

  await safeCreateIndex(database, 'organizations', { clerkId: 1 }, { unique: true });
  await safeCreateIndex(database, 'organizations', { slug: 1 }, { unique: true });

  await database.collection('sessions').createIndex({ userId: 1 });
  await database.collection('sessions').createIndex({ organizationId: 1 });
  await database.collection('sessions').createIndex({ agentId: 1 });
  await database.collection('sessions').createIndex({ status: 1 });
  await database.collection('sessions').createIndex({ lastMessageAt: -1 });

  await database.collection('messages').createIndex({ sessionId: 1 });
  await database.collection('messages').createIndex({ agentId: 1 });
  await database.collection('messages').createIndex({ createdAt: 1 });

  await database.collection('channels').createIndex({ userId: 1 });
  await database.collection('channels').createIndex({ agentId: 1 });
  await database.collection('channels').createIndex({ type: 1 });
  await database.collection('channels').createIndex({ status: 1 });

  await database.collection('logs').createIndex({ userId: 1 });
  await database.collection('logs').createIndex({ agentId: 1 });
  await database.collection('logs').createIndex({ sessionId: 1 });
  await database.collection('logs').createIndex({ level: 1 });
  await database.collection('logs').createIndex({ createdAt: -1 });

  await database.collection('webhooks').createIndex({ userId: 1 });
  await database.collection('webhooks').createIndex({ agentId: 1 });
  await database.collection('webhooks').createIndex({ status: 1 });

  await database.collection('activity').createIndex({ userId: 1 });
  await database.collection('activity').createIndex({ organizationId: 1 });
  await database.collection('activity').createIndex({ agentId: 1 });
  await database.collection('activity').createIndex({ type: 1 });
  await database.collection('activity').createIndex({ createdAt: -1 });

  await database.collection('templates').createIndex({ category: 1 });
  await database.collection('templates').createIndex({ isPublic: 1 });
  await database.collection('templates').createIndex({ popularity: -1 });

  await database.collection('invoices').createIndex({ userId: 1 });
  await database.collection('invoices').createIndex({ organizationId: 1 });
  await database.collection('invoices').createIndex({ createdAt: -1 });

  await database.collection('support_tickets').createIndex({ userId: 1 });
  await database.collection('support_tickets').createIndex({ organizationId: 1 });
  await database.collection('support_tickets').createIndex({ status: 1 });

  await database.collection('providers').createIndex({ organizationId: 1 });
  await safeCreateIndex(database, 'providers', { organizationId: 1, provider: 1 }, { unique: true });

  // Organization invitations (Resend-based)
  await safeCreateIndex(database, 'organization_invitations', { token: 1 }, { unique: true });
  await database.collection('organization_invitations').createIndex({ organizationId: 1, status: 1 });
  await database.collection('organization_invitations').createIndex({ email: 1, organizationId: 1 });
  await database.collection('organization_invitations').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  // Stripe checkout idempotency (prevents double-processing)
  await database.collection('processed_checkouts').createIndex({ stripeCheckoutId: 1 }, { unique: true });

  // Knowledge sources
  await database.collection('knowledge_sources').createIndex({ organizationId: 1, createdAt: -1 });
  await database.collection('knowledge_sources').createIndex({ organizationId: 1, agentId: 1 });
  await database.collection('knowledge_sources').createIndex({ organizationId: 1, crawlJobId: 1 });

  // Knowledge chunks (vector search index must be created via Atlas UI/API separately)
  await database.collection('knowledge_chunks').createIndex({ organizationId: 1, sourceId: 1 });
  await database.collection('knowledge_chunks').createIndex({ organizationId: 1, agentId: 1 });
  await database.collection('knowledge_chunks').createIndex({ sourceId: 1, chunkIndex: 1 });

  // Chat messages (unified chat)
  await database.collection('chat_messages').createIndex({ organizationId: 1, userId: 1, createdAt: -1 });
  await database.collection('chat_messages').createIndex({ conversationId: 1, createdAt: 1 });

  // Missions (Havoc Mission Engine)
  await database.collection('missions').createIndex({ agentId: 1, status: 1 });
  await database.collection('missions').createIndex({ agentId: 1, 'trigger.type': 1, status: 1 });
  await database.collection('missions').createIndex({ organizationId: 1, agentId: 1 });

  // Mission runs
  await database.collection('mission_runs').createIndex({ missionId: 1, startedAt: -1 });
  await database.collection('mission_runs').createIndex({ agentId: 1, status: 1 });
}

/**
 * One-time data migrations that run on startup.
 * Each migration is idempotent — safe to run multiple times.
 */
export async function runMigrations(): Promise<void> {
  if (!db) return;

  // Migration: trial → unpaid (no trial anymore, payment required)
  for (const collectionName of ['users', 'organizations']) {
    const result = await db.collection(collectionName).updateMany(
      { 'subscription.plan': 'trial' },
      { $set: { 'subscription.plan': 'unpaid', updatedAt: new Date() }, $unset: { 'subscription.trialStartedAt': '', 'subscription.trialEndsAt': '' } },
    );
    if (result.modifiedCount > 0) {
      console.log(`[migration] Migrated trial → unpaid for ${result.modifiedCount} ${collectionName}`);
    }
  }

  // Migration: Remove creditBalance (BYOK only, no credits)
  for (const collectionName of ['users', 'organizations']) {
    const result = await db.collection(collectionName).updateMany(
      { creditBalance: { $exists: true } },
      { $unset: { creditBalance: '' } },
    );
    if (result.modifiedCount > 0) {
      console.log(`[migration] Removed creditBalance from ${result.modifiedCount} ${collectionName}`);
    }
  }
}

export function getDatabase(): Db {
  if (!db) {
    throw new Error('Database not connected');
  }
  return db;
}

export function getClient(): MongoClient {
  if (!client) {
    throw new Error('Database not connected');
  }
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
  }
}
