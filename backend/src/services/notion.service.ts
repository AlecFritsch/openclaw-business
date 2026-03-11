// Notion Service — OAuth + page sync for Knowledge

import { config } from '../config/env.js';

export function getNotionAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.notionClientId,
    redirect_uri: config.notionRedirectUri,
    response_type: 'code',
    owner: 'user',
    state,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params}`;
}

export async function exchangeNotionCode(code: string): Promise<{ accessToken: string; workspaceName: string }> {
  const res = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.notionClientId}:${config.notionClientSecret}`).toString('base64')}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: config.notionRedirectUri }),
  });
  if (!res.ok) throw new Error(`Notion token exchange failed: ${res.status}`);
  const data = await res.json() as any;
  return { accessToken: data.access_token, workspaceName: data.workspace_name || 'Notion' };
}

export async function listNotionPages(accessToken: string): Promise<Array<{ id: string; title: string; lastEdited: string }>> {
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: { property: 'object', value: 'page' }, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: 100 }),
  });
  if (!res.ok) throw new Error(`Notion search failed: ${res.status}`);
  const data = await res.json() as any;
  return (data.results || []).map((p: any) => ({
    id: p.id,
    title: p.properties?.title?.title?.[0]?.plain_text ?? p.properties?.Name?.title?.[0]?.plain_text ?? 'Untitled',
    lastEdited: p.last_edited_time,
  }));
}

export async function getNotionPageContent(accessToken: string, pageId: string): Promise<string> {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Notion-Version': '2022-06-28' },
  });
  if (!res.ok) throw new Error(`Notion blocks failed: ${res.status}`);
  const data = await res.json() as any;
  return (data.results || []).map((block: any) => {
    const type = block.type;
    const content = block[type];
    if (!content) return '';
    const text = content.rich_text?.map((t: any) => t.plain_text).join('') ?? '';
    if (type === 'heading_1') return `# ${text}`;
    if (type === 'heading_2') return `## ${text}`;
    if (type === 'heading_3') return `### ${text}`;
    if (type === 'bulleted_list_item') return `- ${text}`;
    if (type === 'numbered_list_item') return `1. ${text}`;
    if (type === 'code') return `\`\`\`\n${text}\n\`\`\``;
    if (type === 'divider') return '---';
    return text;
  }).filter(Boolean).join('\n');
}
