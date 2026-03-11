/** Smithery MCP connection status — matches Smithery Connect API */
export type SmitheryConnectionStatus = 'connected' | 'auth_required' | 'error' | 'unknown';

export interface SmitheryConnection {
  connectionId: string;
  mcpUrl: string;
  mcpName: string | null;
  status: SmitheryConnectionStatus;
  /** Present when status is 'auth_required' — continue OAuth flow in browser */
  authorizationUrl?: string | null;
  /** Present when status is 'error' — Smithery's error message */
  errorMessage?: string | null;
}

export interface SmitheryServer {
  qualifiedName: string;
  displayName: string;
  description: string;
  iconUrl: string | null;
  mcpUrl: string;
  homepage: string;
}

/** Parsed config field from Smithery configSchema (x-from: header | query) */
export interface SmitheryConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  /** Where to send: header name or query param name */
  target: { kind: 'header'; name: string } | { kind: 'query'; name: string };
  description?: string;
  /** Essential = required or header (API keys). Optional query params are "advanced". */
  essential: boolean;
}

export interface SmitheryServerDetail extends SmitheryServer {
  configSchema: Record<string, unknown> | null;
}

/** Parse Smithery configSchema (JSON Schema) into form fields.
 *  - Respects x-from / x-to for routing (header vs query).
 *  - Falls back to heuristics when x-from is absent (API-key-looking fields → header).
 *  - Skips nested object/array fields (not renderable as simple inputs).
 */
export function parseSmitheryConfigSchema(schema: Record<string, unknown> | null): SmitheryConfigField[] {
  if (!schema || typeof schema !== 'object') return [];
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props || typeof props !== 'object') return [];
  const required = new Set((schema.required as string[]) ?? []);
  const fields: SmitheryConfigField[] = [];

  for (const [key, prop] of Object.entries(props)) {
    if (!prop || typeof prop !== 'object') continue;

    // Skip non-primitive types — nested objects/arrays can't be shown as a simple input
    const propType = prop.type as string | undefined;
    if (propType === 'object' || propType === 'array') continue;
    // Skip properties without a type if they have complex structure (nested properties)
    if (!propType && prop.properties) continue;

    const xFrom = prop['x-from'] as { header?: string; query?: string } | undefined;
    const xTo = prop['x-to'] as { header?: string; query?: string } | undefined;
    const targetHeader = xTo?.header ?? xFrom?.header;
    const targetQuery = xTo?.query ?? xFrom?.query;
    const req = required.has(key);

    if (targetHeader) {
      // Explicit x-from/x-to header
      fields.push({
        key,
        label: toShortLabel(prop, key),
        type: normalizeType(propType),
        required: req,
        target: { kind: 'header', name: targetHeader },
        description: prop.description as string | undefined,
        essential: true,
      });
    } else if (targetQuery !== undefined) {
      // Explicit x-from query (empty string means use field key)
      const queryName = targetQuery !== '' ? targetQuery : key;
      fields.push({
        key,
        label: toShortLabel(prop, key),
        type: normalizeType(propType),
        required: req,
        target: { kind: 'query', name: queryName },
        description: prop.description as string | undefined,
        essential: req,
      });
    } else {
      // No x-from: heuristic — API-key-like names go as headers, everything else as query
      const lk = key.toLowerCase();
      const isApiKey = /api[-_]?key|apikey|secret|token|auth|credential/i.test(lk);
      if (isApiKey) {
        fields.push({
          key,
          label: toShortLabel(prop, key),
          type: normalizeType(propType),
          required: req,
          target: { kind: 'header', name: key },
          description: prop.description as string | undefined,
          essential: true,
        });
      } else {
        fields.push({
          key,
          label: toShortLabel(prop, key),
          type: normalizeType(propType),
          required: req,
          target: { kind: 'query', name: key },
          description: prop.description as string | undefined,
          essential: req,
        });
      }
    }
  }

  // Sort: required first, headers before query
  fields.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.target.kind !== b.target.kind) return a.target.kind === 'header' ? -1 : 1;
    return 0;
  });
  return fields;
}

function normalizeType(t: string | undefined): 'string' | 'number' | 'boolean' {
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

function toShortLabel(prop: Record<string, unknown>, key: string): string {
  const title = prop.title as string | undefined;
  const desc = prop.description as string | undefined;
  if (title && title.length <= 50) return title;
  if (desc && desc.length <= 50) return desc;
  if (desc) {
    const short = desc.replace(/^(The|Your|API key for|Enable|Use|Whether or not to)\s+/i, '').replace(/\s+to use\.?$/i, '').trim();
    return short.length <= 50 ? short : short.slice(0, 47) + '…';
  }
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}

export interface SmitherySkill {
  slug: string;
  namespace: string;
  displayName: string;
  description: string;
  categories: string[];
  qualityScore: number;
  homepage: string;
  gitUrl?: string;
  iconUrl?: string | null;
}

export interface SmitheryConnectRequest {
  mcpUrl: string;
  mcpName?: string;
  agentId?: string;
  connectionId?: string;
  /** Optional headers (e.g. x-api-key, Authorization) for API-key-based servers */
  headers?: Record<string, string>;
}

export interface SmitheryConnectResponse {
  status: 'connected' | 'auth_required';
  connectionId: string;
  authorizationUrl?: string;
}
