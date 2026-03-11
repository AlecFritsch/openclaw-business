// Crawler Service — BFS website crawler with sitemap support

import * as cheerio from 'cheerio';

const USER_AGENT = 'Agenix Knowledge Bot/1.0';
const FETCH_TIMEOUT = 15_000;
const DELAY_MS = 200;
const MAX_CONTENT_LENGTH = 5_000_000; // 5MB per page

export interface CrawlResult {
  url: string;
  content: string;
}

export interface CrawlProgress {
  discovered: number;
  completed: number;
  failed: number;
  currentUrl?: string;
}

export interface CrawlOptions {
  url: string;
  maxPages?: number;
  maxDepth?: number;
  onProgress?: (progress: CrawlProgress) => void;
  shouldCancel?: () => boolean;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function crawlWebsite(opts: CrawlOptions): Promise<CrawlResult[]> {
  const maxPages = opts.maxPages ?? 50;
  const maxDepth = opts.maxDepth ?? 3;
  const baseUrl = new URL(opts.url);
  const domain = baseUrl.hostname;

  const visited = new Set<string>();
  const results: CrawlResult[] = [];
  const disallowed = await fetchRobotsTxt(baseUrl.origin);

  // Try sitemap first
  let queue: { url: string; depth: number }[] = [];
  const sitemapUrls = await fetchSitemap(baseUrl.origin);

  if (sitemapUrls.length > 0) {
    // Filter sitemap to same domain, limit to maxPages
    queue = sitemapUrls
      .filter(u => new URL(u).hostname === domain)
      .slice(0, maxPages)
      .map(u => ({ url: u, depth: 0 }));
  } else {
    queue = [{ url: normalizeUrl(opts.url), depth: 0 }];
  }

  const progress: CrawlProgress = { discovered: queue.length, completed: 0, failed: 0 };
  opts.onProgress?.(progress);

  while (queue.length > 0 && results.length < maxPages) {
    if (opts.shouldCancel?.()) break;

    const { url, depth } = queue.shift()!;
    const normalized = normalizeUrl(url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    if (isDisallowed(normalized, disallowed)) continue;

    progress.currentUrl = normalized;
    opts.onProgress?.(progress);

    try {
      const html = await fetchPage(normalized);
      if (!html) { progress.failed++; continue; }

      const text = extractText(html);
      if (text.trim()) {
        results.push({ url: normalized, content: text });
      }

      // Extract links for BFS (only if not from sitemap and within depth)
      if (sitemapUrls.length === 0 && depth < maxDepth) {
        const links = extractLinks(html, normalized, domain);
        for (const link of links) {
          if (!visited.has(link) && results.length + queue.length < maxPages * 2) {
            queue.push({ url: link, depth: depth + 1 });
            progress.discovered = visited.size + queue.length;
          }
        }
      }

      progress.completed++;
    } catch {
      progress.failed++;
    }

    opts.onProgress?.(progress);
    if (queue.length > 0) await sleep(DELAY_MS);
  }

  return results;
}

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;

    const length = parseInt(res.headers.get('content-length') || '0');
    if (length > MAX_CONTENT_LENGTH) return null;

    return await res.text();
  } catch {
    return null;
  }
}

// ── Sitemap ──────────────────────────────────────────────────────────────────

async function fetchSitemap(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/sitemap.xml`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const $ = cheerio.load(xml, { xml: true });
    return $('loc').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  } catch {
    return [];
  }
}

// ── robots.txt ───────────────────────────────────────────────────────────────

async function fetchRobotsTxt(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const disallowed: string[] = [];
    let relevant = false;
    for (const line of text.split('\n')) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith('user-agent:')) {
        const agent = trimmed.slice(11).trim();
        relevant = agent === '*' || agent === 'agenix';
      } else if (relevant && trimmed.startsWith('disallow:')) {
        const path = line.trim().slice(9).trim();
        if (path) disallowed.push(path);
      }
    }
    return disallowed;
  } catch {
    return [];
  }
}

function isDisallowed(url: string, disallowed: string[]): boolean {
  if (disallowed.length === 0) return false;
  const path = new URL(url).pathname;
  return disallowed.some(d => path.startsWith(d));
}

// ── Link Extraction ──────────────────────────────────────────────────────────

function extractLinks(html: string, pageUrl: string, domain: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href]').each((_, el) => {
    try {
      const href = $(el).attr('href');
      if (!href) return;
      const resolved = new URL(href, pageUrl);
      if (resolved.hostname !== domain) return;
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
      links.add(normalizeUrl(resolved.href));
    } catch { /* invalid URL */ }
  });

  return [...links];
}

// ── Text Extraction ──────────────────────────────────────────────────────────

function extractText(html: string): string {
  const $ = cheerio.load(html);
  // Remove non-content elements
  $('script, style, nav, footer, header, iframe, noscript, svg, [role="navigation"], [role="banner"], [aria-hidden="true"]').remove();

  // Prefer main content areas
  const main = $('main, article, [role="main"], .content, .post-content, .markdown-body, .documentation').first();
  const target = main.length ? main : $('body');

  return target.text().replace(/\s+/g, ' ').trim();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  // Remove trailing slash except for root
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.href;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
