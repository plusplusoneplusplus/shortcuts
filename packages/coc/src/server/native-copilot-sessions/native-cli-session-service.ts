/**
 * Read-only native CLI session providers for filesystem-backed agent stores.
 *
 * Codex and Claude Code persist JSONL transcripts in user-owned CLI stores.
 * CoC scans those stores with read-only filesystem calls, reconstructs
 * transcripts into the same shape as the Copilot native-session view, and never
 * writes, imports, resumes, or mutates external sessions.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseClaudeTranscript, parseCodexRollout } from './cli-session-parsers';
import {
    DEFAULT_NATIVE_SESSION_LIST_LIMIT,
    sessionMatchesWorkspace,
} from './native-copilot-session-service';
import type {
    NativeCliSessionDetail,
    NativeCliSessionDetailResult,
    NativeCliSessionListItem,
    NativeCliSessionListOptions,
    NativeCliSessionListResult,
    NativeCliSessionProviderId,
    NativeSessionProvider,
    NativeSessionWorkspaceScope,
    ReconstructedConversationTurn,
} from './types';

const MAX_NATIVE_SESSION_LIST_LIMIT = 200;
const SUMMARY_PREVIEW_MAX_CHARS = 200;

interface ParsedJsonlLine {
    record: Record<string, unknown>;
}

interface NativeCliSessionMetadata {
    id: string;
    provider: NativeCliSessionProviderId;
    filePath: string;
    storePath: string;
    repository: string | null;
    cwd: string | null;
    hostType: string | null;
    branch: string | null;
    summary: string;
    createdAt: string | null;
    updatedAt: string | null;
    turnCount: number;
}

interface CachedMetadata {
    mtimeMs: number;
    size: number;
    metadata: NativeCliSessionMetadata | null;
}

interface FileSessionProviderOptions {
    storePath?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function parseJsonlLines(raw: string): ParsedJsonlLine[] {
    const lines: ParsedJsonlLine[] = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            const record = asRecord(JSON.parse(trimmed));
            if (record) {
                lines.push({ record });
            }
        } catch {
            // CLI stores can contain partially-written trailing lines.
        }
    }
    return lines;
}

function normalizePathForMatch(value: string): string {
    let normalized = path.normalize(value.trim()).replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathMatchesWorkspace(cwd: string | null, rootPath: string | undefined): boolean {
    if (!cwd || !rootPath) {
        return false;
    }
    const root = normalizePathForMatch(rootPath);
    const candidate = normalizePathForMatch(cwd);
    return candidate === root || candidate.startsWith(`${root}/`);
}

function clampLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return DEFAULT_NATIVE_SESSION_LIST_LIMIT;
    }
    return Math.min(Math.max(Math.floor(limit), 1), MAX_NATIVE_SESSION_LIST_LIMIT);
}

function clampOffset(offset: number | undefined): number {
    if (offset === undefined || !Number.isFinite(offset)) {
        return 0;
    }
    return Math.max(Math.floor(offset), 0);
}

function parseTimestamp(value: string | null | undefined): number {
    return value ? Date.parse(value) : Number.NaN;
}

function summaryPreview(summary: string | null): string {
    if (!summary) {
        return '';
    }
    const firstLine = summary.split('\n', 1)[0].trim();
    return firstLine.length > SUMMARY_PREVIEW_MAX_CHARS
        ? `${firstLine.slice(0, SUMMARY_PREVIEW_MAX_CHARS)}…`
        : firstLine;
}

function firstTextSummary(conversation: ReconstructedConversationTurn[] | null): string {
    const first = conversation?.find(turn => turn.content.trim().length > 0);
    return first?.content.trim() ?? '';
}

function toListItem(metadata: NativeCliSessionMetadata, matchSnippets: string[]): NativeCliSessionListItem {
    return {
        id: metadata.id,
        provider: metadata.provider,
        storePath: metadata.storePath,
        repository: metadata.repository,
        cwd: metadata.cwd,
        hostType: metadata.hostType,
        branch: metadata.branch,
        summaryPreview: summaryPreview(metadata.summary),
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        turnCount: metadata.turnCount,
        matchSnippets,
        searchIndexAvailable: false,
    };
}

function toDetail(metadata: NativeCliSessionMetadata, conversation: ReconstructedConversationTurn[]): NativeCliSessionDetail {
    return {
        id: metadata.id,
        provider: metadata.provider,
        storePath: metadata.storePath,
        repository: metadata.repository,
        cwd: metadata.cwd,
        hostType: metadata.hostType,
        branch: metadata.branch,
        summary: metadata.summary,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        turns: [],
        conversation,
        searchIndexAvailable: false,
    };
}

function snippetForQuery(raw: string, query: string | undefined): string[] {
    if (!query?.trim()) {
        return [];
    }
    const lowerRaw = raw.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerRaw.indexOf(lowerQuery);
    if (index < 0) {
        return [];
    }
    const start = Math.max(0, index - 60);
    const end = Math.min(raw.length, index + query.length + 60);
    return [raw.slice(start, end).replace(/\s+/g, ' ').trim()];
}

function readUtf8(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function safeStat(filePath: string): fs.Stats | null {
    try {
        return fs.statSync(filePath);
    } catch {
        return null;
    }
}

abstract class JsonlFileNativeSessionProvider implements NativeSessionProvider {
    readonly provider: NativeCliSessionProviderId;
    readonly label: string;
    readonly storePath: string;
    private readonly metadataCache = new Map<string, CachedMetadata>();

    protected constructor(provider: NativeCliSessionProviderId, label: string, storePath: string) {
        this.provider = provider;
        this.label = label;
        this.storePath = storePath;
    }

    listSessions(
        scope: NativeSessionWorkspaceScope,
        options: NativeCliSessionListOptions = {},
    ): NativeCliSessionListResult & { limit: number; offset: number } {
        const limit = clampLimit(options.limit);
        const offset = clampOffset(options.offset);
        const storeState = this.getStoreState();
        if (storeState !== 'ok') {
            return { available: false, reason: storeState, limit, offset };
        }

        let files: string[];
        try {
            files = this.listCandidateFiles(scope);
        } catch {
            return { available: false, reason: 'store-invalid', limit, offset };
        }

        const fromTs = options.from ? parseTimestamp(options.from) : undefined;
        const toTs = options.to ? parseTimestamp(options.to) : undefined;
        const q = options.q?.trim();
        let deduplicatedCount = 0;
        const rows: Array<{ metadata: NativeCliSessionMetadata; snippets: string[] }> = [];

        for (const filePath of files) {
            const metadata = this.getMetadata(filePath);
            if (!metadata || !this.metadataMatchesWorkspace(metadata, scope)) {
                continue;
            }
            if (options.sessionId && !metadata.id.includes(options.sessionId)) {
                continue;
            }
            if (options.branch && metadata.branch !== options.branch) {
                continue;
            }
            const updated = parseTimestamp(metadata.updatedAt);
            if (fromTs !== undefined || toTs !== undefined) {
                if (Number.isNaN(updated)) {
                    continue;
                }
                if (fromTs !== undefined && !Number.isNaN(fromTs) && updated < fromTs) {
                    continue;
                }
                if (toTs !== undefined && !Number.isNaN(toTs) && updated > toTs) {
                    continue;
                }
            }
            if (options.excludeSessionIds?.has(metadata.id)) {
                deduplicatedCount += 1;
                continue;
            }
            const raw = q ? readUtf8(filePath) : null;
            const snippets = raw && q ? snippetForQuery(raw, q) : [];
            if (q && snippets.length === 0) {
                continue;
            }
            rows.push({ metadata, snippets });
        }

        rows.sort((a, b) => {
            const aTs = parseTimestamp(a.metadata.updatedAt);
            const bTs = parseTimestamp(b.metadata.updatedAt);
            return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs);
        });

        const total = rows.length;
        const page = rows.slice(offset, offset + limit);
        return {
            available: true,
            items: page.map(row => toListItem(row.metadata, row.snippets)),
            total,
            searchIndexAvailable: false,
            deduplicatedCount,
            backgroundJobCount: 0,
            limit,
            offset,
        };
    }

    getSession(scope: NativeSessionWorkspaceScope, id: string): NativeCliSessionDetailResult {
        const storeState = this.getStoreState();
        if (storeState !== 'ok') {
            return { available: false, reason: storeState };
        }
        let files: string[];
        try {
            files = this.listCandidateFiles(scope);
        } catch {
            return { available: false, reason: 'store-invalid' };
        }
        for (const filePath of files) {
            const metadata = this.getMetadata(filePath);
            if (!metadata || metadata.id !== id || !this.metadataMatchesWorkspace(metadata, scope)) {
                continue;
            }
            const raw = readUtf8(filePath);
            if (raw === null) {
                return { available: false, reason: 'store-invalid' };
            }
            const conversation = this.parseConversation(raw) ?? [];
            return { available: true, session: toDetail(metadata, conversation) };
        }
        return { available: true, session: null };
    }

    protected abstract listCandidateFiles(scope: NativeSessionWorkspaceScope): string[];
    protected abstract parseMetadata(filePath: string, raw: string, stat: fs.Stats): NativeCliSessionMetadata | null;
    protected abstract parseConversation(raw: string): ReconstructedConversationTurn[] | null;

    protected metadataMatchesWorkspace(metadata: NativeCliSessionMetadata, scope: NativeSessionWorkspaceScope): boolean {
        return sessionMatchesWorkspace({ repository: metadata.repository, cwd: metadata.cwd }, scope);
    }

    private getStoreState(): 'ok' | 'store-missing' | 'store-invalid' {
        if (!fs.existsSync(this.storePath)) {
            return 'store-missing';
        }
        const stat = safeStat(this.storePath);
        return stat?.isDirectory() ? 'ok' : 'store-invalid';
    }

    private getMetadata(filePath: string): NativeCliSessionMetadata | null {
        const stat = safeStat(filePath);
        if (!stat?.isFile()) {
            return null;
        }
        const cached = this.metadataCache.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached.metadata;
        }
        const raw = readUtf8(filePath);
        const metadata = raw === null ? null : this.parseMetadata(filePath, raw, stat);
        this.metadataCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, metadata });
        return metadata;
    }
}

function walkJsonlFiles(root: string, predicate: (filePath: string) => boolean): string[] {
    const found: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.jsonl') && predicate(fullPath)) {
                found.push(fullPath);
            }
        }
    }
    return found;
}

export class CodexNativeSessionProvider extends JsonlFileNativeSessionProvider {
    constructor(options: FileSessionProviderOptions = {}) {
        super('codex', 'Codex', options.storePath ?? path.join(os.homedir(), '.codex', 'sessions'));
    }

    protected listCandidateFiles(): string[] {
        return walkJsonlFiles(this.storePath, filePath => path.basename(filePath).startsWith('rollout-'));
    }

    protected parseMetadata(filePath: string, raw: string, stat: fs.Stats): NativeCliSessionMetadata | null {
        const lines = parseJsonlLines(raw);
        const meta = lines
            .map(line => line.record)
            .find(record => asString(record.type) === 'session_meta');
        const payload = asRecord(meta?.payload);
        const id = asString(payload?.id);
        const cwd = asString(payload?.cwd) ?? null;
        if (!id || !cwd) {
            return null;
        }
        const git = asRecord(payload?.git);
        const branch = asString(git?.branch) ?? asString(payload?.branch) ?? null;
        const timestamp = asString(payload?.timestamp) ?? asString(meta?.timestamp) ?? null;
        const conversation = parseCodexRollout(raw);
        return {
            id,
            provider: this.provider,
            filePath,
            storePath: this.storePath,
            repository: null,
            cwd,
            hostType: 'codex',
            branch,
            summary: firstTextSummary(conversation),
            createdAt: timestamp,
            updatedAt: new Date(stat.mtimeMs).toISOString(),
            turnCount: conversation?.length ?? 0,
        };
    }

    protected parseConversation(raw: string): ReconstructedConversationTurn[] | null {
        return parseCodexRollout(raw);
    }
}

function dashEncodeWorkspaceRoot(rootPath: string | undefined): string | undefined {
    if (!rootPath) {
        return undefined;
    }
    return path.resolve(rootPath).replace(/\\/g, '/').replace(/\//g, '-');
}

export class ClaudeNativeSessionProvider extends JsonlFileNativeSessionProvider {
    constructor(options: FileSessionProviderOptions = {}) {
        super('claude', 'Claude Code', options.storePath ?? path.join(os.homedir(), '.claude', 'projects'));
    }

    protected listCandidateFiles(scope: NativeSessionWorkspaceScope): string[] {
        const encoded = dashEncodeWorkspaceRoot(scope.rootPath);
        const roots = encoded ? [path.join(this.storePath, encoded)] : [this.storePath];
        return roots.flatMap(root => fs.existsSync(root) ? walkJsonlFiles(root, () => true) : []);
    }

    protected metadataMatchesWorkspace(metadata: NativeCliSessionMetadata, scope: NativeSessionWorkspaceScope): boolean {
        return pathMatchesWorkspace(metadata.cwd, scope.rootPath);
    }

    protected parseMetadata(filePath: string, raw: string, stat: fs.Stats): NativeCliSessionMetadata | null {
        const records = parseJsonlLines(raw).map(line => line.record);
        const firstWithSession = records.find(record => asString(record.sessionId));
        const firstWithCwd = records.find(record => asString(record.cwd));
        const id = asString(firstWithSession?.sessionId) ?? path.basename(filePath, '.jsonl');
        const cwd = asString(firstWithCwd?.cwd) ?? null;
        if (!id || !cwd) {
            return null;
        }
        const firstTimestamp = records.map(record => asString(record.timestamp)).find(Boolean) ?? null;
        const lastTimestamp = [...records].reverse().map(record => asString(record.timestamp)).find(Boolean) ?? null;
        const branch = records.map(record => asString(record.gitBranch)).find(Boolean) ?? null;
        const conversation = parseClaudeTranscript(raw);
        return {
            id,
            provider: this.provider,
            filePath,
            storePath: this.storePath,
            repository: null,
            cwd,
            hostType: 'claude',
            branch,
            summary: firstTextSummary(conversation),
            createdAt: firstTimestamp,
            updatedAt: lastTimestamp ?? new Date(stat.mtimeMs).toISOString(),
            turnCount: conversation?.length ?? 0,
        };
    }

    protected parseConversation(raw: string): ReconstructedConversationTurn[] | null {
        return parseClaudeTranscript(raw);
    }
}
