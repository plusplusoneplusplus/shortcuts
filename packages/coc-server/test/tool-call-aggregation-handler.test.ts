/**
 * Tests for tool-call-aggregation-handler — unit tests using MockResponse.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleAggregateToolCalls } from '../src/memory/tool-call-aggregation-handler';
import { writeMemoryConfig, DEFAULT_MEMORY_CONFIG } from '../src/memory/memory-config-handler';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';

// ── MockResponse helper ───────────────────────────────────────────────────────

interface MockResponseState {
    statusCode: number;
    body: string;
}

function makeMockResponse(): { res: http.ServerResponse; state: MockResponseState } {
    const state: MockResponseState = { statusCode: 200, body: '' };
    const res = {
        writeHead(code: number) { state.statusCode = code; },
        write(chunk: string) { state.body += chunk; },
        end(chunk?: string) { if (chunk) { state.body += chunk; } },
        setHeader() {},
        getHeader() { return undefined; },
    } as unknown as http.ServerResponse;
    return { res, state };
}

function parseBody(state: MockResponseState): unknown {
    return JSON.parse(state.body);
}

// ── Raw entry helper ──────────────────────────────────────────────────────────

function writeRawFile(rawDir: string, index: number): void {
    fs.mkdirSync(rawDir, { recursive: true });
    const entry = {
        id: `entry-${index}`,
        toolName: 'grep',
        question: `Find pattern ${index}`,
        answer: `Result ${index}`,
        args: { pattern: `pattern-${index}` },
        timestamp: new Date(Date.now() + index * 1000).toISOString(),
    };
    fs.writeFileSync(
        path.join(rawDir, `${Date.now() + index}-grep.json`),
        JSON.stringify(entry, null, 2),
        'utf-8',
    );
}

// ── Consolidated JSON helper ──────────────────────────────────────────────────

function makeConsolidatedJson(count: number): string {
    const entries = Array.from({ length: count }, (_, i) => ({
        id: `consolidated-${i}`,
        question: `What is ${i}?`,
        answer: `Answer ${i}`,
        topics: ['test'],
        toolSources: ['grep'],
        createdAt: new Date().toISOString(),
        hitCount: 1,
    }));
    return JSON.stringify(entries);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agg-handler-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('handleAggregateToolCalls — 503 when no aiInvoker', () => {
    it('returns 503 with error message', async () => {
        const { res, state } = makeMockResponse();
        const req = {} as http.IncomingMessage;
        await handleAggregateToolCalls(req, res, tmpDir, undefined);
        expect(state.statusCode).toBe(503);
        expect(parseBody(state)).toEqual({ error: 'AI invoker not configured' });
    });
});

describe('handleAggregateToolCalls — 200 aggregated: false when no raw entries', () => {
    it('returns aggregated: false and does not call aiInvoker', async () => {
        // Set storageDir to a fresh directory with no raw files
        const storageDir = path.join(tmpDir, 'storage');
        fs.mkdirSync(storageDir, { recursive: true });
        writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir });

        const mockInvoker: AIInvoker = vi.fn();

        const { res, state } = makeMockResponse();
        const req = {} as http.IncomingMessage;
        await handleAggregateToolCalls(req, res, tmpDir, mockInvoker);

        expect(state.statusCode).toBe(200);
        expect(parseBody(state)).toEqual({ aggregated: false, reason: 'no raw entries' });
        expect(mockInvoker).not.toHaveBeenCalled();
    });
});

describe('handleAggregateToolCalls — 200 aggregated: true with correct counts', () => {
    it('aggregates N raw files and returns rawCount/consolidatedCount', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir });

        // Write 3 raw files into explore-cache/raw/
        const rawDir = path.join(storageDir, 'explore-cache', 'raw');
        const N = 3;
        for (let i = 0; i < N; i++) {
            writeRawFile(rawDir, i);
        }

        // Mock invoker returns 2 consolidated entries
        const consolidatedJson = makeConsolidatedJson(2);
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: consolidatedJson,
        });

        const { res, state } = makeMockResponse();
        const req = {} as http.IncomingMessage;
        await handleAggregateToolCalls(req, res, tmpDir, mockInvoker);

        expect(state.statusCode).toBe(200);
        const body = parseBody(state) as any;
        expect(body.aggregated).toBe(true);
        expect(body.rawCount).toBe(N);
        expect(body.consolidatedCount).toBe(2);

        // Raw dir should be empty
        const remaining = fs.readdirSync(rawDir).filter(f => f.endsWith('.json'));
        expect(remaining).toHaveLength(0);

        // consolidated/index.json should exist
        const consolidatedIndexPath = path.join(storageDir, 'explore-cache', 'consolidated', 'index.json');
        expect(fs.existsSync(consolidatedIndexPath)).toBe(true);
    });
});

describe('handleAggregateToolCalls — 500 on aiInvoker error', () => {
    it('returns 500 and raw files are NOT deleted', async () => {
        const storageDir = path.join(tmpDir, 'storage');
        writeMemoryConfig(tmpDir, { ...DEFAULT_MEMORY_CONFIG, storageDir });

        const rawDir = path.join(storageDir, 'explore-cache', 'raw');
        const N = 2;
        for (let i = 0; i < N; i++) {
            writeRawFile(rawDir, i);
        }

        // Mock invoker returns failure
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: false,
            error: 'timeout',
            response: '',
        });

        const { res, state } = makeMockResponse();
        const req = {} as http.IncomingMessage;
        await handleAggregateToolCalls(req, res, tmpDir, mockInvoker);

        expect(state.statusCode).toBe(500);
        const body = parseBody(state) as any;
        expect(typeof body.error).toBe('string');

        // Raw files should still exist (safety invariant: aggregate throws before delete)
        const remaining = fs.readdirSync(rawDir).filter(f => f.endsWith('.json'));
        expect(remaining).toHaveLength(N);
    });
});
