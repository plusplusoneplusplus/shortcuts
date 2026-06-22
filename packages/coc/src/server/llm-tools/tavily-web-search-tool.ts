/**
 * Tavily Web Search Tool
 *
 * Factory that creates a `tavily_web_search` custom tool for the Copilot SDK.
 * The model calls this tool to fetch fresh information from the open web via
 * the Tavily Search API (https://api.tavily.com/search).
 *
 * Per-invocation factory pattern: each AI call gets its own tool instance
 * bound to the supplied dataDir / apiKey, avoiding cross-request contamination.
 *
 * Key resolution order:
 *   1. `options.apiKey` (explicit override; mainly for tests)
 *   2. `~/.coc/providers.json` → `providers.tavily.apiKey`
 *   3. Missing → handler returns an error envelope (does not throw).
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { readProvidersConfig } from '../providers/providers-config';

// ============================================================================
// Types
// ============================================================================

export interface TavilyWebSearchArgs {
    query: string;
    searchDepth?: 'basic' | 'advanced';
    topic?: 'general' | 'news';
    maxResults?: number;
    includeAnswer?: boolean;
    includeRawContent?: boolean;
    includeDomains?: string[];
    excludeDomains?: string[];
    /** Only meaningful when `topic === 'news'`. */
    days?: number;
}

export interface TavilyWebSearchToolOptions {
    /** CoC data directory, used to read providers.json for the API key. */
    dataDir: string;
    /** Optional explicit API key override (skips providers.json read). */
    apiKey?: string;
    /** Optional fetch override (mainly for tests). Defaults to globalThis.fetch. */
    fetchImpl?: typeof fetch;
    /** Optional base URL override (mainly for tests / mock servers). */
    baseUrl?: string;
    /** Request timeout in ms. Defaults to 30s. */
    timeoutMs?: number;
}

export interface TavilyResult {
    title: string;
    url: string;
    snippet: string;
    score: number;
    publishedDate?: string;
    rawContent?: string;
}

export interface TavilyWebSearchSuccess {
    query: string;
    answer?: string;
    results: TavilyResult[];
    totalResults: number;
}

export interface TavilyWebSearchError {
    error: string;
    status?: number;
}

export type TavilyWebSearchResult = TavilyWebSearchSuccess | TavilyWebSearchError;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BASE_URL = 'https://api.tavily.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULTS = 5;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 20;

// ============================================================================
// Helpers
// ============================================================================

/** Resolve the API key from options first, then providers.json. */
async function resolveApiKey(opts: TavilyWebSearchToolOptions): Promise<string | undefined> {
    if (opts.apiKey && opts.apiKey.length > 0) return opts.apiKey;
    try {
        const cfg = await readProvidersConfig(opts.dataDir);
        const key = cfg.providers.tavily?.apiKey;
        return key && key.length > 0 ? key : undefined;
    } catch {
        return undefined;
    }
}

/** Build the JSON body for the Tavily /search request from validated args. */
function buildRequestBody(args: TavilyWebSearchArgs, apiKey: string): Record<string, unknown> {
    const body: Record<string, unknown> = {
        api_key: apiKey,
        query: args.query,
        search_depth: args.searchDepth ?? 'basic',
        topic: args.topic ?? 'general',
        max_results: clampMaxResults(args.maxResults ?? DEFAULT_MAX_RESULTS),
        include_answer: args.includeAnswer ?? true,
        include_raw_content: args.includeRawContent ?? false,
    };
    if (args.includeDomains && args.includeDomains.length > 0) {
        body.include_domains = args.includeDomains;
    }
    if (args.excludeDomains && args.excludeDomains.length > 0) {
        body.exclude_domains = args.excludeDomains;
    }
    if (typeof args.days === 'number' && body.topic === 'news') {
        body.days = args.days;
    }
    return body;
}

function clampMaxResults(n: number): number {
    if (!Number.isFinite(n)) return DEFAULT_MAX_RESULTS;
    return Math.min(MAX_MAX_RESULTS, Math.max(MIN_MAX_RESULTS, Math.floor(n)));
}

/** Map a Tavily API response onto our compact result shape. */
function mapResponse(
    args: TavilyWebSearchArgs,
    payload: any,
): TavilyWebSearchSuccess {
    const includeRaw = args.includeRawContent ?? false;
    const rawResults = Array.isArray(payload?.results) ? payload.results : [];
    const results: TavilyResult[] = rawResults.map((r: any) => {
        const out: TavilyResult = {
            title: typeof r?.title === 'string' ? r.title : '',
            url: typeof r?.url === 'string' ? r.url : '',
            snippet: typeof r?.content === 'string' ? r.content : '',
            score: typeof r?.score === 'number' ? r.score : 0,
        };
        if (typeof r?.published_date === 'string') {
            out.publishedDate = r.published_date;
        }
        if (includeRaw && typeof r?.raw_content === 'string') {
            out.rawContent = r.raw_content;
        }
        return out;
    });
    return {
        query: args.query,
        answer: typeof payload?.answer === 'string' ? payload.answer : undefined,
        results,
        totalResults: results.length,
    };
}

// ============================================================================
// Tool factory
// ============================================================================

export function createTavilyWebSearchTool(options: TavilyWebSearchToolOptions) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const tool = defineTool<TavilyWebSearchArgs>('tavily_web_search', {
        description:
            'Search the live web via Tavily for current information. ' +
            'Use proactively when the user asks about recent events, new releases, or anything likely past your knowledge cutoff. ' +
            'Prefer this over `web_fetch` when starting from a question rather than a known URL. ' +
            'Returns ranked results with snippets and an optional one-shot `answer` summary.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query — a focused question or keyword phrase.',
                },
                searchDepth: {
                    type: 'string',
                    enum: ['basic', 'advanced'],
                    description: 'Retrieval depth. "basic" (default, ~1 credit) or "advanced" (~2 credits, higher quality).',
                },
                topic: {
                    type: 'string',
                    enum: ['general', 'news'],
                    description: 'Search topic. Default "general"; use "news" for recent news (combine with `days`).',
                },
                maxResults: {
                    type: 'number',
                    description: `Maximum results to return (default ${DEFAULT_MAX_RESULTS}, clamped to [${MIN_MAX_RESULTS}, ${MAX_MAX_RESULTS}]).`,
                },
                includeAnswer: {
                    type: 'boolean',
                    description: 'When true (default), include a Tavily-generated one-shot answer summary.',
                },
                includeRawContent: {
                    type: 'boolean',
                    description: 'When true, include each result\'s full raw page content. Default false (large payload).',
                },
                includeDomains: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional allow-list of domains to restrict results to.',
                },
                excludeDomains: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional block-list of domains to exclude from results.',
                },
                days: {
                    type: 'number',
                    description: 'When `topic="news"`, restrict results to the last N days.',
                },
            },
            required: ['query'],
        },
        handler: async (args: TavilyWebSearchArgs): Promise<TavilyWebSearchResult> => {
            if (typeof args?.query !== 'string' || args.query.trim().length === 0) {
                return { error: 'query must be a non-empty string' };
            }

            const apiKey = await resolveApiKey(options);
            if (!apiKey) {
                return {
                    error: 'Tavily API key not configured. Set it in Admin → Providers (Tavily Web Search).',
                };
            }

            if (typeof fetchImpl !== 'function') {
                return { error: 'No fetch implementation available in this runtime.' };
            }

            const body = buildRequestBody(args, apiKey);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const res = await fetchImpl(`${baseUrl}/search`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                if (!res.ok) {
                    let message = `Tavily request failed with status ${res.status}`;
                    try {
                        const errBody = await res.json();
                        if (errBody && typeof errBody === 'object') {
                            const detail = (errBody as any).error ?? (errBody as any).detail ?? (errBody as any).message;
                            if (typeof detail === 'string') message = detail;
                        }
                    } catch {
                        // ignore body parse errors — fall back to status message
                    }
                    return { error: message, status: res.status };
                }
                const payload = await res.json();
                return mapResponse(args, payload);
            } catch (err: any) {
                if (err?.name === 'AbortError') {
                    return { error: `Tavily request timed out after ${timeoutMs}ms` };
                }
                return { error: err?.message ? `Tavily request error: ${err.message}` : 'Tavily request error' };
            } finally {
                clearTimeout(timer);
            }
        },
    });

    return { tool };
}
