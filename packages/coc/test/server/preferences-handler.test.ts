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
    readGlobalPreferences,
    writeRepoPreferences,
    validatePreferences,
    validatePerRepoPreferences,
    validateGlobalPreferences,
    normalizeGlobalPreferencesForRead,
    resolveDefaultModel,
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

    it('round-trips global HTML embed preference', () => {
        writePreferences(tmpDir, { global: { htmlEmbed: { enabled: true } } });
        const result = readPreferences(tmpDir);
        expect(result.global?.htmlEmbed).toEqual({ enabled: true });
    });

    it('round-trips AI prompt autocomplete preferences', () => {
        writePreferences(tmpDir, {
            global: {
                promptAutocomplete: {
                    enabled: true,
                    ai: {
                        enabled: true,
                        debounceMs: 500,
                        timeoutMs: 900,
                        maxHistoryItems: 12,
                        maxCompletionChars: 160,
                        includeGlobalHistory: false,
                    },
                },
            },
        });
        const result = readPreferences(tmpDir);
        expect(result.global?.promptAutocomplete).toEqual({
            enabled: true,
            ai: {
                enabled: true,
                debounceMs: 500,
                timeoutMs: 900,
                maxHistoryItems: 12,
                maxCompletionChars: 160,
                includeGlobalHistory: false,
            },
        });
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

    it('normalizes stale welcome dismissal state when reading global preferences', () => {
        writePreferences(tmpDir, {
            global: {
                hasSeenWelcome: true,
                onboardingProgress: { dismissed: false, hasCompletedTour: false },
            },
        });

        expect(readPreferences(tmpDir).global?.onboardingProgress?.hasCompletedTour).toBe(false);
        expect(readGlobalPreferences(tmpDir).onboardingProgress?.hasCompletedTour).toBe(true);
    });

    it('does not normalize welcome relaunch state before the welcome modal is seen', () => {
        const global = normalizeGlobalPreferencesForRead({
            hasSeenWelcome: false,
            onboardingProgress: { dismissed: false, hasCompletedTour: false },
        });

        expect(global.onboardingProgress?.hasCompletedTour).toBe(false);
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

    it('round-trips activityFilters with workspace', () => {
        writePreferences(tmpDir, { global: { activityFilters: { workspace: 'ws-1' } } });
        const result = readPreferences(tmpDir);
        expect(result.global?.activityFilters).toEqual({ workspace: 'ws-1' });
    });

    it('silently drops statusFilter and typeFilter from global activityFilters on round-trip', () => {
        writePreferences(tmpDir, { global: { activityFilters: { statusFilter: 'running', workspace: 'ws-1', typeFilter: 'chat' } } });
        const result = readPreferences(tmpDir);
        expect(result.global?.activityFilters).toEqual({ workspace: 'ws-1' });
    });

    it('round-trips activityFilters with myWorkExcludedTypes', () => {
        writePreferences(tmpDir, { global: { activityFilters: { myWorkExcludedTypes: ['ask', 'plan'] } } });
        const result = readPreferences(tmpDir);
        expect(result.global?.activityFilters).toEqual({ myWorkExcludedTypes: ['ask', 'plan'] });
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

    it('drops invalid global HTML embed preference shapes during read', () => {
        fs.writeFileSync(path.join(tmpDir, PREFERENCES_FILE_NAME), JSON.stringify({ global: { htmlEmbed: { enabled: 'yes' } } }), 'utf-8');
        const prefs = readPreferences(tmpDir);
        expect(prefs.global).toBeUndefined();
    });

    it('strips invalid AI prompt autocomplete preference fields during read', () => {
        fs.writeFileSync(
            path.join(tmpDir, PREFERENCES_FILE_NAME),
            JSON.stringify({
                global: {
                    promptAutocomplete: {
                        enabled: true,
                        ai: {
                            enabled: true,
                            debounceMs: 10,
                            timeoutMs: 'slow',
                            maxHistoryItems: 500,
                            maxCompletionChars: 160,
                            includeGlobalHistory: false,
                            unknown: true,
                        },
                    },
                },
            }),
            'utf-8',
        );
        const prefs = readPreferences(tmpDir);
        expect(prefs.global?.promptAutocomplete).toEqual({
            enabled: true,
            ai: {
                enabled: true,
                maxCompletionChars: 160,
                includeGlobalHistory: false,
            },
        });
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

    it('round-trips lastModels with note mode', () => {
        writeRepoPreferences(tmpDir, 'r', { lastModels: { task: 'gpt-4', note: 'claude-sonnet-4.6' } });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.lastModels).toEqual({ task: 'gpt-4', note: 'claude-sonnet-4.6' });
    });

    it('accepts lastModels with note mode', () => {
        const result = validatePerRepoPreferences({ lastModels: { note: 'claude-sonnet-4.6' } });
        expect(result.lastModels).toEqual({ note: 'claude-sonnet-4.6' });
    });

    it('accepts lastModels with all four modes including note', () => {
        const result = validatePerRepoPreferences({ lastModels: { task: 'gpt-4', ask: 'claude-3', plan: 'gemini', note: 'my-model' } });
        expect(result.lastModels).toEqual({ task: 'gpt-4', ask: 'claude-3', plan: 'gemini', note: 'my-model' });
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

    it('round-trips linkHandlers through write and read', () => {
        writePreferences(tmpDir, { global: { linkHandlers: { teams: true, onenote: false } } });
        const loaded = readPreferences(tmpDir);
        expect(loaded.global?.linkHandlers).toEqual({ teams: true, onenote: false });
    });

    it('round-trips defaultModel through write and read', () => {
        writeRepoPreferences(tmpDir, 'r', { defaultModel: 'claude-sonnet-4.6' });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.defaultModel).toBe('claude-sonnet-4.6');
    });

    it('round-trips defaultModels through write and read', () => {
        writeRepoPreferences(tmpDir, 'r', {
            defaultModels: { task: 'gpt-4', ask: 'claude-3', schedule: 'gpt-5-mini' },
        });
        const loaded = readRepoPreferences(tmpDir, 'r');
        expect(loaded.defaultModels).toEqual({ task: 'gpt-4', ask: 'claude-3', schedule: 'gpt-5-mini' });
    });

    it('validates defaultModel max length', () => {
        const longModel = 'a'.repeat(101);
        const result = validatePerRepoPreferences({ defaultModel: longModel });
        expect(result.defaultModel).toBeUndefined();
    });

    it('validates defaultModels mode values max length', () => {
        const longModel = 'a'.repeat(101);
        const result = validatePerRepoPreferences({ defaultModels: { task: longModel, ask: 'ok' } });
        expect(result.defaultModels).toEqual({ ask: 'ok' });
    });

    it('strips invalid defaultModels (not an object)', () => {
        const result = validatePerRepoPreferences({ defaultModels: 'not-an-object' });
        expect(result.defaultModels).toBeUndefined();
    });

    it('sync round-trips through write and read', () => {
        const prefs = { sync: { gitRemote: 'https://github.com/user/repo.git', intervalMinutes: 15 } };
        writeRepoPreferences(tmpDir, 'ws-sync-test', prefs);
        const read = readRepoPreferences(tmpDir, 'ws-sync-test');
        expect(read.sync).toEqual(prefs.sync);
    });

    it('strips unknown mode keys from defaultModels', () => {
        const result = validatePerRepoPreferences({ defaultModels: { task: 'gpt-4', unknownMode: 'val' } } as any);
        expect(result.defaultModels).toEqual({ task: 'gpt-4' });
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

    // -- activityFilters --

    it('accepts valid activityFilters', () => {
        const result = validatePerRepoPreferences({ activityFilters: { statusFilter: 'running', typeFilter: 'chat' } });
        expect(result.activityFilters).toEqual({ statusFilter: 'running', typeFilter: 'chat' });
    });

    it('accepts partial activityFilters with only statusFilter', () => {
        const result = validatePerRepoPreferences({ activityFilters: { statusFilter: 'completed' } });
        expect(result.activityFilters).toEqual({ statusFilter: 'completed' });
    });

    it('accepts partial activityFilters with only typeFilter', () => {
        const result = validatePerRepoPreferences({ activityFilters: { typeFilter: 'run-workflow' } });
        expect(result.activityFilters).toEqual({ typeFilter: 'run-workflow' });
    });

    it('returns undefined activityFilters when fields are invalid types', () => {
        const result = validatePerRepoPreferences({ activityFilters: { statusFilter: 123, typeFilter: null } });
        expect(result.activityFilters).toBeUndefined();
    });

    it('strips invalid fields but keeps valid ones', () => {
        const result = validatePerRepoPreferences({ activityFilters: { statusFilter: 'running', typeFilter: 42 } });
        expect(result.activityFilters).toEqual({ statusFilter: 'running' });
    });

    it('rejects non-object activityFilters', () => {
        expect(validatePerRepoPreferences({ activityFilters: 'bad' }).activityFilters).toBeUndefined();
        expect(validatePerRepoPreferences({ activityFilters: 42 }).activityFilters).toBeUndefined();
        expect(validatePerRepoPreferences({ activityFilters: null }).activityFilters).toBeUndefined();
        expect(validatePerRepoPreferences({ activityFilters: ['chat'] }).activityFilters).toBeUndefined();
    });

    it('activityFilters coexists with other per-repo fields', () => {
        const result = validatePerRepoPreferences({ lastDepth: 'deep', activityFilters: { statusFilter: 'running' } });
        expect(result.lastDepth).toBe('deep');
        expect(result.activityFilters).toEqual({ statusFilter: 'running' });
    });

    // -- sync field --

    it('accepts valid sync with gitRemote and intervalMinutes', () => {
        const result = validatePerRepoPreferences({ sync: { gitRemote: 'https://github.com/user/repo.git', intervalMinutes: 10 } });
        expect(result.sync).toEqual({ gitRemote: 'https://github.com/user/repo.git', intervalMinutes: 10 });
    });

    it('accepts sync with only gitRemote', () => {
        const result = validatePerRepoPreferences({ sync: { gitRemote: 'https://github.com/user/repo.git' } });
        expect(result.sync).toEqual({ gitRemote: 'https://github.com/user/repo.git' });
    });

    it('accepts sync with only intervalMinutes', () => {
        const result = validatePerRepoPreferences({ sync: { intervalMinutes: 5 } });
        expect(result.sync).toEqual({ intervalMinutes: 5 });
    });

    it('accepts empty sync object', () => {
        const result = validatePerRepoPreferences({ sync: {} });
        expect(result.sync).toEqual({});
    });

    it('rejects non-object sync', () => {
        expect(validatePerRepoPreferences({ sync: 'bad' }).sync).toBeUndefined();
        expect(validatePerRepoPreferences({ sync: 42 }).sync).toBeUndefined();
        expect(validatePerRepoPreferences({ sync: null }).sync).toBeUndefined();
    });

    it('drops invalid intervalMinutes but keeps gitRemote', () => {
        const result = validatePerRepoPreferences({ sync: { gitRemote: 'https://x.git', intervalMinutes: -1 } });
        expect(result.sync).toEqual({ gitRemote: 'https://x.git' });
    });

    it('sync coexists with other per-repo fields', () => {
        const result = validatePerRepoPreferences({ lastDepth: 'deep', sync: { gitRemote: 'https://x.git' } });
        expect(result.lastDepth).toBe('deep');
        expect(result.sync).toEqual({ gitRemote: 'https://x.git' });
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

    // -- repoTabOrder field --

    it('accepts valid repoTabOrder array of workspace IDs', () => {
        const result = validateGlobalPreferences({ repoTabOrder: ['ws-1', 'ws-2'] });
        expect(result).toEqual({ repoTabOrder: ['ws-1', 'ws-2'] });
    });

    it('rejects non-array repoTabOrder', () => {
        expect(validateGlobalPreferences({ repoTabOrder: 'not-array' })).toEqual({});
        expect(validateGlobalPreferences({ repoTabOrder: 42 })).toEqual({});
        expect(validateGlobalPreferences({ repoTabOrder: {} })).toEqual({});
    });

    it('filters out non-string and empty entries from repoTabOrder', () => {
        const result = validateGlobalPreferences({ repoTabOrder: ['ws-1', 42, '', null, 'ws-2'] });
        expect(result.repoTabOrder).toEqual(['ws-1', 'ws-2']);
    });

    it('omits repoTabOrder when all entries are invalid', () => {
        const result = validateGlobalPreferences({ repoTabOrder: [42, null, ''] });
        expect(result.repoTabOrder).toBeUndefined();
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

    // -- activityFilters field --

    it('accepts valid activityFilters with workspace', () => {
        const result = validateGlobalPreferences({ activityFilters: { workspace: 'ws-1' } });
        expect(result.activityFilters).toEqual({ workspace: 'ws-1' });
    });

    it('silently drops statusFilter and typeFilter from global activityFilters', () => {
        const result = validateGlobalPreferences({ activityFilters: { statusFilter: 'running', workspace: 'ws-1', typeFilter: 'chat' } });
        expect(result.activityFilters).toEqual({ workspace: 'ws-1' });
    });

    it('returns undefined activityFilters when only statusFilter or typeFilter provided', () => {
        const result = validateGlobalPreferences({ activityFilters: { statusFilter: 'completed' } });
        expect(result.activityFilters).toBeUndefined();
    });

    it('rejects non-object activityFilters', () => {
        expect(validateGlobalPreferences({ activityFilters: 'bad' })).toEqual({});
        expect(validateGlobalPreferences({ activityFilters: 42 })).toEqual({});
        expect(validateGlobalPreferences({ activityFilters: null })).toEqual({});
    });

    it('rejects array activityFilters', () => {
        expect(validateGlobalPreferences({ activityFilters: ['a'] })).toEqual({});
    });

    it('strips non-string workspace inside activityFilters', () => {
        const result = validateGlobalPreferences({ activityFilters: { workspace: 42 } });
        expect(result.activityFilters).toBeUndefined();
    });

    it('omits activityFilters when all sub-fields are invalid', () => {
        const result = validateGlobalPreferences({ activityFilters: { statusFilter: 123 } });
        expect(result.activityFilters).toBeUndefined();
    });

    it('accepts activityFilters alongside other global fields', () => {
        const result = validateGlobalPreferences({ theme: 'dark', activityFilters: { workspace: 'ws-1' } });
        expect(result.theme).toBe('dark');
        expect(result.activityFilters).toEqual({ workspace: 'ws-1' });
    });

    // -- activityFilters.myWorkExcludedTypes --

    it('accepts myWorkExcludedTypes as string[]', () => {
        const result = validateGlobalPreferences({ activityFilters: { myWorkExcludedTypes: ['run-workflow', 'ask'] } });
        expect(result.activityFilters).toEqual({ myWorkExcludedTypes: ['run-workflow', 'ask'] });
    });

    it('accepts empty myWorkExcludedTypes array', () => {
        const result = validateGlobalPreferences({ activityFilters: { myWorkExcludedTypes: [] } });
        expect(result.activityFilters).toEqual({ myWorkExcludedTypes: [] });
    });

    it('filters non-string items from myWorkExcludedTypes', () => {
        const result = validateGlobalPreferences({ activityFilters: { myWorkExcludedTypes: ['chat', 42, null, '', 'plan'] } });
        expect(result.activityFilters!.myWorkExcludedTypes).toEqual(['chat', 'plan']);
    });

    it('ignores myWorkExcludedTypes when not an array', () => {
        const result = validateGlobalPreferences({ activityFilters: { myWorkExcludedTypes: 'bad', workspace: 'ws-1' } });
        expect(result.activityFilters).toEqual({ workspace: 'ws-1' });
        expect(result.activityFilters!.myWorkExcludedTypes).toBeUndefined();
    });

    it('preserves myWorkExcludedTypes alongside other activityFilters fields', () => {
        const result = validateGlobalPreferences({ activityFilters: { workspace: 'ws-2', myWorkExcludedTypes: ['ask'] } });
        expect(result.activityFilters).toEqual({ workspace: 'ws-2', myWorkExcludedTypes: ['ask'] });
    });

    it('accepts uiLayoutMode classic', () => {
        expect(validateGlobalPreferences({ uiLayoutMode: 'classic' })).toEqual({ uiLayoutMode: 'classic' });
    });

    it('accepts uiLayoutMode dev-workflow', () => {
        expect(validateGlobalPreferences({ uiLayoutMode: 'dev-workflow' })).toEqual({ uiLayoutMode: 'dev-workflow' });
    });

    it('drops invalid uiLayoutMode values', () => {
        expect(validateGlobalPreferences({ uiLayoutMode: 'unknown' })).toEqual({});
        expect(validateGlobalPreferences({ uiLayoutMode: 42 })).toEqual({});
        expect(validateGlobalPreferences({ uiLayoutMode: null })).toEqual({});
        expect(validateGlobalPreferences({ uiLayoutMode: true })).toEqual({});
        expect(validateGlobalPreferences({ uiLayoutMode: '' })).toEqual({});
    });

    it('accepts uiLayoutMode alongside other global fields', () => {
        const result = validateGlobalPreferences({ theme: 'dark', uiLayoutMode: 'dev-workflow' });
        expect(result.theme).toBe('dark');
        expect(result.uiLayoutMode).toBe('dev-workflow');
    });

    // -- linkHandlers field --

    it('accepts valid linkHandlers map of boolean values', () => {
        const result = validateGlobalPreferences({ linkHandlers: { teams: true, vscode: false } });
        expect(result.linkHandlers).toEqual({ teams: true, vscode: false });
    });

    it('accepts single-entry linkHandlers', () => {
        expect(validateGlobalPreferences({ linkHandlers: { onenote: true } })).toEqual({ linkHandlers: { onenote: true } });
    });

    it('filters out non-boolean values from linkHandlers', () => {
        const result = validateGlobalPreferences({ linkHandlers: { teams: true, vscode: 'yes', onenote: 1 } });
        expect(result.linkHandlers).toEqual({ teams: true });
    });

    it('omits linkHandlers when all values are non-boolean', () => {
        const result = validateGlobalPreferences({ linkHandlers: { teams: 'yes', vscode: 42 } });
        expect(result.linkHandlers).toBeUndefined();
    });

    it('rejects non-object linkHandlers', () => {
        expect(validateGlobalPreferences({ linkHandlers: 'teams' })).toEqual({});
        expect(validateGlobalPreferences({ linkHandlers: 42 })).toEqual({});
        expect(validateGlobalPreferences({ linkHandlers: null })).toEqual({});
        expect(validateGlobalPreferences({ linkHandlers: ['teams'] })).toEqual({});
    });

    it('strips empty-string keys from linkHandlers', () => {
        const result = validateGlobalPreferences({ linkHandlers: { '': true, teams: true } });
        expect(result.linkHandlers).toEqual({ teams: true });
    });

    it('accepts linkHandlers alongside other global fields', () => {
        const result = validateGlobalPreferences({ theme: 'dark', linkHandlers: { teams: true } });
        expect(result.theme).toBe('dark');
        expect(result.linkHandlers).toEqual({ teams: true });
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

    it('GET normalizes stale welcome dismissal state', async () => {
        writePreferences(tmpDir, {
            global: {
                hasSeenWelcome: true,
                onboardingProgress: { dismissed: false, hasCompletedTour: false },
            },
        });

        const res = await getJSON(`${baseUrl}/api/preferences`);

        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: false, hasCompletedTour: true },
        });
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

    // -- repoTabOrder persistence via API --

    it('PATCH persists repoTabOrder', async () => {
        const order = ['ws-alpha', 'ws-bravo'];
        const res = await patchJSON(`${baseUrl}/api/preferences`, { repoTabOrder: order });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).repoTabOrder).toEqual(order);
    });

    it('GET returns persisted repoTabOrder', async () => {
        const order = ['ws-charlie', 'ws-delta'];
        await patchJSON(`${baseUrl}/api/preferences`, { repoTabOrder: order });
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).repoTabOrder).toEqual(order);
    });

    it('PATCH updates repoTabOrder without affecting other global prefs', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const order = ['ws-echo'];
        const res = await patchJSON(`${baseUrl}/api/preferences`, { repoTabOrder: order });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.theme).toBe('dark');
        expect(body.repoTabOrder).toEqual(order);
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

    it('persists hasSeenWelcome across server restart', async () => {
        const patch = await patchJSON(`${baseUrl}/api/preferences`, { hasSeenWelcome: true });
        expect(patch.status).toBe(200);

        await server.close();
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).hasSeenWelcome).toBe(true);
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

    it('PATCH with welcome skip payload persists hasSeenWelcome and dismissed progress together', async () => {
        const res = await patchJSON(`${baseUrl}/api/preferences`, {
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true },
        });
        expect(res.status).toBe(200);

        const body = JSON.parse(res.body);
        expect(body.hasSeenWelcome).toBe(true);
        expect(body.onboardingProgress).toEqual({ dismissed: true });
    });

    it('persists completed tour progress across server restart', async () => {
        const patch = await patchJSON(`${baseUrl}/api/preferences`, {
            onboardingProgress: { hasCompletedTour: true },
        });
        expect(patch.status).toBe(200);

        await server.close();
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).onboardingProgress).toEqual({ hasCompletedTour: true });
    });

    it('PUT strips unknown onboardingProgress sub-fields', async () => {
        const res = await putJSON(`${baseUrl}/api/preferences`, { onboardingProgress: { hasUsedChat: true, evil: true } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.onboardingProgress).toEqual({ hasUsedChat: true });
        expect(body.onboardingProgress.evil).toBeUndefined();
    });

    // -- activityFilters persistence via API --

    it('PATCH persists activityFilters with workspace', async () => {
        const filters = { workspace: 'ws-1' };
        const res = await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: filters });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).activityFilters).toEqual(filters);
    });

    it('GET returns persisted activityFilters', async () => {
        const filters = { workspace: 'ws-1' };
        await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: filters });
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).activityFilters).toEqual(filters);
    });

    it('PATCH deep-merges activityFilters fields', async () => {
        await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { workspace: 'ws-1' } });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { myWorkExcludedTypes: ['chat'] } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.activityFilters).toEqual({ workspace: 'ws-1', myWorkExcludedTypes: ['chat'] });
    });

    it('PATCH activityFilters does not affect other global fields', async () => {
        await putJSON(`${baseUrl}/api/preferences`, { theme: 'dark' });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { workspace: 'ws-1' } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.theme).toBe('dark');
        expect(body.activityFilters).toEqual({ workspace: 'ws-1' });
    });

    it('activityFilters survives server restart', async () => {
        const filters = { workspace: 'ws-queued', myWorkExcludedTypes: ['run-workflow'] };
        await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: filters });
        await server.close();

        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).activityFilters).toEqual(filters);
    });

    it('statusFilter and typeFilter in global activityFilters payload are silently dropped', async () => {
        const res = await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { statusFilter: 'running', typeFilter: 'chat', workspace: 'ws-1' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).activityFilters).toEqual({ workspace: 'ws-1' });
    });

    // -- myWorkExcludedTypes persistence via API --

    it('PATCH persists myWorkExcludedTypes', async () => {
        const res = await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { myWorkExcludedTypes: ['run-workflow', 'ask'] } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).activityFilters!.myWorkExcludedTypes).toEqual(['run-workflow', 'ask']);
    });

    it('PATCH deep-merges myWorkExcludedTypes with existing activityFilters', async () => {
        await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { workspace: 'ws-1' } });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { myWorkExcludedTypes: ['plan'] } });
        const body = JSON.parse(res.body);
        expect(body.activityFilters!.workspace).toBe('ws-1');
        expect(body.activityFilters!.myWorkExcludedTypes).toEqual(['plan']);
    });

    it('PATCH with empty myWorkExcludedTypes clears the array', async () => {
        await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { myWorkExcludedTypes: ['chat'] } });
        const res = await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { myWorkExcludedTypes: [] } });
        expect(JSON.parse(res.body).activityFilters!.myWorkExcludedTypes).toEqual([]);
    });

    it('GET returns persisted myWorkExcludedTypes', async () => {
        await patchJSON(`${baseUrl}/api/preferences`, { activityFilters: { myWorkExcludedTypes: ['autopilot'] } });
        const res = await getJSON(`${baseUrl}/api/preferences`);
        expect(JSON.parse(res.body).activityFilters!.myWorkExcludedTypes).toEqual(['autopilot']);
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

    // -- skill usage --

    it('PATCH skill usage records the latest timestamp for the skill', async () => {
        const res = await patchJSON(`${repoUrl(repoId)}/skill-usage`, { skillName: 'impl' });
        expect(res.status).toBe(200);

        const body = JSON.parse(res.body);
        expect(body.skillName).toBe('impl');
        expect(typeof body.timestamp).toBe('string');

        const prefs = readRepoPreferences(tmpDir, decodeURIComponent(repoId));
        expect(prefs.skillUsageMap?.impl).toBe(body.timestamp);
    });

    it('GET skill usage filters by skill name and since timestamp', async () => {
        writeRepoPreferences(tmpDir, decodeURIComponent(repoId), {
            skillUsageMap: {
                impl: '2026-05-02T09:05:00.000Z',
                draft: '2026-05-02T08:30:00.000Z',
                'code-review': '2026-05-02T09:10:00.000Z',
            },
        });

        const res = await getJSON(`${repoUrl(repoId)}/skill-usage?skillName=impl&since=${encodeURIComponent('2026-05-02T09:00:00.000Z')}`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            usage: [
                { skillName: 'impl', timestamp: '2026-05-02T09:05:00.000Z' },
            ],
        });
    });

    it('GET skill usage returns entries sorted by newest timestamp first', async () => {
        writeRepoPreferences(tmpDir, decodeURIComponent(repoId), {
            skillUsageMap: {
                draft: '2026-05-02T08:30:00.000Z',
                impl: '2026-05-02T09:05:00.000Z',
                'code-review': '2026-05-02T09:10:00.000Z',
            },
        });

        const res = await getJSON(`${repoUrl(repoId)}/skill-usage`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            usage: [
                { skillName: 'code-review', timestamp: '2026-05-02T09:10:00.000Z' },
                { skillName: 'impl', timestamp: '2026-05-02T09:05:00.000Z' },
                { skillName: 'draft', timestamp: '2026-05-02T08:30:00.000Z' },
            ],
        });
    });

    it('GET skill usage returns 400 for invalid since timestamps', async () => {
        const res = await getJSON(`${repoUrl(repoId)}/skill-usage?since=not-a-date`);
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toBe('`since` must be an ISO date-time string');
    });

    // -- commit-scoped skill usage --

    it('PATCH commit-skill-usage records only to commitSkillUsageMap', async () => {
        // Pre-populate the general skillUsageMap to verify isolation
        writeRepoPreferences(tmpDir, decodeURIComponent(repoId), {
            skillUsageMap: { impl: '2026-05-01T00:00:00.000Z' },
        });

        const res = await patchJSON(`${repoUrl(repoId)}/commit-skill-usage`, { skillName: 'go-deep' });
        expect(res.status).toBe(200);

        const body = JSON.parse(res.body);
        expect(body.skillName).toBe('go-deep');
        expect(typeof body.timestamp).toBe('string');

        const prefs = readRepoPreferences(tmpDir, decodeURIComponent(repoId));
        expect(prefs.commitSkillUsageMap?.['go-deep']).toBe(body.timestamp);
        // General map must be untouched
        expect(prefs.skillUsageMap?.impl).toBe('2026-05-01T00:00:00.000Z');
        expect(prefs.skillUsageMap?.['go-deep']).toBeUndefined();
    });

    it('PATCH commit-skill-usage returns 400 when skillName is missing', async () => {
        const res = await patchJSON(`${repoUrl(repoId)}/commit-skill-usage`, {});
        expect(res.status).toBe(400);
    });

    it('GET commit-skill-usage returns entries sorted by newest first', async () => {
        writeRepoPreferences(tmpDir, decodeURIComponent(repoId), {
            commitSkillUsageMap: {
                draft: '2026-05-02T08:30:00.000Z',
                impl: '2026-05-02T09:05:00.000Z',
                'code-review': '2026-05-02T09:10:00.000Z',
            },
        });

        const res = await getJSON(`${repoUrl(repoId)}/commit-skill-usage`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            usage: [
                { skillName: 'code-review', timestamp: '2026-05-02T09:10:00.000Z' },
                { skillName: 'impl', timestamp: '2026-05-02T09:05:00.000Z' },
                { skillName: 'draft', timestamp: '2026-05-02T08:30:00.000Z' },
            ],
        });
    });

    it('GET commit-skill-usage filters by skillName and since', async () => {
        writeRepoPreferences(tmpDir, decodeURIComponent(repoId), {
            commitSkillUsageMap: {
                impl: '2026-05-02T09:05:00.000Z',
                draft: '2026-05-02T08:30:00.000Z',
                'code-review': '2026-05-02T09:10:00.000Z',
            },
        });

        const res = await getJSON(`${repoUrl(repoId)}/commit-skill-usage?skillName=impl&since=${encodeURIComponent('2026-05-02T09:00:00.000Z')}`);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            usage: [
                { skillName: 'impl', timestamp: '2026-05-02T09:05:00.000Z' },
            ],
        });
    });

    it('GET commit-skill-usage returns 400 for invalid since timestamps', async () => {
        const res = await getJSON(`${repoUrl(repoId)}/commit-skill-usage?since=not-a-date`);
        expect(res.status).toBe(400);
    });

    it('general skill-usage PATCH does not modify commitSkillUsageMap', async () => {
        writeRepoPreferences(tmpDir, decodeURIComponent(repoId), {
            commitSkillUsageMap: { impl: '2026-05-01T00:00:00.000Z' },
        });

        await patchJSON(`${repoUrl(repoId)}/skill-usage`, { skillName: 'impl' });

        const prefs = readRepoPreferences(tmpDir, decodeURIComponent(repoId));
        // commitSkillUsageMap should still have the original timestamp
        expect(prefs.commitSkillUsageMap?.impl).toBe('2026-05-01T00:00:00.000Z');
    });

    it('commitSkillUsageMap round-trips through PATCH preferences', async () => {
        await patchJSON(repoUrl(repoId), {
            commitSkillUsageMap: { impl: '2026-05-10T10:00:00.000Z' },
        });
        const res = await getJSON(repoUrl(repoId));
        expect(JSON.parse(res.body).commitSkillUsageMap).toEqual({
            impl: '2026-05-10T10:00:00.000Z',
        });
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

    // -- boundedMemory --

    it('validates boundedMemory.enabled boolean', async () => {
        await putJSON(repoUrl(repoId), { boundedMemory: { enabled: true } });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.boundedMemory).toEqual({ enabled: true });
    });

    it('validates boundedMemory.charLimit number', async () => {
        await putJSON(repoUrl(repoId), { boundedMemory: { enabled: true, charLimit: 8192 } });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.boundedMemory).toEqual({ enabled: true, charLimit: 8192 });
    });

    it('rejects invalid charLimit', async () => {
        await putJSON(repoUrl(repoId), { boundedMemory: { enabled: true, charLimit: -1 } });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.boundedMemory).toEqual({ enabled: true });
        expect(body.boundedMemory.charLimit).toBeUndefined();
    });

    it('validates boundedMemory ranked recall settings', async () => {
        await putJSON(repoUrl(repoId), {
            boundedMemory: {
                enabled: true,
                recall: {
                    enabled: true,
                    maxEntries: 6,
                    charBudget: 1200,
                    maxBm25Score: 0,
                },
            },
        });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.boundedMemory).toEqual({
            enabled: true,
            recall: {
                enabled: true,
                maxEntries: 6,
                charBudget: 1200,
                maxBm25Score: 0,
            },
        });
    });

    it('drops invalid boundedMemory ranked recall settings', async () => {
        await putJSON(repoUrl(repoId), {
            boundedMemory: {
                enabled: true,
                recall: {
                    enabled: 'yes',
                    maxEntries: 0,
                    charBudget: -1,
                    maxBm25Score: Number.NaN,
                },
            },
        });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.boundedMemory).toEqual({ enabled: true });
    });

    it('validates boundedMemory read tool settings', async () => {
        await putJSON(repoUrl(repoId), {
            boundedMemory: {
                enabled: true,
                readTools: {
                    enabled: true,
                    maxResults: 6,
                    maxEntryChars: 1200,
                },
            },
        });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.boundedMemory).toEqual({
            enabled: true,
            readTools: {
                enabled: true,
                maxResults: 6,
                maxEntryChars: 1200,
            },
        });
    });

    it('drops invalid boundedMemory read tool settings', async () => {
        await putJSON(repoUrl(repoId), {
            boundedMemory: {
                enabled: true,
                readTools: {
                    enabled: 'yes',
                    maxResults: 0,
                    maxEntryChars: -1,
                },
            },
        });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.boundedMemory).toEqual({ enabled: true });
    });

    it('rejects non-object boundedMemory', async () => {
        await putJSON(repoUrl(repoId), { boundedMemory: 'yes' });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.boundedMemory).toBeUndefined();
    });

    // -- notesGit --

    it('validates notesGit with enabled only', async () => {
        await putJSON(repoUrl(repoId), { notesGit: { enabled: true } });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.notesGit).toEqual({ enabled: true });
    });

    it('validates notesGit with full autoCommit', async () => {
        await putJSON(repoUrl(repoId), {
            notesGit: { enabled: true, autoCommit: { enabled: true, intervalMs: 1_800_000 } },
        });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.notesGit).toEqual({
            enabled: true,
            autoCommit: { enabled: true, intervalMs: 1_800_000 },
        });
    });

    it('drops notesGit when enabled has wrong type', async () => {
        await putJSON(repoUrl(repoId), { notesGit: { enabled: 'yes' } });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.notesGit).toBeUndefined();
    });

    it('preserves notesGit.enabled but drops invalid autoCommit', async () => {
        await putJSON(repoUrl(repoId), {
            notesGit: { enabled: true, autoCommit: { enabled: 'yes' } },
        });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.notesGit).toEqual({ enabled: true });
        expect(body.notesGit.autoCommit).toBeUndefined();
    });

    it('drops notesGit when value is null', async () => {
        await putJSON(repoUrl(repoId), { notesGit: null });
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.notesGit).toBeUndefined();
    });

    it('round-trips notesGit through write and read', async () => {
        const prefs = {
            notesGit: { enabled: true, autoCommit: { enabled: false } },
        };
        await putJSON(repoUrl(repoId), prefs);
        const res = await getJSON(repoUrl(repoId));
        const body = JSON.parse(res.body);
        expect(body.notesGit).toEqual(prefs.notesGit);
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

    it('PATCH persists lastModels.note and deep-merges with other modes', async () => {
        await patchJSON(repoUrl(repoId), { lastModels: { task: 'gpt-4', ask: 'claude-3' } });
        const res = await patchJSON(repoUrl(repoId), { lastModels: { note: 'claude-sonnet-4.6' } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.lastModels).toEqual({ task: 'gpt-4', ask: 'claude-3', note: 'claude-sonnet-4.6' });
    });

    it('PATCH updating lastModels.note does not erase task or ask modes', async () => {
        await patchJSON(repoUrl(repoId), { lastModels: { task: 'gpt-4', ask: 'claude-3', plan: 'gemini' } });
        const res = await patchJSON(repoUrl(repoId), { lastModels: { note: 'my-model' } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.lastModels.task).toBe('gpt-4');
        expect(body.lastModels.ask).toBe('claude-3');
        expect(body.lastModels.plan).toBe('gemini');
        expect(body.lastModels.note).toBe('my-model');
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

    // -- activityFilters --

    it('PATCH persists activityFilters', async () => {
        const res = await patchJSON(repoUrl(repoId), { activityFilters: { statusFilter: 'running', typeFilter: 'chat' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).activityFilters).toEqual({ statusFilter: 'running', typeFilter: 'chat' });
        const get = await getJSON(repoUrl(repoId));
        expect(JSON.parse(get.body).activityFilters).toEqual({ statusFilter: 'running', typeFilter: 'chat' });
    });

    it('PATCH deep-merges activityFilters preserving existing fields', async () => {
        await patchJSON(repoUrl(repoId), { activityFilters: { statusFilter: 'running' } });
        const res = await patchJSON(repoUrl(repoId), { activityFilters: { typeFilter: 'chat' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).activityFilters).toEqual({ statusFilter: 'running', typeFilter: 'chat' });
    });

    it('PATCH activityFilters does not affect other per-repo fields', async () => {
        await putJSON(repoUrl(repoId), { lastModel: 'gpt-4' });
        const res = await patchJSON(repoUrl(repoId), { activityFilters: { statusFilter: 'completed' } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.lastModel).toBe('gpt-4');
        expect(body.activityFilters).toEqual({ statusFilter: 'completed' });
    });

    it('activityFilters are independent per-repo', async () => {
        await patchJSON(repoUrl(repoId), { activityFilters: { statusFilter: 'running' } });
        await patchJSON(repoUrl(repoId2), { activityFilters: { statusFilter: 'completed' } });

        const res1 = await getJSON(repoUrl(repoId));
        const res2 = await getJSON(repoUrl(repoId2));
        expect(JSON.parse(res1.body).activityFilters!.statusFilter).toBe('running');
        expect(JSON.parse(res2.body).activityFilters!.statusFilter).toBe('completed');
    });

    it('activityFilters survive server restart', async () => {
        await patchJSON(repoUrl(repoId), { activityFilters: { statusFilter: 'queued', typeFilter: 'run-workflow' } });
        await server.close();

        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;

        const res = await getJSON(repoUrl(repoId));
        expect(JSON.parse(res.body).activityFilters).toEqual({ statusFilter: 'queued', typeFilter: 'run-workflow' });
    });

    it('PUT activityFilters round-trips', async () => {
        const res = await putJSON(repoUrl(repoId), { activityFilters: { statusFilter: 'failed', typeFilter: 'ask' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).activityFilters).toEqual({ statusFilter: 'failed', typeFilter: 'ask' });
    });

    it('PATCH deep-merges defaultModels preserving existing per-mode values', async () => {
        await patchJSON(repoUrl(repoId), { defaultModels: { task: 'gpt-4' } });
        const res = await patchJSON(repoUrl(repoId), { defaultModels: { ask: 'claude-3' } });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.defaultModels).toEqual({ task: 'gpt-4', ask: 'claude-3' });
    });

    it('PATCH defaultModel sets repo-wide default', async () => {
        const res = await patchJSON(repoUrl(repoId), { defaultModel: 'gpt-5-mini' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).defaultModel).toBe('gpt-5-mini');
    });

    it('PATCH defaultModel empty string clears the value', async () => {
        await patchJSON(repoUrl(repoId), { defaultModel: 'gpt-4' });
        const res = await patchJSON(repoUrl(repoId), { defaultModel: '' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).defaultModel).toBeUndefined();
    });

    it('PATCH defaultModels empty string clears per-mode value', async () => {
        await patchJSON(repoUrl(repoId), { defaultModels: { task: 'gpt-4', ask: 'claude-3' } });
        const res = await patchJSON(repoUrl(repoId), { defaultModels: { task: '' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).defaultModels).toEqual({ ask: 'claude-3' });
    });

    it('PATCH does not affect defaultModel when patching other fields', async () => {
        await patchJSON(repoUrl(repoId), { defaultModel: 'gpt-4' });
        const res = await patchJSON(repoUrl(repoId), { lastDepth: 'deep' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.defaultModel).toBe('gpt-4');
        expect(body.lastDepth).toBe('deep');
    });
});

// ============================================================================
// resolveDefaultModel
// ============================================================================

describe('resolveDefaultModel', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-resolve-model-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns undefined when no preferences are set', () => {
        expect(resolveDefaultModel(tmpDir, 'ws-1', 'task')).toBeUndefined();
    });

    it('returns repo-wide defaultModel when no per-mode override exists', () => {
        writeRepoPreferences(tmpDir, 'ws-1', { defaultModel: 'gpt-4' });
        expect(resolveDefaultModel(tmpDir, 'ws-1', 'task')).toBe('gpt-4');
    });

    it('returns per-mode override when set', () => {
        writeRepoPreferences(tmpDir, 'ws-1', {
            defaultModel: 'gpt-4',
            defaultModels: { task: 'claude-sonnet-4.6' },
        });
        expect(resolveDefaultModel(tmpDir, 'ws-1', 'task')).toBe('claude-sonnet-4.6');
    });

    it('falls back to repo-wide defaultModel for modes without override', () => {
        writeRepoPreferences(tmpDir, 'ws-1', {
            defaultModel: 'gpt-4',
            defaultModels: { task: 'claude-sonnet-4.6' },
        });
        expect(resolveDefaultModel(tmpDir, 'ws-1', 'ask')).toBe('gpt-4');
    });

    it('returns undefined when mode is omitted and no defaultModel is set', () => {
        writeRepoPreferences(tmpDir, 'ws-1', { defaultModels: { task: 'gpt-4' } });
        expect(resolveDefaultModel(tmpDir, 'ws-1')).toBeUndefined();
    });

    it('returns defaultModel when mode is omitted and defaultModel is set', () => {
        writeRepoPreferences(tmpDir, 'ws-1', { defaultModel: 'gpt-4' });
        expect(resolveDefaultModel(tmpDir, 'ws-1')).toBe('gpt-4');
    });

    it('per-mode override for schedule mode works', () => {
        writeRepoPreferences(tmpDir, 'ws-1', {
            defaultModel: 'gpt-4',
            defaultModels: { schedule: 'gpt-5-mini' },
        });
        expect(resolveDefaultModel(tmpDir, 'ws-1', 'schedule')).toBe('gpt-5-mini');
    });

    it('per-mode override for memory mode works', () => {
        writeRepoPreferences(tmpDir, 'ws-1', {
            defaultModel: 'gpt-4',
            defaultModels: { memory: 'claude-haiku-4.5' },
        });
        expect(resolveDefaultModel(tmpDir, 'ws-1', 'memory')).toBe('claude-haiku-4.5');
    });

    it('per-mode override for followUp mode works', () => {
        writeRepoPreferences(tmpDir, 'ws-1', {
            defaultModel: 'gpt-4',
            defaultModels: { followUp: 'gpt-5.4' },
        });
        expect(resolveDefaultModel(tmpDir, 'ws-1', 'followUp')).toBe('gpt-5.4');
    });
});

// ============================================================================
// maxRalphIterations validation
// ============================================================================

describe('validatePerRepoPreferences — maxRalphIterations', () => {
    it('accepts a valid integer in range', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: 25 }).maxRalphIterations).toBe(25);
    });

    it('accepts the lower bound (1)', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: 1 }).maxRalphIterations).toBe(1);
    });

    it('accepts the upper bound (200)', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: 200 }).maxRalphIterations).toBe(200);
    });

    it('rejects 0', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: 0 }).maxRalphIterations).toBeUndefined();
    });

    it('rejects negative integers', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: -5 }).maxRalphIterations).toBeUndefined();
    });

    it('rejects values above 200', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: 201 }).maxRalphIterations).toBeUndefined();
    });

    it('rejects non-integer numbers', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: 10.5 }).maxRalphIterations).toBeUndefined();
    });

    it('rejects NaN', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: NaN }).maxRalphIterations).toBeUndefined();
    });

    it('rejects Infinity', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: Infinity }).maxRalphIterations).toBeUndefined();
    });

    it('rejects strings', () => {
        expect(validatePerRepoPreferences({ maxRalphIterations: '25' as any }).maxRalphIterations).toBeUndefined();
    });

    it('round-trips through write and read', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-ralph-iter-'));
        try {
            writeRepoPreferences(tmpDir, 'r', { maxRalphIterations: 42 });
            expect(readRepoPreferences(tmpDir, 'r').maxRalphIterations).toBe(42);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
