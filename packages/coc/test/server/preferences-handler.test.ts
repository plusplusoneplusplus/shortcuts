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
    readRepoPreferences,
    writeRepoPreferences,
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
        writeRepoPreferences(tmpDir, 'repo-1', { lastModel: 'claude-sonnet-4.6' });
        const result = readRepoPreferences(tmpDir, 'repo-1');
        expect(result.lastModel).toBe('claude-sonnet-4.6');
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
        };
        writePreferences(tmpDir, data);
        const result = readPreferences(tmpDir);
        expect(result.global?.theme).toBe('dark');
        expect(result.global?.reposSidebarCollapsed).toBe(true);

        writeRepoPreferences(tmpDir, 'repo-1', { lastModel: 'gpt-4', lastDepth: 'deep' });
        const repoResult = readRepoPreferences(tmpDir, 'repo-1');
        expect(repoResult.lastModel).toBe('gpt-4');
        expect(repoResult.lastDepth).toBe('deep');
    });

    it('round-trips hasSeenWelcome', () => {
        writePreferences(tmpDir, { global: { hasSeenWelcome: true } });
        const result = readPreferences(tmpDir);
        expect(result.global?.hasSeenWelcome).toBe(true);
    });

    it('round-trips onboardingProgress', () => {
        const progress = { hasUsedChat: true, hasRunWorkflow: false, hasOpenedWiki: true, settingsVisited: false, dismissed: false };
        writePreferences(tmpDir, { global: { onboardingProgress: progress } });
        const result = readPreferences(tmpDir);
        expect(result.global?.onboardingProgress).toEqual(progress);
    });

    it('round-trips dismissedTips', () => {
        writePreferences(tmpDir, { global: { dismissedTips: ['tip-a', 'tip-b'] } });
        const result = readPreferences(tmpDir);
        expect(result.global?.dismissedTips).toEqual(['tip-a', 'tip-b']);
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
        const repoPrefsPath = path.join(tmpDir, 'repos', 'repo-1', 'preferences.json');
        fs.mkdirSync(path.dirname(repoPrefsPath), { recursive: true });
        fs.writeFileSync(
            repoPrefsPath,
            JSON.stringify({ lastModel: 'gpt-5.4', unknownKey: 42 }),
            'utf-8'
        );
        const prefs = readRepoPreferences(tmpDir, 'repo-1');
        expect(prefs).toEqual({ lastModel: 'gpt-5.4' });
        expect((prefs as any)?.unknownKey).toBeUndefined();
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
        writeRepoPreferences(tmpDir, 'r', { lastModel: 'first' });
        writeRepoPreferences(tmpDir, 'r', { lastModel: 'second' });
        const prefs = readRepoPreferences(tmpDir, 'r');
        expect(prefs.lastModel).toBe('second');
    });

    it('handles empty lastModel string in repos', () => {
        writeRepoPreferences(tmpDir, 'r', { lastModel: '' });
        const prefs = readRepoPreferences(tmpDir, 'r');
        expect(prefs.lastModel).toBe('');
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
        writeRepoPreferences(tmpDir, 'r', { lastDepth: 'deep' });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.lastDepth).toBe('deep');
    });

    it('round-trips lastDepth normal through write and read', () => {
        writeRepoPreferences(tmpDir, 'r', { lastModel: 'gpt-5.4', lastDepth: 'normal' });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.lastDepth).toBe('normal');
    });

    it('strips invalid lastDepth in repos on read', () => {
        const repoPrefsPath = path.join(tmpDir, 'repos', 'r', 'preferences.json');
        fs.mkdirSync(path.dirname(repoPrefsPath), { recursive: true });
        fs.writeFileSync(
            repoPrefsPath,
            JSON.stringify({ lastDepth: 'shallow' }),
            'utf-8'
        );
        const prefs = readRepoPreferences(tmpDir, 'r');
        expect(prefs.lastDepth).toBeUndefined();
    });

    it('round-trips lastEffort through write and read', () => {
        for (const level of ['low', 'medium', 'high'] as const) {
            writeRepoPreferences(tmpDir, 'r', { lastEffort: level });
            const loaded = readRepoPreferences(tmpDir, 'r');
            expect(loaded.lastEffort).toBe(level);
        }
    });

    it('strips invalid lastEffort in repos on read', () => {
        const repoPrefsPath = path.join(tmpDir, 'repos', 'r', 'preferences.json');
        fs.mkdirSync(path.dirname(repoPrefsPath), { recursive: true });
        fs.writeFileSync(
            repoPrefsPath,
            JSON.stringify({ lastEffort: 'extreme' }),
            'utf-8'
        );
        const prefs = readRepoPreferences(tmpDir, 'r');
        expect(prefs.lastEffort).toBeUndefined();
    });

    it('round-trips lastSkills through write and read', () => {
        writeRepoPreferences(tmpDir, 'r', { lastSkills: { task: ['impl'], ask: ['go-deep'] } });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.lastSkills).toEqual({ task: ['impl'], ask: ['go-deep'] });
    });

    it('round-trips lastSkills with all three modes', () => {
        writeRepoPreferences(tmpDir, 'r', { lastSkills: { task: ['impl'], ask: ['go-deep'], plan: ['speckit'] } });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.lastSkills).toEqual({ task: ['impl'], ask: ['go-deep'], plan: ['speckit'] });
    });

    it('round-trips lastSkills with multi-skill combinations', () => {
        writeRepoPreferences(tmpDir, 'r', { lastSkills: { task: ['impl', 'code-review'], plan: ['draft', 'speckit'] } });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.lastSkills).toEqual({ task: ['impl', 'code-review'], plan: ['draft', 'speckit'] });
    });

    it('round-trips lastModels through write and read', () => {
        writeRepoPreferences(tmpDir, 'r', { lastModels: { task: 'gpt-4', ask: 'claude-3' } });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.lastModels).toEqual({ task: 'gpt-4', ask: 'claude-3' });
    });

    it('round-trips lastModels with all three modes', () => {
        writeRepoPreferences(tmpDir, 'r', { lastModels: { task: 'gpt-4', ask: 'claude-3', plan: 'gemini' } });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.lastModels).toEqual({ task: 'gpt-4', ask: 'claude-3', plan: 'gemini' });
    });

    it('strips invalid lastModels in repos on read', () => {
        const repoPrefsPath = path.join(tmpDir, 'repos', 'r', 'preferences.json');
        fs.mkdirSync(path.dirname(repoPrefsPath), { recursive: true });
        fs.writeFileSync(
            repoPrefsPath,
            JSON.stringify({ lastModels: 'not-an-object' }),
            'utf-8'
        );
        const prefs = readRepoPreferences(tmpDir, 'r');
        expect(prefs.lastModels).toBeUndefined();
    });

    it('coerces legacy single-string lastSkills to array on read', () => {
        const repoPrefsPath = path.join(tmpDir, 'repos', 'r', 'preferences.json');
        fs.mkdirSync(path.dirname(repoPrefsPath), { recursive: true });
        fs.writeFileSync(
            repoPrefsPath,
            JSON.stringify({ lastSkills: { task: 'impl', ask: 'go-deep' } }),
            'utf-8'
        );
        const prefs = readRepoPreferences(tmpDir, 'r');
        expect(prefs.lastSkills).toEqual({ task: ['impl'], ask: ['go-deep'] });
    });

    it('drops empty string values from lastSkills on read', () => {
        const repoPrefsPath = path.join(tmpDir, 'repos', 'r', 'preferences.json');
        fs.mkdirSync(path.dirname(repoPrefsPath), { recursive: true });
        fs.writeFileSync(
            repoPrefsPath,
            JSON.stringify({ lastSkills: { task: '' } }),
            'utf-8'
        );
        const prefs = readRepoPreferences(tmpDir, 'r');
        expect(prefs.lastSkills).toBeUndefined();
    });

    it('multiple repos are stored independently', () => {
        writeRepoPreferences(tmpDir, 'repo-a', { lastModel: 'gpt-4' });
        writeRepoPreferences(tmpDir, 'repo-b', { lastModel: 'claude-3' });
        const loadedA = readRepoPreferences(tmpDir, 'repo-a');
        const loadedB = readRepoPreferences(tmpDir, 'repo-b');
        expect(loadedA.lastModel).toBe('gpt-4');
        expect(loadedB.lastModel).toBe('claude-3');
    });

    it('round-trips scriptTemplates through write and read', () => {
        const templates = [{ id: 't1', name: 'Build', scriptPath: './build.sh', args: '--prod', model: 'gpt-4' }];
        writeRepoPreferences(tmpDir, 'repo-a', { scriptTemplates: templates });
        const loaded = readRepoPreferences(tmpDir, 'repo-a');
        expect(loaded.scriptTemplates).toEqual(templates);
    });

    it('round-trips skillTemplates through write and read', () => {
        const templates = [{ id: 's1', name: 'My Template', model: 'gpt-4', mode: 'ask' as const, skills: ['code-review'] }];
        writeRepoPreferences(tmpDir, 'repo-a', { skillTemplates: templates });
        const loaded = readRepoPreferences(tmpDir, 'repo-a');
        expect(loaded.skillTemplates).toEqual(templates);
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

    it('accepts valid lastSkills array with task mode', () => {
        expect(validatePreferences({ lastSkills: { task: ['impl'] } })).toEqual({ lastSkills: { task: ['impl'] } });
    });

    it('accepts valid lastSkills array with all three modes', () => {
        const skills = { task: ['impl'], ask: ['go-deep'], plan: ['speckit'] };
        expect(validatePreferences({ lastSkills: skills })).toEqual({ lastSkills: skills });
    });

    it('accepts multi-skill combinations in lastSkills', () => {
        const skills = { task: ['impl', 'code-review'], plan: ['draft', 'speckit'] };
        expect(validatePreferences({ lastSkills: skills })).toEqual({ lastSkills: skills });
    });

    it('coerces legacy string values in lastSkills to array (backwards compat)', () => {
        expect(validatePreferences({ lastSkills: { task: 'impl' } })).toEqual({ lastSkills: { task: ['impl'] } });
    });

    it('drops empty string values from lastSkills arrays', () => {
        expect(validatePreferences({ lastSkills: { task: ['impl', '', 'go-deep'] } })).toEqual({ lastSkills: { task: ['impl', 'go-deep'] } });
    });

    it('drops empty string legacy values from lastSkills', () => {
        expect(validatePreferences({ lastSkills: { task: '' } })).toEqual({});
    });

    it('preserves empty arrays from lastSkills as explicit cleared signal', () => {
        expect(validatePreferences({ lastSkills: { task: [] } })).toEqual({ lastSkills: { task: [] } });
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

    it('rejects non-string/non-array values within lastSkills', () => {
        expect(validatePreferences({ lastSkills: { task: 42 } })).toEqual({});
        expect(validatePreferences({ lastSkills: { ask: true } })).toEqual({});
    });

    it('accepts lastSkills alongside other fields', () => {
        const result = validatePreferences({ lastModel: 'gpt-5.4', lastSkills: { task: ['go-deep'] } });
        expect(result).toEqual({ lastModel: 'gpt-5.4', lastSkills: { task: ['go-deep'] } });
    });

    // -- linkedRepoIds field --

    it('accepts valid linkedRepoIds array', () => {
        const result = validatePerRepoPreferences({ linkedRepoIds: ['ws-abc', 'ws-def'] });
        expect(result.linkedRepoIds).toEqual(['ws-abc', 'ws-def']);
    });

    it('accepts empty linkedRepoIds array (explicit clear)', () => {
        const result = validatePerRepoPreferences({ linkedRepoIds: [] });
        expect(result.linkedRepoIds).toEqual([]);
    });

    it('filters non-string and empty entries from linkedRepoIds', () => {
        const result = validatePerRepoPreferences({ linkedRepoIds: ['ws-1', '', null, 42, 'ws-2'] });
        expect(result.linkedRepoIds).toEqual(['ws-1', 'ws-2']);
    });

    it('ignores linkedRepoIds when not an array', () => {
        expect(validatePerRepoPreferences({ linkedRepoIds: 'ws-abc' }).linkedRepoIds).toBeUndefined();
        expect(validatePerRepoPreferences({ linkedRepoIds: null }).linkedRepoIds).toBeUndefined();
        expect(validatePerRepoPreferences({ linkedRepoIds: { a: 'b' } }).linkedRepoIds).toBeUndefined();
    });

    // --- scriptTemplates ---

    it('accepts valid scriptTemplates array with all required fields', () => {
        const input = [{ id: 't1', name: 'Build', scriptPath: './build.sh' }];
        expect(validatePerRepoPreferences({ scriptTemplates: input }).scriptTemplates).toEqual(input);
    });

    it('accepts empty scriptTemplates array (explicit clear)', () => {
        expect(validatePerRepoPreferences({ scriptTemplates: [] }).scriptTemplates).toEqual([]);
    });

    it('filters out entries missing id or scriptPath from scriptTemplates', () => {
        const input = [
            { id: 't1', name: 'Build', scriptPath: './build.sh' },
            { name: 'No ID', scriptPath: './run.sh' },
            { id: 't3', name: 'No Path' },
        ];
        const result = validatePerRepoPreferences({ scriptTemplates: input }).scriptTemplates!;
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('t1');
    });

    it('filters out entries where id is empty string in scriptTemplates', () => {
        const input = [{ id: '', name: 'Empty ID', scriptPath: './run.sh' }];
        expect(validatePerRepoPreferences({ scriptTemplates: input }).scriptTemplates).toEqual([]);
    });

    it('preserves optional fields in scriptTemplates', () => {
        const input = [{ id: 't1', name: 'Build', scriptPath: './build.sh', args: '--prod', workingDirectory: '/app', model: 'gpt-4', pauseOnFailure: true }];
        const result = validatePerRepoPreferences({ scriptTemplates: input }).scriptTemplates!;
        expect(result[0]).toEqual(input[0]);
    });

    it('rejects non-array scriptTemplates', () => {
        expect(validatePerRepoPreferences({ scriptTemplates: 'not-array' }).scriptTemplates).toBeUndefined();
        expect(validatePerRepoPreferences({ scriptTemplates: { id: 't1' } }).scriptTemplates).toBeUndefined();
    });

    // --- skillTemplates ---

    it('accepts valid skillTemplates array', () => {
        const input = [{ id: 's1', model: 'gpt-4', mode: 'ask', skills: ['code-review'] }];
        expect(validatePerRepoPreferences({ skillTemplates: input }).skillTemplates).toEqual(input);
    });

    it('accepts empty skillTemplates array (explicit clear)', () => {
        expect(validatePerRepoPreferences({ skillTemplates: [] }).skillTemplates).toEqual([]);
    });

    it('filters out entries missing required fields from skillTemplates', () => {
        const input = [
            { id: 's1', model: 'gpt-4', mode: 'ask', skills: ['a'] },
            { id: 's2', mode: 'ask', skills: ['a'] },           // missing model
            { id: 's3', model: 'gpt-4', skills: ['a'] },        // missing mode
            { id: 's4', model: 'gpt-4', mode: 'ask' },          // missing skills
        ];
        const result = validatePerRepoPreferences({ skillTemplates: input }).skillTemplates!;
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('s1');
    });

    it('filters out entries with invalid mode in skillTemplates', () => {
        const input = [{ id: 's1', model: 'gpt-4', mode: 'invalid', skills: ['a'] }];
        expect(validatePerRepoPreferences({ skillTemplates: input }).skillTemplates).toEqual([]);
    });

    it('filters out entries where skills is not an array in skillTemplates', () => {
        const input = [{ id: 's1', model: 'gpt-4', mode: 'ask', skills: 'not-array' }];
        expect(validatePerRepoPreferences({ skillTemplates: input }).skillTemplates).toEqual([]);
    });

    it('preserves optional name field in skillTemplates', () => {
        const input = [{ id: 's1', name: 'My Template', model: 'gpt-4', mode: 'ask', skills: ['a'] }];
        const result = validatePerRepoPreferences({ skillTemplates: input }).skillTemplates!;
        expect(result[0].name).toBe('My Template');
    });

    it('rejects non-array skillTemplates', () => {
        expect(validatePerRepoPreferences({ skillTemplates: 'not-array' }).skillTemplates).toBeUndefined();
        expect(validatePerRepoPreferences({ skillTemplates: { id: 's1' } }).skillTemplates).toBeUndefined();
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

    // -- hasSeenWelcome field --

    it('accepts hasSeenWelcome boolean true', () => {
        expect(validateGlobalPreferences({ hasSeenWelcome: true })).toEqual({ hasSeenWelcome: true });
    });

    it('accepts hasSeenWelcome boolean false', () => {
        expect(validateGlobalPreferences({ hasSeenWelcome: false })).toEqual({ hasSeenWelcome: false });
    });

    it('rejects non-boolean hasSeenWelcome', () => {
        expect(validateGlobalPreferences({ hasSeenWelcome: 'true' })).toEqual({});
        expect(validateGlobalPreferences({ hasSeenWelcome: 1 })).toEqual({});
        expect(validateGlobalPreferences({ hasSeenWelcome: null })).toEqual({});
    });

    // -- onboardingProgress field --

    it('accepts valid onboardingProgress sub-fields', () => {
        const result = validateGlobalPreferences({ onboardingProgress: { hasUsedChat: true, hasRunWorkflow: false } });
        expect(result).toEqual({ onboardingProgress: { hasUsedChat: true, hasRunWorkflow: false } });
    });

    it('strips unknown onboardingProgress sub-fields', () => {
        const result = validateGlobalPreferences({ onboardingProgress: { hasUsedChat: true, hackerField: true } });
        expect(result).toEqual({ onboardingProgress: { hasUsedChat: true } });
    });

    it('rejects non-object onboardingProgress', () => {
        expect(validateGlobalPreferences({ onboardingProgress: 'string' })).toEqual({});
        expect(validateGlobalPreferences({ onboardingProgress: [1, 2] })).toEqual({});
        expect(validateGlobalPreferences({ onboardingProgress: 42 })).toEqual({});
        expect(validateGlobalPreferences({ onboardingProgress: null })).toEqual({});
    });

    it('rejects non-boolean onboardingProgress sub-field values', () => {
        const result = validateGlobalPreferences({ onboardingProgress: { hasUsedChat: 'yes' } });
        expect(result.onboardingProgress).toBeUndefined();
    });

    it('omits onboardingProgress when all sub-fields are unknown', () => {
        const result = validateGlobalPreferences({ onboardingProgress: { unknown: true } });
        expect(result.onboardingProgress).toBeUndefined();
    });

    it('round-trips new onboardingProgress keys', () => {
        const input = { hasUsedChat: true, hasRunWorkflow: true, hasOpenedWiki: true };
        const result = validateGlobalPreferences({ onboardingProgress: input });
        expect(result).toEqual({ onboardingProgress: input });
    });

    it('round-trips hasCompletedTour in onboardingProgress', () => {
        const result = validateGlobalPreferences({ onboardingProgress: { hasCompletedTour: true } });
        expect(result).toEqual({ onboardingProgress: { hasCompletedTour: true } });
    });

    it('validates hasCompletedTour alongside other onboarding fields', () => {
        const input = { hasUsedChat: true, hasCompletedTour: false, dismissed: false };
        const result = validateGlobalPreferences({ onboardingProgress: input });
        expect(result).toEqual({ onboardingProgress: input });
    });

    it('strips old/removed onboardingProgress keys', () => {
        const result = validateGlobalPreferences({ onboardingProgress: { repoAdded: true, firstChatSent: true, workflowsVisited: true } });
        expect(result.onboardingProgress).toBeUndefined();
    });

    // -- dismissedTips field --

    it('accepts valid dismissedTips string array', () => {
        const result = validateGlobalPreferences({ dismissedTips: ['tip-a', 'tip-b'] });
        expect(result).toEqual({ dismissedTips: ['tip-a', 'tip-b'] });
    });

    it('filters non-string items from dismissedTips', () => {
        const result = validateGlobalPreferences({ dismissedTips: ['tip-a', 42, null, 'tip-b'] });
        expect(result.dismissedTips).toEqual(['tip-a', 'tip-b']);
    });

    it('filters empty strings from dismissedTips', () => {
        const result = validateGlobalPreferences({ dismissedTips: ['', 'tip-a'] });
        expect(result.dismissedTips).toEqual(['tip-a']);
    });

    it('rejects non-array dismissedTips', () => {
        expect(validateGlobalPreferences({ dismissedTips: 'not-array' })).toEqual({});
        expect(validateGlobalPreferences({ dismissedTips: {} })).toEqual({});
        expect(validateGlobalPreferences({ dismissedTips: 42 })).toEqual({});
    });

    it('omits dismissedTips when all items are invalid', () => {
        const result = validateGlobalPreferences({ dismissedTips: [42, null] });
        expect(result.dismissedTips).toBeUndefined();
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
        server = await createExecutionServer({ port: 0, dataDir: tmpDir , skipNonEssentialInit: true });
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
        writeRepoPreferences(tmpDir, 'r', { lastModel: 'gpt-4' });
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
        writeRepoPreferences(tmpDir, 'r', { lastModel: 'gpt-4' });
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const repoPrefs = readRepoPreferences(tmpDir, 'r');
        expect(repoPrefs.lastModel).toBe('gpt-4');
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

        server = await createExecutionServer({ port: 0, dataDir: tmpDir , skipNonEssentialInit: true });
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

        server = await createExecutionServer({ port: 0, dataDir: tmpDir , skipNonEssentialInit: true });
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

        server = await createExecutionServer({ port: 0, dataDir: tmpDir , skipNonEssentialInit: true });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).gitGroupOrder).toEqual(order);
    });

    // -- hasSeenWelcome persistence via API --

    it('PATCH with hasSeenWelcome merges into existing prefs', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { hasSeenWelcome: true });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.theme).toBe('dark');
        expect(body.hasSeenWelcome).toBe(true);
    });

    // -- onboardingProgress persistence via API --

    it('PATCH with onboardingProgress replaces wholesale', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { onboardingProgress: { hasUsedChat: true } });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { onboardingProgress: { hasRunWorkflow: true } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.onboardingProgress).toEqual({ hasRunWorkflow: true });
        expect(body.onboardingProgress.hasUsedChat).toBeUndefined();
    });

    it('PUT strips unknown onboardingProgress sub-fields', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { onboardingProgress: { hasUsedChat: true, evil: true } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.onboardingProgress).toEqual({ hasUsedChat: true });
        expect(body.onboardingProgress.evil).toBeUndefined();
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
        server = await createExecutionServer({ port: 0, dataDir: tmpDir , skipNonEssentialInit: true });
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

    // -- filesViewMode --

    it('filesViewMode round-trips through PUT and GET', async () => {
        await putJSON(repoUrl(repoId), { filesViewMode: 'flat' });
        const res = await getJSON(repoUrl(repoId));
        expect(JSON.parse(res.body).filesViewMode).toBe('flat');
    });

    it('filesViewMode round-trips through PATCH and GET', async () => {
        await patchJSON(repoUrl(repoId), { filesViewMode: 'tree' });
        const res = await getJSON(repoUrl(repoId));
        expect(JSON.parse(res.body).filesViewMode).toBe('tree');
    });

    it('PATCH filesViewMode merges with existing prefs', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4' });
        const res = await patchJSON(repoUrl(repoId), { filesViewMode: 'flat' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.lastModel).toBe('gpt-4');
        expect(body.filesViewMode).toBe('flat');
    });

    it('validates filesViewMode rejects invalid values', async () => {
        const res = await putJSON(repoUrl(repoId), { filesViewMode: 'grid' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).filesViewMode).toBeUndefined();
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

        server = await createExecutionServer({ port: 0, dataDir: tmpDir , skipNonEssentialInit: true });
        baseUrl = server.url;

        const res = await getJSON(repoUrl(repoId));
        expect(JSON.parse(res.body)).toEqual({ lastModel: 'gpt-4', lastDepth: 'deep' });
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

    it('PATCH persists lastSkills with single mode (array)', async () => {
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { task: ['impl'] } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastSkills: { task: ['impl'] } });
    });

    it('PATCH coerces legacy string lastSkills to array', async () => {
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { task: 'impl' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastSkills: { task: ['impl'] } });
    });

    it('PATCH merges lastSkills modes incrementally', async () => {
        await patchJSON(repoUrl(repoId), { lastSkills: { task: ['impl'] } });
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { ask: ['go-deep'] } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ lastSkills: { task: ['impl'], ask: ['go-deep'] } });
    });

    it('PATCH with empty array clears a single lastSkills mode', async () => {
        await patchJSON(repoUrl(repoId), { lastSkills: { task: ['impl'] } });
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { task: [] } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).lastSkills).toBeUndefined();
    });

    it('PATCH clearing one lastSkills mode preserves other modes', async () => {
        await patchJSON(repoUrl(repoId), { lastSkills: { task: ['impl'], ask: ['go-deep'] } });
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { task: [] } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).lastSkills).toEqual({ ask: ['go-deep'] });
    });

    it('PATCH clearing all lastSkills modes removes lastSkills entirely', async () => {
        await patchJSON(repoUrl(repoId), { lastSkills: { task: ['impl'], ask: ['go-deep'] } });
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { task: [], ask: [] } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).lastSkills).toBeUndefined();
    });

    it('PATCH clearing lastSkills persists on subsequent GET', async () => {
        await patchJSON(repoUrl(repoId), { lastSkills: { task: ['impl'] } });
        await patchJSON(repoUrl(repoId), { lastSkills: { task: [] } });
        const getRes = await getJSON(repoUrl(repoId));
        expect(getRes.status).toBe(200);
        expect(JSON.parse(getRes.body).lastSkills).toBeUndefined();
    });

    it('PATCH clearing lastSkills when no prior skills is a no-op', async () => {
        const res = await patchJSON(repoUrl(repoId), { lastSkills: { task: [] } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).lastSkills).toBeUndefined();
    });

    it('PATCH persists lastModels with single mode', async () => {
        const res = await patchJSON(repoUrl(repoId), { lastModels: { task: 'gpt-4' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).lastModels).toEqual({ task: 'gpt-4' });
    });

    it('PATCH merges lastModels modes incrementally', async () => {
        await patchJSON(repoUrl(repoId), { lastModels: { task: 'gpt-4' } });
        const res = await patchJSON(repoUrl(repoId), { lastModels: { ask: 'claude-3' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).lastModels).toEqual({ task: 'gpt-4', ask: 'claude-3' });
    });

    // -- linkedRepoIds --

    it('PATCH persists linkedRepoIds', async () => {
        const res = await patchJSON(repoUrl(repoId), { linkedRepoIds: ['ws-abc', 'ws-def'] });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).linkedRepoIds).toEqual(['ws-abc', 'ws-def']);

        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).linkedRepoIds).toEqual(['ws-abc', 'ws-def']);
    });

    it('PATCH with linkedRepoIds:[] clears existing linked repos', async () => {
        await patchJSON(repoUrl(repoId), { linkedRepoIds: ['ws-abc'] });
        const res = await patchJSON(repoUrl(repoId), { linkedRepoIds: [] });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).linkedRepoIds).toBeUndefined();

        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).linkedRepoIds).toBeUndefined();
    });

    it('PATCH with linkedRepoIds does not affect other fields', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4' });
        const res = await patchJSON(repoUrl(repoId), { linkedRepoIds: ['ws-abc'] });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.lastModel).toBe('gpt-4');
        expect(body.linkedRepoIds).toEqual(['ws-abc']);
    });

    it('PATCH persists scriptTemplates', async () => {
        const templates = [{ id: 't1', name: 'Build', scriptPath: './build.sh', args: '--prod' }];
        const res = await patchJSON(repoUrl(repoId), { scriptTemplates: templates });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).scriptTemplates).toEqual(templates);
        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).scriptTemplates).toEqual(templates);
    });

    it('PATCH with scriptTemplates:[] clears existing templates', async () => {
        await patchJSON(repoUrl(repoId), { scriptTemplates: [{ id: 't1', name: 'Build', scriptPath: './build.sh' }] });
        const res = await patchJSON(repoUrl(repoId), { scriptTemplates: [] });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).scriptTemplates).toEqual([]);
    });

    it('PATCH persists skillTemplates', async () => {
        const templates = [{ id: 's1', name: 'Review', model: 'gpt-4', mode: 'ask', skills: ['code-review'] }];
        const res = await patchJSON(repoUrl(repoId), { skillTemplates: templates });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).skillTemplates).toEqual(templates);
        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).skillTemplates).toEqual(templates);
    });

    it('PATCH with skillTemplates:[] clears existing templates', async () => {
        await patchJSON(repoUrl(repoId), { skillTemplates: [{ id: 's1', model: 'gpt-4', mode: 'task', skills: ['impl'] }] });
        const res = await patchJSON(repoUrl(repoId), { skillTemplates: [] });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).skillTemplates).toEqual([]);
    });
});
