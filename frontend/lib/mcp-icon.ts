/**
 * Resolve icon URL for MCP integrations.
 * Uses iconUrl when present, otherwise falls back to Simple Icons CDN for known brands.
 */
const SIMPLE_ICONS_BASE = 'https://cdn.simpleicons.org';

/** Known mcpName/displayName → Simple Icons slug (lowercase, hyphenated) */
const NAME_TO_SLUG: Record<string, string> = {
  intercom: 'intercom',
  slack: 'slack',
  github: 'github',
  notion: 'notion',
  linear: 'linear',
  gmail: 'gmail',
  'google drive': 'googledrive',
  'google sheets': 'googlesheets',
  'google calendar': 'googlecalendar',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  zendesk: 'zendesk',
  stripe: 'stripe',
  discord: 'discord',
  telegram: 'telegram',
  zapier: 'zapier',
  airtable: 'airtable',
  trello: 'trello',
  jira: 'jira',
  asana: 'asana',
  figma: 'figma',
  vercel: 'vercel',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  microsoft: 'microsoft',
  'microsoft teams': 'microsoftteams',
  dropbox: 'dropbox',
  box: 'box',
};

function slugFromMcpName(name: string): string | null {
  const normalized = name.toLowerCase().trim().replace(/\s+/g, ' ');
  const direct = NAME_TO_SLUG[normalized];
  if (direct) return direct;
  // Fallback: single-word → lowercase (Intercom → intercom)
  const singleWord = normalized.replace(/[^a-z0-9]/g, '');
  if (singleWord && NAME_TO_SLUG[singleWord]) return NAME_TO_SLUG[singleWord];
  // Try hyphenated slug (Display Name → display-name)
  const hyphenated = normalized.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (hyphenated && NAME_TO_SLUG[hyphenated]) return NAME_TO_SLUG[hyphenated];
  // Generic: use first word or full name as slug (may 404, img onError hides it)
  const first = normalized.split(/\s/)[0]?.replace(/[^a-z0-9]/g, '') || '';
  return first.length >= 2 ? first : null;
}

function slugFromMcpUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const base = host.replace(/\.run\.tools$/, '').replace(/\.smithery\.ai$/, '');
    const slug = base.includes('--') ? base.split('--')[0] : base;
    return slug && slug.length >= 2 ? slug.toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface McpConnectionLike {
  mcpUrl: string;
  mcpName: string;
  iconUrl?: string | null;
}

/**
 * Returns an icon URL for an MCP connection.
 * Priority: iconUrl → Simple Icons by mcpName → Simple Icons by mcpUrl slug → null (use placeholder).
 */
export function getMcpIconUrl(mcp: McpConnectionLike): string | null {
  if (mcp.iconUrl && typeof mcp.iconUrl === 'string' && mcp.iconUrl.startsWith('http')) {
    return mcp.iconUrl;
  }
  const slug = slugFromMcpName(mcp.mcpName) ?? slugFromMcpUrl(mcp.mcpUrl);
  return slug ? `${SIMPLE_ICONS_BASE}/${slug}` : null;
}

/** Get Simple Icons URL for a tool/integration name (e.g. "Intercom", "Google Sheets"). */
export function getToolIconUrl(toolName: string): string | null {
  const slug = slugFromMcpName(toolName);
  return slug ? `${SIMPLE_ICONS_BASE}/${slug}` : null;
}

/** Tool names to detect in mission instruction text (order: longer phrases first). */
const TOOL_PATTERNS = [
  'google sheets', 'google drive', 'google calendar', 'microsoft teams',
  'intercom mcp', 'intercom', 'slack', 'github', 'notion', 'hubspot',
  'salesforce', 'zendesk', 'stripe', 'linear', 'airtable', 'trello',
  'jira', 'asana', 'gmail', 'discord', 'telegram', 'zapier', 'figma',
  'sheets',  // shorthand for Google Sheets
];

/** Pattern → display name for icon lookup (when different from capitalized pattern). */
const PATTERN_TO_DISPLAY: Record<string, string> = {
  'intercom mcp': 'Intercom',
  'sheets': 'Google Sheets',
};

/**
 * Extract tool/integration names mentioned in text. Returns unique names in order of first appearance.
 */
export function extractToolsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pattern of TOOL_PATTERNS) {
    if (lower.includes(pattern)) {
      const displayName = PATTERN_TO_DISPLAY[pattern] ?? pattern.replace(/\b\w/g, c => c.toUpperCase());
      if (!seen.has(displayName)) {
        seen.add(displayName);
        result.push(displayName);
      }
    }
  }
  return result;
}
