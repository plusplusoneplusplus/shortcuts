/**
 * Preferences Handler Tests
 *
 * Comprehensive tests for the preferences REST API:
 * - GET /api/preferences — read preferences
 * - PUT /api/preferences — replace preferences
 * - PATCH /api/preferences — merge preferences
 * - File persistence (read/write/validate)
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import {
    readPreferences,
    writePreferences,
    validatePreferences,
    PREFERENCES_FILE_NAME,
} from '../../src/server/preferences-handler';

// ============================================================================
// HTTP Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function getJSON(url: string) {
    return request(url);
}

function putJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Unit Tests — readPreferences / writePreferences / validatePreferences
// ============================================================================

describe('readPreferences / writePreferences', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-prefs-unit-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty object when file does not exist', () => {
        const prefs = readPreferences(tmpDir);
        expect(prefs).toEqual({});
    });

    it('round-trips preferences through write and read', () => {
        const original = { lastModel: 'claude-sonnet-4.6' };
        writePreferences(tmpDir, original);
        const loaded = readPreferences(tmpDir);
        expect(loaded).toEqual(original);
    });

    it('creates data directory if needed', () => {
        const nested = path.join(tmpDir, 'a', 'b');
        writePreferences(nested, { lastModel: 'gpt-5.2' });
        expect(fs.existsSync(path.join(nested, PREFERENCES_FILE_NAME))).toBe(true);
    });

    it('returns empty object when file contains invalid JSON', () => {
        fs.writeFileSync(path.join(tmpDir, PREFERENCES_FILE_NAME), '{{invalid', 'utf-8');
        const prefs = readPreferences(tmpDir);
        expect(prefs).toEqual({});
    });

    it('returns empty object when file contains non-object JSON', () => {
        fs.writeFileSync(path.join(tmpDir, PREFERENCES_FILE_NAME), '"hello"', 'utf-8');
        const prefs = readPreferences(tmpDir);
        expect(prefs).toEqual({});
    });

    it('strips unknown keys during read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ lastModel: 'gpt-5.2', unknownKey: 42 }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs).toEqual({ lastModel: 'gpt-5.2' });
        expect((prefs as any).unknownKey).toBeUndefined();
    });

    it('writes formatted JSON (pretty-printed)', () => {
        writePreferences(tmpDir, { lastModel: 'test' });
        const raw = fs.readFileSync(path.join(tmpDir, PREFERENCES_FILE_NAME), 'utf-8');
        expect(raw).toContain('\n'); // pretty-printed
    });

    it('overwrites existing file', () => {
        writePreferences(tmpDir, { lastModel: 'first' });
        writePreferences(tmpDir, { lastModel: 'second' });
        const prefs = readPreferences(tmpDir);
        expect(prefs.lastModel).toBe('second');
    });

    it('handles empty lastModel string', () => {
        writePreferences(tmpDir, { lastModel: '' });
        const prefs = readPreferences(tmpDir);
        expect(prefs.lastModel).toBe('');
    });

    it('round-trips theme through write and read', () => {
        const original = { lastModel: 'gpt-5.2', theme: 'dark' as const };
        writePreferences(tmpDir, original);
        const loaded = readPreferences(tmpDir);
        expect(loaded).toEqual(original);
    });

    it('strips invalid theme on read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ theme: 'invalid' }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.theme).toBeUndefined();
    });

    it('round-trips recentFollowPrompts through write and read', () => {
        const original = {
            recentFollowPrompts: [
                { type: 'prompt' as const, name: 'review', path: 'review.prompt.md', timestamp: 1000 },
                { type: 'skill' as const, name: 'impl', description: 'Implement', timestamp: 900 },
            ],
        };
        writePreferences(tmpDir, original);
        const loaded = readPreferences(tmpDir);
        expect(loaded).toEqual(original);
    });

    it('strips invalid recentFollowPrompts entries on read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({
                recentFollowPrompts: [
                    { type: 'prompt', name: 'valid', timestamp: 1000 },
                    { type: 'invalid', name: 'bad', timestamp: 900 },
                ],
            }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.recentFollowPrompts!.length).toBe(1);
        expect(prefs.recentFollowPrompts![0].name).toBe('valid');
    });
});

describe('validatePreferences', () => {
    it('returns empty object for null', () => {
        expect(validatePreferences(null)).toEqual({});
    });

    it('returns empty object for non-object', () => {
        expect(validatePreferences('hello')).toEqual({});
        expect(validatePreferences(42)).toEqual({});
        expect(validatePreferences(true)).toEqual({});
    });

    it('returns empty object for empty object', () => {
        expect(validatePreferences({})).toEqual({});
    });

    it('accepts valid lastModel string', () => {
        expect(validatePreferences({ lastModel: 'claude-sonnet-4.6' })).toEqual({ lastModel: 'claude-sonnet-4.6' });
    });

    it('accepts empty lastModel string (means "Default")', () => {
        expect(validatePreferences({ lastModel: '' })).toEqual({ lastModel: '' });
    });

    it('rejects non-string lastModel', () => {
        expect(validatePreferences({ lastModel: 42 })).toEqual({});
        expect(validatePreferences({ lastModel: true })).toEqual({});
        expect(validatePreferences({ lastModel: null })).toEqual({});
    });

    it('strips unknown keys', () => {
        const result = validatePreferences({ lastModel: 'x', bogus: true, extra: 42 });
        expect(result).toEqual({ lastModel: 'x' });
        expect(Object.keys(result)).toEqual(['lastModel']);
    });

    // -- theme field --

    it('accepts valid theme values', () => {
        expect(validatePreferences({ theme: 'dark' })).toEqual({ theme: 'dark' });
        expect(validatePreferences({ theme: 'light' })).toEqual({ theme: 'light' });
        expect(validatePreferences({ theme: 'auto' })).toEqual({ theme: 'auto' });
    });

    it('rejects invalid theme values', () => {
        expect(validatePreferences({ theme: 'blue' })).toEqual({});
        expect(validatePreferences({ theme: 42 })).toEqual({});
        expect(validatePreferences({ theme: true })).toEqual({});
        expect(validatePreferences({ theme: null })).toEqual({});
        expect(validatePreferences({ theme: '' })).toEqual({});
    });

    it('accepts theme alongside lastModel', () => {
        const result = validatePreferences({ lastModel: 'gpt-5.2', theme: 'dark' });
        expect(result).toEqual({ lastModel: 'gpt-5.2', theme: 'dark' });
    });

    // -- recentFollowPrompts field --

    it('accepts valid recentFollowPrompts array', () => {
        const entries = [
            { type: 'prompt', name: 'review', path: 'review.prompt.md', timestamp: 1000 },
            { type: 'skill', name: 'impl', description: 'Implement changes', timestamp: 900 },
        ];
        const result = validatePreferences({ recentFollowPrompts: entries });
        expect(result.recentFollowPrompts).toEqual(entries);
    });

    it('rejects non-array recentFollowPrompts', () => {
        expect(validatePreferences({ recentFollowPrompts: 'not-array' })).toEqual({});
        expect(validatePreferences({ recentFollowPrompts: 42 })).toEqual({});
        expect(validatePreferences({ recentFollowPrompts: {} })).toEqual({});
    });

    it('filters out invalid entries from recentFollowPrompts', () => {
        const entries = [
            { type: 'prompt', name: 'valid', timestamp: 1000 },
            { type: 'invalid', name: 'bad-type', timestamp: 900 },
            { type: 'prompt', name: '', timestamp: 800 },  // empty name
            { type: 'skill', timestamp: 700 },  // missing name
            'not-an-object',
            null,
            { type: 'skill', name: 'also-valid', timestamp: 600 },
        ];
        const result = validatePreferences({ recentFollowPrompts: entries });
        expect(result.recentFollowPrompts).toEqual([
            { type: 'prompt', name: 'valid', timestamp: 1000 },
            { type: 'skill', name: 'also-valid', timestamp: 600 },
        ]);
    });

    it('caps recentFollowPrompts at 10 entries', () => {
        const entries = Array.from({ length: 15 }, (_, i) => ({
            type: 'prompt',
            name: `prompt-${i}`,
            timestamp: 1000 - i,
        }));
        const result = validatePreferences({ recentFollowPrompts: entries });
        expect(result.recentFollowPrompts!.length).toBe(10);
        expect(result.recentFollowPrompts![9].name).toBe('prompt-9');
    });

    it('strips unknown keys from recentFollowPrompts entries', () => {
        const entries = [
            { type: 'prompt', name: 'review', timestamp: 1000, extraKey: 'should-be-stripped' },
        ];
        const result = validatePreferences({ recentFollowPrompts: entries });
        expect(result.recentFollowPrompts).toEqual([
            { type: 'prompt', name: 'review', timestamp: 1000 },
        ]);
        expect((result.recentFollowPrompts![0] as any).extraKey).toBeUndefined();
    });

    it('preserves optional path and description fields', () => {
        const entries = [
            { type: 'prompt', name: 'review', path: 'a/b.prompt.md', timestamp: 1000 },
            { type: 'skill', name: 'impl', description: 'Some description', timestamp: 900 },
        ];
        const result = validatePreferences({ recentFollowPrompts: entries });
        expect(result.recentFollowPrompts![0].path).toBe('a/b.prompt.md');
        expect(result.recentFollowPrompts![1].description).toBe('Some description');
    });

    it('omits recentFollowPrompts when all entries are invalid', () => {
        const entries = [
            { type: 'invalid', name: 'bad', timestamp: 1000 },
            null,
        ];
        const result = validatePreferences({ recentFollowPrompts: entries });
        expect(result.recentFollowPrompts).toBeUndefined();
    });

    it('rejects entries with missing timestamp', () => {
        const entries = [
            { type: 'prompt', name: 'no-timestamp' },
        ];
        const result = validatePreferences({ recentFollowPrompts: entries });
        expect(result.recentFollowPrompts).toBeUndefined();
    });
});

// ============================================================================
// Integration Tests — REST API
// ============================================================================

describe('Preferences REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-prefs-api-'));
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // -- GET /api/preferences --

    it('GET returns empty object initially', async () => {
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({});
    });

    it('GET returns saved preferences', async () => {
        writePreferences(tmpDir, { lastModel: 'gpt-5.2' });
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-5.2' });
    });

    // -- PUT /api/preferences --

    it('PUT replaces preferences and returns result', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'claude-sonnet-4.6' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'claude-sonnet-4.6' });

        // Verify persisted
        const get = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(get.body)).toEqual({ lastModel: 'claude-sonnet-4.6' });
    });

    it('PUT replaces all fields (not merge)', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'model-a' });
        const res = await putJSON(`${baseUrl}/api/preferences`, {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({});

        const get = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(get.body)).toEqual({});
    });

    it('PUT validates input (strips unknown keys)', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, {
            lastModel: 'valid',
            hacker: true,
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ lastModel: 'valid' });
        expect(body.hacker).toBeUndefined();
    });

    it('PUT returns 400 for invalid JSON', async () => {
        const res = await request(`${baseUrl}/api/preferences`, {
            method: 'PUT',
            body: '{{not json',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('PUT handles empty lastModel (resets to Default)', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'some-model' });
        const res = await putJSON(`${baseUrl}/api/preferences`, { lastModel: '' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: '' });
    });

    // -- PATCH /api/preferences --

    it('PATCH merges into existing preferences', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'original' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { lastModel: 'updated' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'updated' });
    });

    it('PATCH creates preferences when none exist', async () => {
        const res = await patchJSON(`${baseUrl}/api/preferences`, { lastModel: 'new-model' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'new-model' });
    });

    it('PATCH with empty body preserves existing preferences', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'keep-me' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'keep-me' });
    });

    it('PATCH returns 400 for invalid JSON', async () => {
        const res = await request(`${baseUrl}/api/preferences`, {
            method: 'PATCH',
            body: 'not-json',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('PATCH strips unknown keys from patch body', async () => {
        const res = await patchJSON(`${baseUrl}/api/preferences`, {
            lastModel: 'valid',
            unknownField: 'ignored',
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ lastModel: 'valid' });
        expect(body.unknownField).toBeUndefined();
    });

    // -- File persistence --

    it('preferences file is created in dataDir after PUT', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'test' });
        const filePath = path.join(tmpDir, PREFERENCES_FILE_NAME);
        expect(fs.existsSync(filePath)).toBe(true);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(content.lastModel).toBe('test');
    });

    it('preferences survive server restart (persisted to disk)', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'persistent' });
        await server.close();

        // Restart with same data dir
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'persistent' });
    });

    // -- CORS --

    it('GET includes CORS headers', async () => {
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    // -- Content-Type --

    it('responses have JSON content type', async () => {
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(res.headers['content-type']).toContain('application/json');
    });

    // -- Theme persistence via API --

    it('PUT persists theme field', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ theme: 'dark' });

        const get = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(get.body)).toEqual({ theme: 'dark' });
    });

    it('PATCH merges theme into existing preferences', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'gpt-5.2' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { theme: 'light' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-5.2', theme: 'light' });
    });

    it('PATCH updates theme without affecting lastModel', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'claude-sonnet-4.6', theme: 'dark' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { theme: 'auto' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'claude-sonnet-4.6', theme: 'auto' });
    });

    it('PUT strips invalid theme values', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { theme: 'blue' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({});
    });

    it('theme survives server restart', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'gpt-5.2', theme: 'dark' });
        await server.close();

        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-5.2', theme: 'dark' });
    });

    // -- recentFollowPrompts persistence via API --

    it('PATCH persists recentFollowPrompts', async () => {
        const entries = [
            { type: 'prompt', name: 'review', path: 'review.prompt.md', timestamp: 1000 },
        ];
        const res = await patchJSON(`${baseUrl}/api/preferences`, { recentFollowPrompts: entries });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.recentFollowPrompts).toEqual(entries);

        const get = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(get.body).recentFollowPrompts).toEqual(entries);
    });

    it('PATCH merges recentFollowPrompts with existing fields', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'gpt-5.2' });
        const entries = [{ type: 'skill', name: 'impl', timestamp: 1000 }];
        const res = await patchJSON(`${baseUrl}/api/preferences`, { recentFollowPrompts: entries });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.lastModel).toBe('gpt-5.2');
        expect(body.recentFollowPrompts).toEqual(entries);
    });

    it('PUT with recentFollowPrompts replaces all', async () => {
        const entries = [{ type: 'prompt', name: 'review', timestamp: 1000 }];
        await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'x', recentFollowPrompts: entries });
        const res = await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'y' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.recentFollowPrompts).toBeUndefined();
    });

    it('recentFollowPrompts survive server restart', async () => {
        const entries = [
            { type: 'prompt', name: 'review', path: 'r.md', timestamp: 1000 },
            { type: 'skill', name: 'impl', description: 'Implement', timestamp: 900 },
        ];
        await putJSON(`${baseUrl}/api/preferences`, { recentFollowPrompts: entries });
        await server.close();

        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).recentFollowPrompts).toEqual(entries);
    });
});
