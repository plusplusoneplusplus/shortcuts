/**
 * Resolves `system_one` source refs into labeled text sections.
 *
 * Tool refs read the calling process's {@link ToolCallLedger}; file refs read
 * from the workspace root and must stay inside it after symlinks resolve; text
 * refs pass through. Every source is trimmed head+tail to a per-source budget,
 * and the assembled state is checked against a total budget.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DecisionErrorCode } from '@plusplusoneplusplus/coc-client';
import type { LedgerEntry, LedgerScope, ToolCallLedger } from '../../executors/tool-call-ledger';

export const SYSTEM_ONE_LIMITS = {
    maxSources: 8,
    maxLast: 5,
    maxTextBytes: 4 * 1024,
    maxSourceBytes: 64 * 1024,
    maxStateBytes: 200 * 1024,
    /** Files above this size are refused rather than read into memory. */
    maxFileReadBytes: 16 * 1024 * 1024,
} as const;

export type SystemOneSource =
    | { tool: string; nth?: number; turn?: LedgerScope }
    | { last: number }
    | { file: string; lines?: string }
    | { text: string };

export type SystemOneErrorCode =
    | 'DECISION_INVALID_REQUEST'
    | 'SOURCE_NOT_FOUND'
    | 'SOURCE_PENDING'
    | 'SOURCE_FAILED'
    | 'SOURCE_OUTSIDE_WORKSPACE'
    | 'SOURCE_UNSUPPORTED'
    | 'STATE_TOO_LARGE';

export interface SystemOneError {
    error: SystemOneErrorCode | DecisionErrorCode;
    message: string;
    /** Zero-based index of the offending entry in `sources`. */
    source?: number;
}

export interface ResolvedSourceMeta {
    ref: string;
    bytes: number;
    toolCallId?: string;
    trimmed?: true;
}

export interface ResolvedSection {
    label: string;
    content: string;
    meta: ResolvedSourceMeta;
}

export type SourceResolution = { ok: true; sections: ResolvedSection[] } | { ok: false; error: SystemOneError };

export interface ResolveSourcesInput {
    sources: readonly SystemOneSource[];
    ledger: ToolCallLedger;
    workspaceRoot: string;
    /** The `system_one` call's own id, never counted as a source. */
    excludeId?: string;
}

class SourceFailure extends Error {
    constructor(readonly code: SystemOneErrorCode, message: string) {
        super(message);
    }
}

/** Lowercase and drop an MCP server prefix (`mcp__coc_llm_tools__kusto_query` → `kusto_query`). */
export function normalizeToolName(name: string): string {
    return name.toLowerCase().replace(/^mcp__.+?__/, '');
}

function isImageDataUrl(text: string): boolean {
    return /^data:[^;,]+;base64,/.test(text);
}

function isBinary(text: string): boolean {
    return text.includes('\u0000');
}

/** Keep the head and tail of `text` within `maxBytes`, with a marker in between. */
export function trimToBudget(text: string, maxBytes: number): { content: string; trimmed: boolean } {
    const buf = Buffer.from(text, 'utf-8');
    if (buf.length <= maxBytes) return { content: text, trimmed: false };
    const half = Math.floor(maxBytes / 2);
    const dropped = buf.length - half * 2;
    return {
        content: `${buf.subarray(0, half).toString('utf-8')}\n… [trimmed ${dropped} bytes] …\n${buf.subarray(buf.length - half).toString('utf-8')}`,
        trimmed: true,
    };
}

function toolContent(entry: LedgerEntry): string {
    const result = entry.result ?? '';
    if (isImageDataUrl(result) || isBinary(result)) {
        throw new SourceFailure('SOURCE_UNSUPPORTED', `The ${entry.name} result (toolCallId ${entry.id}) is image or binary content.`);
    }
    return result;
}

async function resolveToolRef(
    source: { tool: string; nth?: number; turn?: LedgerScope },
    input: ResolveSourcesInput,
): Promise<ResolvedSection[]> {
    const nth = source.nth ?? -1;
    const scope = source.turn ?? 'any';
    const wanted = normalizeToolName(source.tool);
    const matches = (await input.ledger.list({ excludeId: input.excludeId, scope }))
        .filter(entry => normalizeToolName(entry.name) === wanted);
    const settled = matches.filter(entry => entry.status !== 'running');
    const index = nth < 0 ? settled.length + nth : nth - 1;
    const entry = settled[index];
    const ref = `${source.tool}#${nth}`;

    if (!entry) {
        if (matches.some(m => m.status === 'running')) {
            throw new SourceFailure('SOURCE_PENDING', `The ${source.tool} call is still running. Call system_one after it finishes, not in the same parallel batch.`);
        }
        const scopeText = scope === 'current' ? 'in the current turn' : 'in this chat';
        throw new SourceFailure('SOURCE_NOT_FOUND', `No completed ${source.tool} call matches nth ${nth} ${scopeText} (found ${settled.length}).`);
    }
    if (entry.status === 'failed') {
        throw new SourceFailure('SOURCE_FAILED', `The matched ${source.tool} call failed: ${entry.error ?? 'unknown error'}`);
    }
    const content = toolContent(entry);
    return [{
        label: `tool ${entry.name} #${nth} (toolCallId ${entry.id}, ${Buffer.byteLength(content, 'utf-8')} bytes)`,
        content,
        meta: { ref, bytes: Buffer.byteLength(content, 'utf-8'), toolCallId: entry.id },
    }];
}

async function resolveLast(count: number, input: ResolveSourcesInput): Promise<ResolvedSection[]> {
    const completed = (await input.ledger.list({ excludeId: input.excludeId, scope: 'any' }))
        .filter(entry => entry.status === 'completed');
    if (completed.length === 0) {
        throw new SourceFailure('SOURCE_NOT_FOUND', 'No completed tool calls in this chat.');
    }
    const picked = completed.slice(-count);
    return picked.map((entry, i) => {
        const content = toolContent(entry);
        const bytes = Buffer.byteLength(content, 'utf-8');
        return {
            label: `tool ${entry.name} (last ${i + 1}/${picked.length}, toolCallId ${entry.id}, ${bytes} bytes)`,
            content,
            meta: { ref: `last:${count}[${i + 1}]`, bytes, toolCallId: entry.id },
        };
    });
}

function isInside(root: string, target: string): boolean {
    const rel = path.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function parseLines(lines: string): { start: number; end: number } {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(lines);
    const start = match ? Number(match[1]) : NaN;
    const end = match?.[2] !== undefined ? Number(match[2]) : start;
    if (!match || start < 1 || end < start) {
        throw new SourceFailure('DECISION_INVALID_REQUEST', `Invalid lines "${lines}". Use "a-b" (1-based, inclusive) or a single line number.`);
    }
    return { start, end };
}

async function resolveFile(source: { file: string; lines?: string }, input: ResolveSourcesInput): Promise<ResolvedSection[]> {
    const range = source.lines !== undefined ? parseLines(source.lines) : undefined;
    const root = path.resolve(input.workspaceRoot);
    const target = path.resolve(root, source.file);
    const outside = new SourceFailure('SOURCE_OUTSIDE_WORKSPACE', `${source.file} is outside the workspace root.`);
    if (!isInside(root, target)) throw outside;

    let realTarget: string;
    try {
        realTarget = await fs.promises.realpath(target);
    } catch {
        throw new SourceFailure('SOURCE_NOT_FOUND', `File not found: ${source.file}`);
    }
    const realRoot = await fs.promises.realpath(root).catch(() => root);
    if (!isInside(realRoot, realTarget)) throw outside;

    const stat = await fs.promises.stat(realTarget);
    if (!stat.isFile()) throw new SourceFailure('SOURCE_UNSUPPORTED', `${source.file} is not a regular file.`);
    if (stat.size > SYSTEM_ONE_LIMITS.maxFileReadBytes) {
        throw new SourceFailure('SOURCE_UNSUPPORTED', `${source.file} is too large to read (${stat.size} bytes).`);
    }
    let content = await fs.promises.readFile(realTarget, 'utf-8');
    if (isBinary(content)) throw new SourceFailure('SOURCE_UNSUPPORTED', `${source.file} is binary.`);
    if (range) {
        content = content.split(/\r?\n/).slice(range.start - 1, range.end).join('\n');
    }
    const ref = range ? `${source.file}:${source.lines}` : source.file;
    return [{ label: `file ${ref}`, content, meta: { ref, bytes: Buffer.byteLength(content, 'utf-8') } }];
}

function resolveText(text: string): ResolvedSection[] {
    const bytes = Buffer.byteLength(text, 'utf-8');
    if (bytes > SYSTEM_ONE_LIMITS.maxTextBytes) {
        throw new SourceFailure('DECISION_INVALID_REQUEST', `Text sources are limited to ${SYSTEM_ONE_LIMITS.maxTextBytes} bytes (got ${bytes}). Point at the tool result or file instead.`);
    }
    return [{ label: 'text', content: text, meta: { ref: 'text', bytes } }];
}

function isObj(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function resolveOne(source: unknown, input: ResolveSourcesInput): Promise<ResolvedSection[]> {
    if (!isObj(source)) throw new SourceFailure('DECISION_INVALID_REQUEST', 'Each source must be an object.');
    if (typeof source.tool === 'string') {
        const { nth, turn } = source;
        if (nth !== undefined && (!Number.isInteger(nth) || nth === 0)) {
            throw new SourceFailure('DECISION_INVALID_REQUEST', '`nth` must be a non-zero integer (-1 = latest, 1 = first).');
        }
        if (turn !== undefined && turn !== 'current' && turn !== 'any') {
            throw new SourceFailure('DECISION_INVALID_REQUEST', '`turn` must be "current" or "any".');
        }
        return resolveToolRef({ tool: source.tool, nth: nth as number | undefined, turn: turn as LedgerScope | undefined }, input);
    }
    if (source.last !== undefined) {
        const last = source.last;
        if (typeof last !== 'number' || !Number.isInteger(last) || last < 1 || last > SYSTEM_ONE_LIMITS.maxLast) {
            throw new SourceFailure('DECISION_INVALID_REQUEST', `\`last\` must be an integer from 1 to ${SYSTEM_ONE_LIMITS.maxLast}.`);
        }
        return resolveLast(last, input);
    }
    if (typeof source.file === 'string') {
        if (source.lines !== undefined && typeof source.lines !== 'string') {
            throw new SourceFailure('DECISION_INVALID_REQUEST', '`lines` must be a string like "10-120".');
        }
        return resolveFile({ file: source.file, lines: source.lines as string | undefined }, input);
    }
    if (typeof source.text === 'string') return resolveText(source.text);
    throw new SourceFailure('DECISION_INVALID_REQUEST', 'Each source needs one of `tool`, `last`, `file`, or `text`.');
}

export async function resolveSources(input: ResolveSourcesInput): Promise<SourceResolution> {
    const { sources } = input;
    if (!Array.isArray(sources) || sources.length === 0 || sources.length > SYSTEM_ONE_LIMITS.maxSources) {
        return { ok: false, error: { error: 'DECISION_INVALID_REQUEST', message: `\`sources\` must list 1 to ${SYSTEM_ONE_LIMITS.maxSources} items.` } };
    }
    const sections: ResolvedSection[] = [];
    for (let i = 0; i < sources.length; i++) {
        try {
            for (const section of await resolveOne(sources[i], input)) {
                const { content, trimmed } = trimToBudget(section.content, SYSTEM_ONE_LIMITS.maxSourceBytes);
                sections.push(trimmed ? { ...section, content, meta: { ...section.meta, trimmed: true } } : section);
            }
        } catch (err) {
            if (err instanceof SourceFailure) return { ok: false, error: { error: err.code, message: err.message, source: i } };
            return { ok: false, error: { error: 'SOURCE_NOT_FOUND', message: err instanceof Error ? err.message : String(err), source: i } };
        }
    }
    return { ok: true, sections };
}

/** Join sections into the decision `state` string, or report `STATE_TOO_LARGE`. */
export function buildSystemOneState(sections: readonly ResolvedSection[]): { ok: true; state: string } | { ok: false; error: SystemOneError } {
    const state = sections.map((s, i) => `### [${i + 1}] ${s.label}\n${s.content}`).join('\n\n');
    const bytes = Buffer.byteLength(state, 'utf-8');
    if (bytes > SYSTEM_ONE_LIMITS.maxStateBytes) {
        return {
            ok: false,
            error: {
                error: 'STATE_TOO_LARGE',
                message: `Resolved sources total ${bytes} bytes; the limit is ${SYSTEM_ONE_LIMITS.maxStateBytes}. Use fewer sources or narrower \`lines\`.`,
            },
        };
    }
    return { ok: true, state };
}
