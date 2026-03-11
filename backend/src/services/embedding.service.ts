// Embedding Service — generates vector embeddings via Gemini gemini-embedding-001

import { config } from '../config/env.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001';
const EMBEDDING_DIMS = 3072;

export { EMBEDDING_DIMS };

/** Embed a single text via Gemini embedContent API. Returns 3072-dim vector. */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = config.geminiApiKey;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const res = await fetch(`${GEMINI_BASE}:embedContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text }] } }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini embedding error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { embedding: { values: number[] } };
  return data.embedding.values;
}

/** Embed multiple texts sequentially. Returns array of 3072-dim vectors. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embedText(text));
  }
  return results;
}
