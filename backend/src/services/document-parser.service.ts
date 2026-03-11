// Document Parser Service
// LlamaParse (cloud) for all document formats, local parsing only for plain text/CSV

import { config } from '../config/env.js';

interface ParseResult {
  content: string;
  pageCount?: number;
}

const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.tsv', '.pptx', '.html', '.htm'] as const;
const MAX_CONTENT_LENGTH = 500_000;
const LLAMAPARSE_API = 'https://api.cloud.llamaindex.ai/api/v2';

export function isSupportedFormat(filename: string): boolean {
  const ext = getExtension(filename);
  return SUPPORTED_EXTENSIONS.includes(ext as any);
}

export function getSupportedFormats(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.substring(dot).toLowerCase();
}

export async function parseDocument(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<ParseResult> {
  const ext = getExtension(filename);

  // Simple text formats — parse locally (no API needed)
  if (ext === '.txt' || ext === '.md') return parsePlainText(buffer);
  if (ext === '.csv' || ext === '.tsv') return parseCsv(buffer, ext === '.tsv');

  // All other formats — LlamaParse (required)
  if (!config.llamaParseApiKey) {
    throw new Error('LLAMA_PARSE_API_KEY is not configured');
  }

  return await llamaParse(buffer, filename);
}

// ── LlamaParse (cloud) ─────────────────────────────────────────────

async function llamaParse(buffer: Buffer, filename: string): Promise<ParseResult> {
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(buffer)]), filename);
  formData.append('configuration', JSON.stringify({
    tier: 'cost_effective',
    version: 'latest',
    output_options: {
      markdown: { annotate_links: true, tables: { output_tables_as_markdown: true, merge_continued_tables: true } },
    },
  }));

  // Upload
  const uploadRes = await fetch(`${LLAMAPARSE_API}/parse/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.llamaParseApiKey}` },
    body: formData,
  });
  if (!uploadRes.ok) {
    const errBody = await uploadRes.text().catch(() => '');
    throw new Error(`LlamaParse upload failed: ${uploadRes.status} ${errBody}`);
  }
  const uploadData = await uploadRes.json() as Record<string, any>;
  const jobId = uploadData.job?.id ?? uploadData.id;
  if (!jobId) throw new Error(`LlamaParse: unexpected response: ${JSON.stringify(uploadData).slice(0, 200)}`);

  // Poll for completion (max ~3 min)
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000));

    const statusRes = await fetch(`${LLAMAPARSE_API}/parse/${jobId}?expand=markdown`, {
      headers: { Authorization: `Bearer ${config.llamaParseApiKey}` },
    });
    if (!statusRes.ok) continue;

    const data = await statusRes.json() as Record<string, any>;
    const status = data.job?.status ?? data.status;
    if (status === 'FAILED') throw new Error(`LlamaParse job failed: ${data.job?.error_message ?? data.error_message}`);
    if (status === 'COMPLETED') {
      // markdown can be string, object with pages, or array
      let content = '';
      if (typeof data.markdown === 'string') {
        content = data.markdown;
      } else if (data.markdown?.pages && Array.isArray(data.markdown.pages)) {
        content = data.markdown.pages.map((p: any) => p.markdown ?? p.text ?? '').join('\n\n');
      } else if (Array.isArray(data.markdown)) {
        content = data.markdown.map((p: any) => typeof p === 'string' ? p : p?.markdown ?? p?.text ?? '').join('\n\n');
      } else if (typeof data.result === 'string') {
        content = data.result;
      }
      if (!content) {
        console.error('[document-parser] LlamaParse completed but no content found:', JSON.stringify(data).slice(0, 500));
        content = '';
      }
      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.substring(0, MAX_CONTENT_LENGTH) + '\n\n[... truncated]';
      }
      return { content: content.trim() };
    }
  }

  throw new Error('LlamaParse timeout');
}

// ── Local (plain text only) ────────────────────────────────────────

function parsePlainText(buffer: Buffer): ParseResult {
  let content = buffer.toString('utf-8');
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.substring(0, MAX_CONTENT_LENGTH) + '\n\n[... truncated]';
  }
  return { content: content.trim() };
}

function parseCsv(buffer: Buffer, isTsv: boolean): ParseResult {
  const raw = buffer.toString('utf-8');
  const separator = isTsv ? '\t' : ',';
  const lines = raw.split('\n').filter(l => l.trim());

  if (lines.length === 0) return { content: '' };

  const headers = lines[0].split(separator).map(h => h.trim().replace(/^"(.*)"$/, '$1'));
  const rows = lines.slice(1).map(line =>
    line.split(separator).map(c => c.trim().replace(/^"(.*)"$/, '$1'))
  );

  let content = `| ${headers.join(' | ')} |\n`;
  content += `| ${headers.map(() => '---').join(' | ')} |\n`;
  for (const row of rows) {
    content += `| ${row.join(' | ')} |\n`;
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.substring(0, MAX_CONTENT_LENGTH) + '\n\n[... truncated]';
  }

  return { content: content.trim() };
}
