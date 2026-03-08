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
    validatePerRepoPreferences,
    validateGlobalPreferences,
    PREFERENCES_FILE_NAME,
} from '../../src/server/preferences-handler';
import type { PreferencesFile } from '../../src/server/preferences-handler';

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

    it('round-trips per-repo preferences', () => {
        const data: PreferencesFile = { repos: { 'repo-1': { lastModel: 'claude-sonnet-4.6' } } };
        writePreferences(tmpDir, data);
        const result = readPreferences(tmpDir);
        expect(result.repos?.['repo-1']?.lastModel).toBe('claude-sonnet-4.6');
    });

    it('round-trips global preferences', () => {
        const data: PreferencesFile = { global: { theme: 'dark' } };
        writePreferences(tmpDir, data);
        const result = readPreferences(tmpDir);
        expect(result.global?.theme).toBe('dark');
    });

    it('round-trips full PreferencesFile', () => {
        const data: PreferencesFile = {
            global: { theme: 'dark', reposSidebarCollapsed: true },
            repos: { 'repo-1': { lastModel: 'gpt-4', lastDepth: 'deep' } },
        };
        writePreferences(tmpDir, data);
        const result = readPreferences(tmpDir);
        expect(result.global?.theme).toBe('dark');
        expect(result.global?.reposSidebarCollapsed).toBe(true);
        expect(result.repos?.['repo-1']?.lastModel).toBe('gpt-4');
        expect(result.repos?.['repo-1']?.lastDepth).toBe('deep');
    });

    it('creates data directory if needed', () => {
        const nested = path.join(tmpDir, 'a', 'b');
        writePreferences(nested, { global: { theme: 'auto' } });
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

    it('strips unknown keys in repos during read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ repos: { 'repo-1': { lastModel: 'gpt-5.4', unknownKey: 42 } } }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['repo-1']).toEqual({ lastModel: 'gpt-5.4' });
        expect((prefs.repos?.['repo-1'] as any)?.unknownKey).toBeUndefined();
    });

    it('strips unknown keys in global during read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ global: { theme: 'dark', unknownKey: 42 } }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.global).toEqual({ theme: 'dark' });
        expect((prefs.global as any)?.unknownKey).toBeUndefined();
    });

    it('writes formatted JSON (pretty-printed)', () => {
        writePreferences(tmpDir, { global: { theme: 'dark' } });
        const raw = fs.readFileSync(path.join(tmpDir, PREFERENCES_FILE_NAME), 'utf-8');
        expect(raw).toContain('\n'); // pretty-printed
    });

    it('overwrites existing file', () => {
        writePreferences(tmpDir, { repos: { 'r': { lastModel: 'first' } } });
        writePreferences(tmpDir, { repos: { 'r': { lastModel: 'second' } } });
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['r']?.lastModel).toBe('second');
    });

    it('handles empty lastModel string in repos', () => {
        writePreferences(tmpDir, { repos: { 'r': { lastModel: '' } } });
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['r']?.lastModel).toBe('');
    });

    it('strips invalid theme in global on read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ global: { theme: 'invalid' } }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.global?.theme).toBeUndefined();
    });

    it('round-trips lastDepth through write and read', () => {
        const data: PreferencesFile = { repos: { 'r': { lastDepth: 'deep' } } };
        writePreferences(tmpDir, data);
        const loaded = readPreferences(tmpDir);
        expect(loaded.repos?.['r']?.lastDepth).toBe('deep');
    });

    it('round-trips lastDepth normal through write and read', () => {
        const data: PreferencesFile = { repos: { 'r': { lastModel: 'gpt-5.4', lastDepth: 'normal' } } };
        writePreferences(tmpDir, data);
        const loaded = readPreferences(tmpDir);
        expect(loaded.repos?.['r']?.lastDepth).toBe('normal');
    });

    it('strips invalid lastDepth in repos on read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ repos: { 'r': { lastDepth: 'shallow' } } }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['r']?.lastDepth).toBeUndefined();
    });

    it('round-trips lastEffort through write and read', () => {
        for (const level of ['low', 'medium', 'high'] as const) {
            const data: PreferencesFile = { repos: { 'r': { lastEffort: level } } };
            writePreferences(tmpDir, data);
            const loaded = readPreferences(tmpDir);
            expect(loaded.repos?.['r']?.lastEffort).toBe(level);
        }
    });

    it('strips invalid lastEffort in repos on read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ repos: { 'r': { lastEffort: 'extreme' } } }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['r']?.lastEffort).toBeUndefined();
    });

    it('round-trips lastSkills through write and read', () => {
        const data: PreferencesFile = { repos: { 'r': { lastSkills: { task: 'impl', ask: 'go-deep' } } } };
        writePreferences(tmpDir, data);
        const loaded = readPreferences(tmpDir);
        expect(loaded.repos?.['r']?.lastSkills).toEqual({ task: 'impl', ask: 'go-deep' });
    });

    it('round-trips lastSkills with all three modes', () => {
        const data: PreferencesFile = { repos: { 'r': { lastSkills: { task: 'impl', ask: 'go-deep', plan: 'speckit' } } } };
        writePreferences(tmpDir, data);
        const loaded = readPreferences(tmpDir);
        expect(loaded.repos?.['r']?.lastSkills).toEqual({ task: 'impl', ask: 'go-deep', plan: 'speckit' });
    });

    it('handles lastSkills with empty string values', () => {
        writePreferences(tmpDir, { repos: { 'r': { lastSkills: { task: '' } } } });
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['r']?.lastSkills).toEqual({ task: '' });
    });

    it('round-trips recentFollowPrompts through write and read', () => {
        const entries = [
            { type: 'prompt' as const, name: 'review', path: 'review.prompt.md', timestamp: 1000 },
            { type: 'skill' as const, name: 'impl', description: 'Implement', timestamp: 900 },
        ];
        writePreferences(tmpDir, { repos: { 'r': { recentFollowPrompts: entries } } });
        const loaded = readPreferences(tmpDir);
        expect(loaded.repos?.['r']?.recentFollowPrompts).toEqual(entries);
    });

    it('strips invalid recentFollowPrompts entries on read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({
                repos: { 'r': {
                    recentFollowPrompts: [
                        { type: 'prompt', name: 'valid', timestamp: 1000 },
                        { type: 'invalid', name: 'bad', timestamp: 900 },
                    ],
                } },
            }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['r']?.recentFollowPrompts!.length).toBe(1);
        expect(prefs.repos?.['r']?.recentFollowPrompts![0].name).toBe('valid');
    });

    it('round-trips pinnedChats through write and read', () => {
        const data: PreferencesFile = { repos: { 'r': { pinnedChats: { ws1: ['id-a', 'id-b'], ws2: ['id-c'] } } } };
        writePreferences(tmpDir, data);
        const loaded = readPreferences(tmpDir);
        expect(loaded.repos?.['r']?.pinnedChats).toEqual({ ws1: ['id-a', 'id-b'], ws2: ['id-c'] });
    });

    it('strips invalid pinnedChats entries on read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ repos: { 'r': { pinnedChats: { ws1: ['valid', 42, ''], ws2: [null] } } } }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['r']?.pinnedChats).toEqual({ ws1: ['valid'] });
    });

    it('round-trips archivedChats through write and read', () => {
        const data: PreferencesFile = { repos: { 'r': { archivedChats: { ws1: ['id-a', 'id-b'], ws2: ['id-c'] } } } };
        writePreferences(tmpDir, data);
        const loaded = readPreferences(tmpDir);
        expect(loaded.repos?.['r']?.archivedChats).toEqual({ ws1: ['id-a', 'id-b'], ws2: ['id-c'] });
    });

    it('strips invalid archivedChats entries on read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({ repos: { 'r': { archivedChats: { ws1: ['valid', 42, ''], ws2: [null] } } } }),
            'utf-8'
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.repos?.['r']?.archivedChats).toEqual({ ws1: ['valid'] });
    });

    it('multiple repos are stored independently', () => {
        const data: PreferencesFile = {
            repos: {
                'repo-a': { lastModel: 'gpt-4' },
                'repo-b': { lastModel: 'claude-3' },
            },
        };
        writePreferences(tmpDir, data);
        const loaded = readPreferences(tmpDir);
        expect(loaded.repos?.['repo-a']?.lastModel).toBe('gpt-4');
        expect(loaded.repos?.['repo-b']?.lastModel).toBe('claude-3');
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
    // (theme is a GlobalPreferences field; validatePreferences/validatePerRepoPreferences
    //  intentionally drops it — tested in validateGlobalPreferences below)

    it('does not include theme (per-repo field only)', () => {
        expect(validatePreferences({ theme: 'dark' })).toEqual({});
        expect(validatePreferences({ lastModel: 'x', theme: 'dark' })).toEqual({ lastModel: 'x' });
    });

    // -- lastDepth field --

    it('accepts valid lastDepth values', () => {
        expect(validatePreferences({ lastDepth: 'deep' })).toEqual({ lastDepth: 'deep' });
        expect(validatePreferences({ lastDepth: 'normal' })).toEqual({ lastDepth: 'normal' });
    });

    it('rejects invalid lastDepth values', () => {
        expect(validatePreferences({ lastDepth: 'shallow' })).toEqual({});
        expect(validatePreferences({ lastDepth: 42 })).toEqual({});
        expect(validatePreferences({ lastDepth: true })).toEqual({});
        expect(validatePreferences({ lastDepth: null })).toEqual({});
        expect(validatePreferences({ lastDepth: '' })).toEqual({});
    });

    it('accepts lastDepth alongside lastModel', () => {
        const result = validatePreferences({ lastModel: 'gpt-5.4', lastDepth: 'deep' });
        expect(result).toEqual({ lastModel: 'gpt-5.4', lastDepth: 'deep' });
    });

    // -- lastEffort field --

    it('accepts valid lastEffort values', () => {
        expect(validatePreferences({ lastEffort: 'low' })).toEqual({ lastEffort: 'low' });
        expect(validatePreferences({ lastEffort: 'medium' })).toEqual({ lastEffort: 'medium' });
        expect(validatePreferences({ lastEffort: 'high' })).toEqual({ lastEffort: 'high' });
    });

    it('rejects invalid lastEffort values', () => {
        expect(validatePreferences({ lastEffort: 'extreme' })).toEqual({});
        expect(validatePreferences({ lastEffort: 42 })).toEqual({});
        expect(validatePreferences({ lastEffort: true })).toEqual({});
        expect(validatePreferences({ lastEffort: null })).toEqual({});
        expect(validatePreferences({ lastEffort: '' })).toEqual({});
    });

    it('accepts lastEffort alongside other fields', () => {
        const result = validatePreferences({ lastModel: 'gpt-5.4', lastEffort: 'high', lastDepth: 'deep' });
        expect(result).toEqual({ lastModel: 'gpt-5.4', lastDepth: 'deep', lastEffort: 'high' });
    });

    // -- lastSkills field --

    it('accepts valid lastSkills object with task mode', () => {
        expect(validatePreferences({ lastSkills: { task: 'impl' } })).toEqual({ lastSkills: { task: 'impl' } });
    });

    it('accepts valid lastSkills object with all three modes', () => {
        const skills = { task: 'impl', ask: 'go-deep', plan: 'speckit' };
        expect(validatePreferences({ lastSkills: skills })).toEqual({ lastSkills: skills });
    });

    it('accepts lastSkills with empty string values', () => {
        expect(validatePreferences({ lastSkills: { task: '' } })).toEqual({ lastSkills: { task: '' } });
    });

    it('drops unknown mode keys from lastSkills', () => {
        expect(validatePreferences({ lastSkills: { unknown: 'x' } })).toEqual({});
    });

    it('rejects non-object lastSkills', () => {
        expect(validatePreferences({ lastSkills: 'impl' })).toEqual({});
        expect(validatePreferences({ lastSkills: 42 })).toEqual({});
        expect(validatePreferences({ lastSkills: true })).toEqual({});
        expect(validatePreferences({ lastSkills: null })).toEqual({});
        expect(validatePreferences({ lastSkills: ['impl'] })).toEqual({});
    });

    it('rejects non-string values within lastSkills', () => {
        expect(validatePreferences({ lastSkills: { task: 42 } })).toEqual({});
        expect(validatePreferences({ lastSkills: { ask: true } })).toEqual({});
    });

    it('accepts lastSkills alongside other fields', () => {
        const result = validatePreferences({ lastModel: 'gpt-5.4', lastSkills: { task: 'go-deep' } });
        expect(result).toEqual({ lastModel: 'gpt-5.4', lastSkills: { task: 'go-deep' } });
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

    // -- pinnedChats field --

    it('accepts valid pinnedChats record', () => {
        const result = validatePreferences({ pinnedChats: { ws1: ['a', 'b'], ws2: ['c'] } });
        expect(result.pinnedChats).toEqual({ ws1: ['a', 'b'], ws2: ['c'] });
    });

    it('rejects non-object pinnedChats', () => {
        expect(validatePreferences({ pinnedChats: 'not-object' })).toEqual({});
        expect(validatePreferences({ pinnedChats: 42 })).toEqual({});
        expect(validatePreferences({ pinnedChats: null })).toEqual({});
        expect(validatePreferences({ pinnedChats: true })).toEqual({});
    });

    it('rejects array pinnedChats', () => {
        expect(validatePreferences({ pinnedChats: ['a', 'b'] })).toEqual({});
    });

    it('filters out non-string IDs from pinnedChats arrays', () => {
        const result = validatePreferences({ pinnedChats: { ws1: ['valid', 42, '', null, 'also-valid'] } });
        expect(result.pinnedChats).toEqual({ ws1: ['valid', 'also-valid'] });
    });

    it('omits workspace keys with empty arrays after filtering', () => {
        const result = validatePreferences({ pinnedChats: { ws1: ['valid'], ws2: [42, ''] } });
        expect(result.pinnedChats).toEqual({ ws1: ['valid'] });
    });

    it('omits pinnedChats when all workspaces empty after filtering', () => {
        const result = validatePreferences({ pinnedChats: { ws1: [42], ws2: [''] } });
        expect(result.pinnedChats).toBeUndefined();
    });

    it('omits pinnedChats when empty object', () => {
        const result = validatePreferences({ pinnedChats: {} });
        expect(result.pinnedChats).toBeUndefined();
    });

    it('accepts pinnedChats alongside other fields', () => {
        const result = validatePreferences({ lastModel: 'gpt-5.4', pinnedChats: { ws1: ['id1'] } });
        expect(result).toEqual({ lastModel: 'gpt-5.4', pinnedChats: { ws1: ['id1'] } });
    });

    // -- archivedChats field --

    it('accepts valid archivedChats record', () => {
        const result = validatePreferences({ archivedChats: { ws1: ['a', 'b'], ws2: ['c'] } });
        expect(result.archivedChats).toEqual({ ws1: ['a', 'b'], ws2: ['c'] });
    });

    it('rejects non-object archivedChats', () => {
        expect(validatePreferences({ archivedChats: 'not-object' })).toEqual({});
        expect(validatePreferences({ archivedChats: 42 })).toEqual({});
        expect(validatePreferences({ archivedChats: null })).toEqual({});
        expect(validatePreferences({ archivedChats: true })).toEqual({});
    });

    it('rejects array archivedChats', () => {
        expect(validatePreferences({ archivedChats: ['a', 'b'] })).toEqual({});
    });

    it('filters out non-string IDs from archivedChats arrays', () => {
        const result = validatePreferences({ archivedChats: { ws1: ['valid', 42, '', null, 'also-valid'] } });
        expect(result.archivedChats).toEqual({ ws1: ['valid', 'also-valid'] });
    });

    it('omits archivedChats when empty object', () => {
        const result = validatePreferences({ archivedChats: {} });
        expect(result.archivedChats).toBeUndefined();
    });

    it('accepts archivedChats alongside pinnedChats', () => {
        const result = validatePreferences({ pinnedChats: { ws1: ['p1'] }, archivedChats: { ws1: ['a1'] } });
        expect(result).toEqual({ pinnedChats: { ws1: ['p1'] }, archivedChats: { ws1: ['a1'] } });
    });
});

// ============================================================================
// Unit Tests — validateGlobalPreferences
// ============================================================================

describe('validateGlobalPreferences', () => {
    it('returns empty object for null', () => {
        expect(validateGlobalPreferences(null)).toEqual({});
    });

    it('returns empty object for non-object', () => {
        expect(validateGlobalPreferences('hello')).toEqual({});
        expect(validateGlobalPreferences(42)).toEqual({});
    });

    it('returns empty object for empty object', () => {
        expect(validateGlobalPreferences({})).toEqual({});
    });

    it('accepts valid theme values', () => {
        expect(validateGlobalPreferences({ theme: 'dark' })).toEqual({ theme: 'dark' });
        expect(validateGlobalPreferences({ theme: 'light' })).toEqual({ theme: 'light' });
        expect(validateGlobalPreferences({ theme: 'auto' })).toEqual({ theme: 'auto' });
    });

    it('rejects invalid theme values', () => {
        expect(validateGlobalPreferences({ theme: 'blue' })).toEqual({});
        expect(validateGlobalPreferences({ theme: 42 })).toEqual({});
        expect(validateGlobalPreferences({ theme: null })).toEqual({});
        expect(validateGlobalPreferences({ theme: '' })).toEqual({});
    });

    it('accepts reposSidebarCollapsed boolean', () => {
        expect(validateGlobalPreferences({ reposSidebarCollapsed: true })).toEqual({ reposSidebarCollapsed: true });
        expect(validateGlobalPreferences({ reposSidebarCollapsed: false })).toEqual({ reposSidebarCollapsed: false });
    });

    it('rejects non-boolean reposSidebarCollapsed', () => {
        expect(validateGlobalPreferences({ reposSidebarCollapsed: 'true' })).toEqual({});
        expect(validateGlobalPreferences({ reposSidebarCollapsed: 1 })).toEqual({});
        expect(validateGlobalPreferences({ reposSidebarCollapsed: null })).toEqual({});
    });

    it('accepts theme alongside reposSidebarCollapsed', () => {
        const result = validateGlobalPreferences({ theme: 'dark', reposSidebarCollapsed: true });
        expect(result).toEqual({ theme: 'dark', reposSidebarCollapsed: true });
    });

    it('strips unknown keys', () => {
        const result = validateGlobalPreferences({ theme: 'dark', lastModel: 'gpt-4', bogus: true });
        expect(result).toEqual({ theme: 'dark' });
        expect(Object.keys(result)).toEqual(['theme']);
    });

    // -- gitGroupOrder field --

    it('accepts valid gitGroupOrder array of strings', () => {
        const result = validateGlobalPreferences({ gitGroupOrder: ['github.com/a/b', 'workspace:ws-1'] });
        expect(result).toEqual({ gitGroupOrder: ['github.com/a/b', 'workspace:ws-1'] });
    });

    it('rejects non-array gitGroupOrder', () => {
        expect(validateGlobalPreferences({ gitGroupOrder: 'not-array' })).toEqual({});
        expect(validateGlobalPreferences({ gitGroupOrder: 42 })).toEqual({});
        expect(validateGlobalPreferences({ gitGroupOrder: {} })).toEqual({});
    });

    it('filters out non-string and empty entries from gitGroupOrder', () => {
        const result = validateGlobalPreferences({ gitGroupOrder: ['valid', 42, '', null, 'also-valid'] });
        expect(result.gitGroupOrder).toEqual(['valid', 'also-valid']);
    });

    it('omits gitGroupOrder when all entries are invalid', () => {
        const result = validateGlobalPreferences({ gitGroupOrder: [42, null, ''] });
        expect(result.gitGroupOrder).toBeUndefined();
    });

    it('accepts gitGroupOrder alongside theme', () => {
        const result = validateGlobalPreferences({ theme: 'dark', gitGroupOrder: ['github.com/a'] });
        expect(result).toEqual({ theme: 'dark', gitGroupOrder: ['github.com/a'] });
    });
});

// ============================================================================
// Integration Tests — REST API (Global Preferences)
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

    it('GET returns saved global preferences', async () => {
        writePreferences(tmpDir, { global: { theme: 'dark' } });
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ theme: 'dark' });
    });

    it('GET does not return per-repo preferences', async () => {
        writePreferences(tmpDir, { repos: { 'r': { lastModel: 'gpt-4' } } });
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({});
    });

    // -- PUT /api/preferences --

    it('PUT replaces global preferences and returns result', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ theme: 'dark' });

        const get = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(get.body)).toEqual({ theme: 'dark' });
    });

    it('PUT replaces all global fields (not merge)', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark', reposSidebarCollapsed: true });
        const res = await putJSON(`${baseUrl}/api/preferences`, { theme: 'light' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ theme: 'light' });
        expect(JSON.parse(res.body).reposSidebarCollapsed).toBeUndefined();
    });

    it('PUT validates input (strips unknown keys)', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, {
            theme: 'dark',
            hacker: true,
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ theme: 'dark' });
        expect(body.hacker).toBeUndefined();
    });

    it('PUT strips per-repo fields (lastModel is not global)', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { lastModel: 'gpt-4' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({});
    });

    it('PUT returns 400 for invalid JSON', async () => {
        const res = await request(`${baseUrl}/api/preferences`, {
            method: 'PUT',
            body: '{{not json',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('PUT does not overwrite existing per-repo prefs', async () => {
        writePreferences(tmpDir, { repos: { 'r': { lastModel: 'gpt-4' } } });
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const file = readPreferences(tmpDir);
        expect(file.repos?.['r']?.lastModel).toBe('gpt-4');
    });

    // -- PATCH /api/preferences --

    it('PATCH merges into existing global preferences', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { reposSidebarCollapsed: true });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ theme: 'dark', reposSidebarCollapsed: true });
    });

    it('PATCH creates global preferences when none exist', async () => {
        const res = await patchJSON(`${baseUrl}/api/preferences`, { theme: 'auto' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ theme: 'auto' });
    });

    it('PATCH with empty body preserves existing global preferences', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ theme: 'dark' });
    });

    it('PATCH returns 400 for invalid JSON', async () => {
        const res = await request(`${baseUrl}/api/preferences`, {
            method: 'PATCH',
            body: 'not-json',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('PATCH strips unknown and per-repo keys', async () => {
        const res = await patchJSON(`${baseUrl}/api/preferences`, {
            theme: 'dark',
            lastModel: 'gpt-4',
            unknownField: 'ignored',
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ theme: 'dark' });
        expect(body.lastModel).toBeUndefined();
        expect(body.unknownField).toBeUndefined();
    });

    // -- File persistence --

    it('preferences file is created in dataDir after PUT', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const filePath = path.join(tmpDir, PREFERENCES_FILE_NAME);
        expect(fs.existsSync(filePath)).toBe(true);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(content.global.theme).toBe('dark');
    });

    it('global preferences survive server restart', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        await server.close();

        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body)).toEqual({ theme: 'dark' });
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

    it('PATCH merges theme into existing global preferences', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { reposSidebarCollapsed: true });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { theme: 'light' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ reposSidebarCollapsed: true, theme: 'light' });
    });

    it('PATCH updates theme without affecting reposSidebarCollapsed', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { reposSidebarCollapsed: true, theme: 'dark' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { theme: 'auto' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ reposSidebarCollapsed: true, theme: 'auto' });
    });

    it('PUT strips invalid theme values', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { theme: 'blue' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({});
    });

    it('theme survives server restart', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        await server.close();

        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body)).toEqual({ theme: 'dark' });
    });

    // -- reposSidebarCollapsed persistence via API --

    it('PUT persists reposSidebarCollapsed field', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { reposSidebarCollapsed: true });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ reposSidebarCollapsed: true });

        const get = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(get.body)).toEqual({ reposSidebarCollapsed: true });
    });

    it('PATCH updates reposSidebarCollapsed without affecting theme', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark', reposSidebarCollapsed: false });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { reposSidebarCollapsed: true });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ theme: 'dark', reposSidebarCollapsed: true });
    });

    // -- gitGroupOrder persistence via API --

    it('PATCH persists gitGroupOrder', async () => {
        const order = ['github.com/user/repo', 'workspace:ws-abc'];
        const res = await patchJSON(`${baseUrl}/api/preferences`, { gitGroupOrder: order });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).gitGroupOrder).toEqual(order);
    });

    it('GET returns persisted gitGroupOrder', async () => {
        const order = ['github.com/a', 'github.com/b'];
        await patchJSON(`${baseUrl}/api/preferences`, { gitGroupOrder: order });
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).gitGroupOrder).toEqual(order);
    });

    it('PATCH updates gitGroupOrder without affecting other global prefs', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const order = ['github.com/c'];
        const res = await patchJSON(`${baseUrl}/api/preferences`, { gitGroupOrder: order });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.theme).toBe('dark');
        expect(body.gitGroupOrder).toEqual(order);
    });

    it('gitGroupOrder survives server restart', async () => {
        const order = ['github.com/x/y'];
        await patchJSON(`${baseUrl}/api/preferences`, { gitGroupOrder: order });
        await server.close();

        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).gitGroupOrder).toEqual(order);
    });
});

// ============================================================================
// Integration Tests — Per-Repo Preferences REST API
// ============================================================================

describe('Per-Repo Preferences REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-repo-prefs-'));
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const repoId = encodeURIComponent('/home/user/my-project');
    const repoId2 = encodeURIComponent('/home/user/other-project');

    function repoUrl(id: string) {
        return `${baseUrl}/api/workspaces/${id}/preferences`;
    }

    // -- GET --

    it('GET returns empty object initially', async () => {
        const res = await getJSON(repoUrl(repoId));
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({});
    });

    it('GET includes CORS headers', async () => {
        const res = await getJSON(repoUrl(repoId));
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    // -- PUT --

    it('PUT replaces per-repo prefs and returns result', async () => {
        const res = await putJSON(repoUrl(repoId), { lastModel: 'gpt-4', lastDepth: 'deep' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-4', lastDepth: 'deep' });

        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body)).toEqual({ lastModel: 'gpt-4', lastDepth: 'deep' });
    });

    it('PUT validates and strips unknown/global fields', async () => {
        const res = await putJSON(repoUrl(repoId), { lastModel: 'gpt-4', theme: 'dark', bogus: true });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ lastModel: 'gpt-4' });
        expect(body.theme).toBeUndefined();
    });

    it('PUT returns 400 for invalid JSON', async () => {
        const res = await request(repoUrl(repoId), {
            method: 'PUT',
            body: '{{bad',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('PUT replaces all fields (not merge)', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4', lastDepth: 'deep' });
        const res = await putJSON(repoUrl(repoId), { lastModel: 'claude-3' });
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'claude-3' });
        expect(JSON.parse(res.body).lastDepth).toBeUndefined();
    });

    // -- PATCH --

    it('PATCH merges per-repo prefs', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4' });
        const res = await patchJSON(repoUrl(repoId), { lastDepth: 'deep' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-4', lastDepth: 'deep' });
    });

    it('PATCH creates prefs when none exist', async () => {
        const res = await patchJSON(repoUrl(repoId), { lastModel: 'gpt-4' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-4' });
    });

    it('PATCH returns 400 for invalid JSON', async () => {
        const res = await request(repoUrl(repoId), {
            method: 'PATCH',
            body: 'bad-json',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
    });

    it('PATCH with empty body preserves existing prefs', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4' });
        const res = await patchJSON(repoUrl(repoId), {});
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-4' });
    });

    // -- Isolation --

    it('two repos have independent preferences', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4' });
        await putJSON(repoUrl(repoId2), { lastModel: 'claude-3' });

        const res1 = await getJSON(repoUrl(repoId));
        const res2 = await getJSON(repoUrl(repoId2));
        expect(JSON.parse(res1.body).lastModel).toBe('gpt-4');
        expect(JSON.parse(res2.body).lastModel).toBe('claude-3');
    });

    it('global and per-repo prefs are stored independently', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4' });

        const globalRes = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(globalRes.body)).toEqual({ theme: 'dark' });
        expect(JSON.parse(globalRes.body).lastModel).toBeUndefined();

        const repoRes = await getJSON(repoUrl(repoId));
        expect(JSON.parse(repoRes.body)).toEqual({ lastModel: 'gpt-4' });
        expect(JSON.parse(repoRes.body).theme).toBeUndefined();
    });

    // -- Persistence --

    it('per-repo prefs survive server restart', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4', lastDepth: 'deep' });
        await server.close();

        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(repoUrl(repoId));
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-4', lastDepth: 'deep' });
    });

    // -- pinnedChats --

    it('PATCH persists pinnedChats', async () => {
        const pinnedChats = { ws1: ['id-a', 'id-b'] };
        const res = await patchJSON(repoUrl(repoId), { pinnedChats });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).pinnedChats).toEqual(pinnedChats);

        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).pinnedChats).toEqual(pinnedChats);
    });

    it('PATCH with pinnedChats:{} clears existing pins', async () => {
        await patchJSON(repoUrl(repoId), { pinnedChats: { ws1: ['id-a'] } });

        const res = await patchJSON(repoUrl(repoId), { pinnedChats: {} });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).pinnedChats).toBeUndefined();

        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).pinnedChats).toBeUndefined();
    });

    it('PATCH with pinnedChats:{} does not affect other fields', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4', pinnedChats: { ws1: ['id-a'] } });
        const res = await patchJSON(repoUrl(repoId), { pinnedChats: {} });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.lastModel).toBe('gpt-4');
        expect(body.pinnedChats).toBeUndefined();
    });

    // -- archivedChats --

    it('PATCH persists archivedChats', async () => {
        const archivedChats = { ws1: ['id-a', 'id-b'] };
        const res = await patchJSON(repoUrl(repoId), { archivedChats });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).archivedChats).toEqual(archivedChats);

        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).archivedChats).toEqual(archivedChats);
    });

    it('PATCH with archivedChats:{} clears existing archives', async () => {
        await patchJSON(repoUrl(repoId), { archivedChats: { ws1: ['id-a'] } });

        const res = await patchJSON(repoUrl(repoId), { archivedChats: {} });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).archivedChats).toBeUndefined();

        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).archivedChats).toBeUndefined();
    });

    it('PATCH with archivedChats:{} does not affect other fields', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4', archivedChats: { ws1: ['id-a'] } });
        const res = await patchJSON(repoUrl(repoId), { archivedChats: {} });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.lastModel).toBe('gpt-4');
        expect(body.archivedChats).toBeUndefined();
    });

    // -- lastModel/lastDepth/lastEffort/lastSkill persistence --

    it('PUT persists lastModel', async () => {
        const res = await putJSON(repoUrl(repoId), { lastModel: 'claude-sonnet-4.6' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'claude-sonnet-4.6' });
    });

    it('PATCH persists lastDepth', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4' });
        const res = await patchJSON(repoUrl(repoId), { lastDepth: 'deep' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-4', lastDepth: 'deep' });
    });

    it('PATCH persists lastEffort', async () => {
        const res = await patchJSON(repoUrl(repoId), { lastEffort: 'high' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastEffort: 'high' });
    });

    it('PATCH persists lastSkills with single mode', async () => {
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { task: 'impl' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastSkills: { task: 'impl' } });
    });

    it('PATCH merges lastSkills modes incrementally', async () => {
        await patchJSON(repoUrl(repoId), { lastSkills: { task: 'impl' } });
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { ask: 'go-deep' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastSkills: { task: 'impl', ask: 'go-deep' } });
    });

    it('PATCH persists recentFollowPrompts', async () => {
        const entries = [{ type: 'prompt', name: 'review', path: 'r.md', timestamp: 1000 }];
        const res = await patchJSON(repoUrl(repoId), { recentFollowPrompts: entries });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).recentFollowPrompts).toEqual(entries);
    });
});
