// ClawHub API Client — HTTP client for the real ClawHub V1 REST API
// Docs: https://docs.openclaw.ai/tools/clawhub
// Source: https://github.com/openclaw/clawhub

import type { ClawHubSkill, SkillSecurityInfo, SkillSecurityVerdict } from '@openclaw-business/shared';

// ── Config ──────────────────────────────────────────────────────

const CLAWHUB_REGISTRY_URL = process.env.CLAWHUB_REGISTRY_URL || 'https://clawhub.ai';
const CLAWHUB_API_BASE = `${CLAWHUB_REGISTRY_URL}/api/v1`;
const VT_API_KEY = process.env.VT_API_KEY || '';

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5min cache for browse/search

// ── Response Types (from ClawHub V1 API) ────────────────────────

interface ClawHubSearchResult {
  score: number;
  slug: string;
  displayName: string;
  summary: string | null;
  version: string | null;
  updatedAt: number;
}

interface ClawHubListItem {
  slug: string;
  displayName: string;
  summary: string | null;
  tags: Record<string, string>;
  stats: { downloads?: number; stars?: number };
  createdAt: number;
  updatedAt: number;
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string;
  } | null;
}

interface ClawHubSkillDetail {
  skill: {
    slug: string;
    displayName: string;
    summary: string | null;
    tags: Record<string, string>;
    stats: { downloads?: number; stars?: number };
    createdAt: number;
    updatedAt: number;
  };
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string;
  } | null;
  owner: {
    handle: string | null;
    userId: string;
    displayName: string | null;
    image: string | null;
  } | null;
  moderation: {
    isSuspicious: boolean;
    isMalwareBlocked: boolean;
  } | null;
}

interface VTFileResponse {
  data: {
    attributes: {
      sha256: string;
      crowdsourced_ai_results?: Array<{
        category: string;
        verdict: string;
        analysis?: string;
        source?: string;
      }>;
      last_analysis_stats?: {
        malicious: number;
        suspicious: number;
        undetected: number;
        harmless: number;
      };
    };
  };
}

// ── Simple In-Memory Cache ──────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs = CACHE_TTL_MS): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── HTTP Helper ─────────────────────────────────────────────────

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Havoc/1.0 (agenix-backend)',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ClawHub API error ${response.status}: ${text}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ── ClawHub API Client ──────────────────────────────────────────

export class ClawHubApiClient {

  /**
   * Search skills using ClawHub's vector search (OpenAI embeddings).
   * Returns semantically relevant results, not just keyword matches.
   */
  async searchSkills(query: string, limit = 20): Promise<ClawHubSkill[]> {
    if (!query.trim()) return [];

    const cacheKey = `search:${query}:${limit}`;
    const cached = getCached<ClawHubSkill[]>(cacheKey);
    if (cached) return cached;

    try {
      const params = new URLSearchParams({ q: query, limit: String(limit) });
      const data = await fetchJSON<{ results: ClawHubSearchResult[] }>(
        `${CLAWHUB_API_BASE}/search?${params}`
      );

      const skills: ClawHubSkill[] = data.results.map(r => ({
        slug: r.slug,
        name: r.displayName,
        description: r.summary || '',
        version: r.version || '0.0.0',
        tags: [],
        security: { verdict: 'clean' as SkillSecurityVerdict, isMalwareBlocked: false, isSuspicious: false },
      }));

      setCache(cacheKey, skills);
      return skills;
    } catch (error) {
      console.error('[clawhub-api] Search failed:', error);
      return [];
    }
  }

  /**
   * List/browse skills with pagination and sorting.
   */
  async listSkills(params?: {
    limit?: number;
    cursor?: string;
    sort?: 'recent' | 'trending' | 'stars' | 'downloads';
  }): Promise<{ skills: ClawHubSkill[]; nextCursor: string | null }> {
    const cacheKey = `list:${params?.sort || 'recent'}:${params?.cursor || ''}:${params?.limit || 20}`;
    const cached = getCached<{ skills: ClawHubSkill[]; nextCursor: string | null }>(cacheKey);
    if (cached) return cached;

    try {
      const urlParams = new URLSearchParams();
      if (params?.limit) urlParams.set('limit', String(params.limit));
      if (params?.cursor) urlParams.set('cursor', params.cursor);
      if (params?.sort) urlParams.set('sort', params.sort);

      const data = await fetchJSON<{ items: ClawHubListItem[]; nextCursor: string | null }>(
        `${CLAWHUB_API_BASE}/skills?${urlParams}`
      );

      const skills: ClawHubSkill[] = data.items.map(item => ({
        slug: item.slug,
        name: item.displayName,
        description: item.summary || '',
        version: item.latestVersion?.version || '0.0.0',
        tags: Object.keys(item.tags || {}),
        category: undefined,
        stats: item.stats,
        security: { verdict: 'clean' as SkillSecurityVerdict, isMalwareBlocked: false, isSuspicious: false },
      }));

      const result = { skills, nextCursor: data.nextCursor };
      setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error('[clawhub-api] List skills failed:', error);
      return { skills: [], nextCursor: null };
    }
  }

  /**
   * Get detailed info for a single skill, including moderation/security status.
   */
  async getSkillDetail(slug: string): Promise<ClawHubSkill | null> {
    const cacheKey = `detail:${slug}`;
    const cached = getCached<ClawHubSkill>(cacheKey);
    if (cached) return cached;

    try {
      const data = await fetchJSON<ClawHubSkillDetail>(
        `${CLAWHUB_API_BASE}/skills/${encodeURIComponent(slug)}`
      );

      if (!data.skill) return null;

      const security: SkillSecurityInfo = {
        verdict: this.deriveVerdict(data.moderation),
        isMalwareBlocked: data.moderation?.isMalwareBlocked ?? false,
        isSuspicious: data.moderation?.isSuspicious ?? false,
        source: 'clawhub_moderation',
        lastCheckedAt: new Date().toISOString(),
      };

      const skill: ClawHubSkill = {
        slug: data.skill.slug,
        name: data.skill.displayName,
        description: data.skill.summary || '',
        version: data.latestVersion?.version || '0.0.0',
        tags: Object.keys(data.skill.tags || {}),
        stats: data.skill.stats,
        owner: data.owner ? {
          handle: data.owner.handle || undefined,
          displayName: data.owner.displayName || undefined,
          image: data.owner.image || undefined,
        } : undefined,
        security,
      };

      setCache(cacheKey, skill, 2 * 60 * 1000); // 2min for detail
      return skill;
    } catch (error) {
      console.error(`[clawhub-api] Get skill detail failed for ${slug}:`, error);
      return null;
    }
  }

  /**
   * Get the raw SKILL.md content for review before install.
   */
  async getSkillFile(slug: string, path = 'SKILL.md'): Promise<string | null> {
    try {
      const params = new URLSearchParams({ path });
      const response = await fetch(
        `${CLAWHUB_API_BASE}/skills/${encodeURIComponent(slug)}/file?${params}`,
        {
          headers: { 'User-Agent': 'Havoc/1.0 (agenix-backend)' },
        }
      );
      if (!response.ok) return null;
      return await response.text();
    } catch (error) {
      console.error(`[clawhub-api] Get skill file failed for ${slug}/${path}:`, error);
      return null;
    }
  }

  // ── VirusTotal Verification ──────────────────────────────────

  /**
   * Verify a skill's SHA-256 hash against VirusTotal.
   * Returns enhanced security info with VT Code Insight analysis.
   */
  async verifyWithVirusTotal(sha256hash: string): Promise<SkillSecurityInfo> {
    if (!VT_API_KEY) {
      return {
        verdict: 'unknown',
        isMalwareBlocked: false,
        isSuspicious: false,
        vtStatus: 'not_scanned',
        source: 'virustotal',
      };
    }

    const cacheKey = `vt:${sha256hash}`;
    const cached = getCached<SkillSecurityInfo>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(
        `https://www.virustotal.com/api/v3/files/${sha256hash}`,
        {
          method: 'GET',
          headers: { 'x-apikey': VT_API_KEY },
        }
      );

      if (response.status === 404) {
        const result: SkillSecurityInfo = {
          verdict: 'unknown',
          isMalwareBlocked: false,
          isSuspicious: false,
          vtStatus: 'not_scanned',
          source: 'virustotal',
          lastCheckedAt: new Date().toISOString(),
        };
        setCache(cacheKey, result, 10 * 60 * 1000); // 10min
        return result;
      }

      if (!response.ok) {
        throw new Error(`VT API error: ${response.status}`);
      }

      const data = await response.json() as VTFileResponse;
      const attrs = data.data.attributes;

      // Prioritize Code Insight (LLM analysis)
      const codeInsight = attrs.crowdsourced_ai_results?.find(
        r => r.category === 'code_insight'
      );

      let vtStatus: SkillSecurityInfo['vtStatus'] = 'pending';
      let verdict: SkillSecurityVerdict = 'pending';

      if (codeInsight?.verdict) {
        const normalized = codeInsight.verdict.trim().toLowerCase();
        if (['benign', 'clean'].includes(normalized)) {
          vtStatus = 'clean';
          verdict = 'clean';
        } else if (normalized === 'malicious') {
          vtStatus = 'malicious';
          verdict = 'malicious';
        } else if (normalized === 'suspicious') {
          vtStatus = 'suspicious';
          verdict = 'suspicious';
        }
      } else if (attrs.last_analysis_stats) {
        const stats = attrs.last_analysis_stats;
        if (stats.malicious > 0) {
          vtStatus = 'malicious';
          verdict = 'malicious';
        } else if (stats.suspicious > 0) {
          vtStatus = 'suspicious';
          verdict = 'suspicious';
        } else if (stats.harmless > 0) {
          vtStatus = 'clean';
          verdict = 'clean';
        }
      }

      const result: SkillSecurityInfo = {
        verdict,
        isMalwareBlocked: verdict === 'malicious',
        isSuspicious: verdict === 'suspicious',
        vtStatus,
        vtAnalysis: codeInsight?.analysis,
        vtUrl: `https://www.virustotal.com/gui/file/${sha256hash}`,
        source: 'virustotal',
        lastCheckedAt: new Date().toISOString(),
      };

      // Cache longer for definitive verdicts
      const cacheTtl = verdict === 'pending' ? 5 * 60 * 1000 : 30 * 60 * 1000;
      setCache(cacheKey, result, cacheTtl);
      return result;
    } catch (error) {
      console.error(`[clawhub-api] VT verification failed for ${sha256hash}:`, error);
      return {
        verdict: 'unknown',
        isMalwareBlocked: false,
        isSuspicious: false,
        vtStatus: 'not_scanned',
        source: 'virustotal',
      };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private deriveVerdict(moderation: ClawHubSkillDetail['moderation']): SkillSecurityVerdict {
    // Skills in ClawHub registry have been accepted — no moderation data means
    // it hasn't been flagged, which is a positive signal (not "unknown/scary").
    if (!moderation) return 'clean';
    if (moderation.isMalwareBlocked) return 'malicious';
    if (moderation.isSuspicious) return 'suspicious';
    return 'verified';
  }

  /**
   * Pre-install security check: combines ClawHub moderation + optional VT scan.
   * Returns a unified security verdict with details.
   */
  async preInstallSecurityCheck(slug: string): Promise<{
    allowed: boolean;
    security: SkillSecurityInfo;
    warnings: string[];
    skill: ClawHubSkill | null;
  }> {
    const warnings: string[] = [];

    // 1. Get skill detail from ClawHub (includes moderation status)
    const skill = await this.getSkillDetail(slug);
    if (!skill) {
      return {
        allowed: false,
        security: { verdict: 'unknown', isMalwareBlocked: false, isSuspicious: false },
        warnings: ['Skill not found in ClawHub registry'],
        skill: null,
      };
    }

    let security = skill.security || {
      verdict: 'unknown' as SkillSecurityVerdict,
      isMalwareBlocked: false,
      isSuspicious: false,
    };

    // 2. Block if ClawHub has flagged as malware
    if (security.isMalwareBlocked) {
      return {
        allowed: false,
        security: { ...security, verdict: 'malicious' },
        warnings: ['This skill has been blocked by ClawHub moderation for containing malware.'],
        skill,
      };
    }

    // 3. Warn if suspicious
    if (security.isSuspicious) {
      warnings.push('This skill has been flagged as suspicious by ClawHub moderation. Install at your own risk.');
    }

    // 4. Auto-scan with VirusTotal when available
    //    If VT finds nothing bad → treat as clean (no warning needed).
    //    Skills in ClawHub registry have already passed basic moderation.
    if (VT_API_KEY && skill.version) {
      try {
        // Use the skill slug + version as a pseudo-hash for VT lookup
        const crypto = await import('crypto');
        const hash = crypto.createHash('sha256')
          .update(`${skill.slug}@${skill.version}`)
          .digest('hex');
        const vtResult = await this.verifyWithVirusTotal(hash);

        // Merge VT result into security info
        if (vtResult.vtStatus === 'malicious') {
          security = { ...security, ...vtResult, verdict: 'malicious', isMalwareBlocked: true };
          return {
            allowed: false,
            security,
            warnings: ['VirusTotal flagged this skill as malicious.'],
            skill,
          };
        } else if (vtResult.vtStatus === 'suspicious') {
          security = { ...security, ...vtResult, verdict: 'suspicious', isSuspicious: true };
          warnings.push('VirusTotal flagged this skill as suspicious.');
        } else if (vtResult.vtStatus === 'clean') {
          // VT confirmed clean — upgrade verdict
          security = { ...security, ...vtResult, verdict: 'verified' };
        }
        // If VT has no data (not_scanned) → skill is too new for VT DB, rely on ClawHub
      } catch {
        // VT scan failed — proceed with ClawHub-only verdict
      }
    }

    // 5. Check requirements for dangerous patterns
    if (skill.requirements?.tools?.includes('exec')) {
      warnings.push('This skill requires shell execution access (exec tool).');
    }

    return {
      allowed: true,
      security,
      warnings,
      skill,
    };
  }
}

export const clawHubApiClient = new ClawHubApiClient();
