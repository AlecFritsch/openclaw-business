import { ObjectId } from 'mongodb';

// ── Response Sanitization ────────────────────────────────────────
// Strips sensitive internal fields from objects before sending to clients.
// NEVER expose gatewayToken, containerId, internalPort, or gatewayUrl in API responses.

/** Fields that must NEVER be sent to the frontend */
const AGENT_SENSITIVE_FIELDS = [
  'gatewayToken',
  'containerId',
  'internalPort',
  'gatewayUrl',
] as const;

/** Nested sensitive fields (dot-notation) stripped after top-level removal */
const AGENT_SENSITIVE_NESTED = [
  'proxy.apiKey',
] as const;

/**
 * Remove sensitive infrastructure fields from an agent document.
 * Returns a new object — does not mutate the original.
 */
export function sanitizeAgent<T extends Record<string, any>>(agent: T): Omit<T, typeof AGENT_SENSITIVE_FIELDS[number]> {
  if (!agent) return agent;
  const sanitized = { ...agent };
  for (const field of AGENT_SENSITIVE_FIELDS) {
    delete (sanitized as any)[field];
  }
  // Strip nested sensitive fields (e.g. proxy.apiKey)
  for (const path of AGENT_SENSITIVE_NESTED) {
    const parts = path.split('.');
    let obj: any = sanitized;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj || typeof obj !== 'object') break;
      if (obj[parts[i]] && typeof obj[parts[i]] === 'object') {
        obj[parts[i]] = { ...obj[parts[i]] };
      }
      obj = obj[parts[i]];
    }
    if (obj && typeof obj === 'object') delete obj[parts[parts.length - 1]];
  }
  return sanitized;
}

/**
 * Sanitize an array of agent documents.
 */
export function sanitizeAgents<T extends Record<string, any>>(agents: T[]): Array<Omit<T, typeof AGENT_SENSITIVE_FIELDS[number]>> {
  return agents.map(sanitizeAgent);
}

// ── MongoDB → JSON Serialization ────────────────────────────────
// Recursively converts MongoDB ObjectId → string and Date → ISO string
// so Fastify's Zod serializerCompiler can validate the response.

/**
 * Recursively convert a MongoDB document to a JSON-safe object.
 * - ObjectId → hex string
 * - Date → ISO 8601 string
 * - Nested objects and arrays are traversed recursively
 * Returns a new object — does not mutate the original.
 */
export function serializeDoc<T>(doc: T): T {
  if (doc === null || doc === undefined) return doc;

  if (doc instanceof ObjectId) return doc.toString() as unknown as T;
  if (doc instanceof Date) return doc.toISOString() as unknown as T;

  if (Array.isArray(doc)) {
    return doc.map((item) => serializeDoc(item)) as unknown as T;
  }

  if (typeof doc === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(doc as Record<string, any>)) {
      result[key] = serializeDoc(value);
    }
    return result as T;
  }

  return doc;
}

/**
 * Sanitize + serialize an agent document for API responses.
 * Strips sensitive fields AND converts MongoDB types to JSON-safe types.
 */
export function serializeAgent<T extends Record<string, any>>(agent: T) {
  return serializeDoc(sanitizeAgent(agent));
}

/**
 * Sanitize + serialize an array of agent documents.
 */
export function serializeAgents<T extends Record<string, any>>(agents: T[]) {
  return agents.map(serializeAgent);
}
