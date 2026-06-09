/**
 * LLM Tools Preferences Tests
 *
 * Tests for:
 * - validatePerRepoPreferences with disabledLlmTools
 * - readRepoPreferences/writeRepoPreferences with disabledLlmTools
 * - applyLlmToolPreferences from prompt-builder
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    validatePerRepoPreferences,
    readEffectiveDisabledLlmTools,
    writePreferences,
    readRepoPreferences,
    writeRepoPreferences,
} from '../../../src/server/preferences-handler';
import { getEffectiveDefaultDisabledTools } from '../../../src/server/llm-tools/llm-tool-registry';
import { applyLlmToolPreferences } from '../../../src/server/executors/prompt-builder';

// ============================================================================
// validatePerRepoPreferences — disabledLlmTools
// ============================================================================

describe('validatePerRepoPreferences — disabledLlmTools', () => {
    it('validates a valid disabledLlmTools array', () => {
        const result = validatePerRepoPreferences({
            disabledLlmTools: ['tavily_web_search', 'memory'],
        });
        expect(result.disabledLlmTools).toEqual(['tavily_web_search', 'memory']);
    });

    it('filters stale removed tool names from disabledLlmTools', () => {
        const result = validatePerRepoPreferences({
            disabledLlmTools: ['tavily_web_search', 'create_bug', 'memory'],
        });
        expect(result.disabledLlmTools).toEqual(['tavily_web_search', 'memory']);
    });

    it('allows empty array (all tools enabled)', () => {
        const result = validatePerRepoPreferences({
            disabledLlmTools: [],
        });
        expect(result.disabledLlmTools).toEqual([]);
    });

    it('filters out non-string entries', () => {
        const result = validatePerRepoPreferences({
            disabledLlmTools: ['tavily_web_search', 123, null, '', 'memory'],
        });
        expect(result.disabledLlmTools).toEqual(['tavily_web_search', 'memory']);
    });

    it('ignores disabledLlmTools when not an array', () => {
        const result = validatePerRepoPreferences({
            disabledLlmTools: 'not_an_array',
        });
        expect(result.disabledLlmTools).toBeUndefined();
    });

    it('does not affect other preferences fields', () => {
        const result = validatePerRepoPreferences({
            lastModel: 'gpt-4',
            disabledLlmTools: ['tavily_web_search'],
        });
        expect(result.lastModel).toBe('gpt-4');
        expect(result.disabledLlmTools).toEqual(['tavily_web_search']);
    });
});

// ============================================================================
// readRepoPreferences / writeRepoPreferences — disabledLlmTools round-trip
// ============================================================================

describe('readRepoPreferences / writeRepoPreferences — disabledLlmTools', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-tools-prefs-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('round-trips disabledLlmTools through write/read', () => {
        const wsId = 'test-ws-1';
        writeRepoPreferences(tmpDir, wsId, {
            disabledLlmTools: ['tavily_web_search', 'memory'],
        });
        const prefs = readRepoPreferences(tmpDir, wsId);
        expect(prefs.disabledLlmTools).toEqual(['tavily_web_search', 'memory']);
    });

    it('filters stale removed tool names when writing preferences', () => {
        const wsId = 'test-ws-stale-write';
        writeRepoPreferences(tmpDir, wsId, {
            disabledLlmTools: ['create_bug', 'memory'],
        });
        const prefs = readRepoPreferences(tmpDir, wsId);
        expect(prefs.disabledLlmTools).toEqual(['memory']);
    });

    it('round-trips empty array', () => {
        const wsId = 'test-ws-2';
        writeRepoPreferences(tmpDir, wsId, {
            disabledLlmTools: [],
        });
        const prefs = readRepoPreferences(tmpDir, wsId);
        expect(prefs.disabledLlmTools).toEqual([]);
    });

    it('returns undefined for disabledLlmTools when not set', () => {
        const wsId = 'test-ws-3';
        writeRepoPreferences(tmpDir, wsId, {
            lastModel: 'gpt-4',
        });
        const prefs = readRepoPreferences(tmpDir, wsId);
        expect(prefs.disabledLlmTools).toBeUndefined();
    });

    it('preserves other fields alongside disabledLlmTools', () => {
        const wsId = 'test-ws-4';
        writeRepoPreferences(tmpDir, wsId, {
            lastModel: 'gpt-4',
            disabledLlmTools: ['ask_user'],
        });
        const prefs = readRepoPreferences(tmpDir, wsId);
        expect(prefs.lastModel).toBe('gpt-4');
        expect(prefs.disabledLlmTools).toEqual(['ask_user']);
    });
});

// ============================================================================
// readEffectiveDisabledLlmTools
// ============================================================================

describe('readEffectiveDisabledLlmTools', () => {
    let tmpDir: string;
    const wsId = 'test-ws-effective';

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-tools-effective-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uses classic-mode defaults when no explicit repo preference exists', () => {
        writePreferences(tmpDir, { global: { uiLayoutMode: 'classic' } });

        expect(readEffectiveDisabledLlmTools(tmpDir, wsId)).toEqual(getEffectiveDefaultDisabledTools('classic'));
    });

    it('uses dev-workflow defaults when no explicit repo preference exists', () => {
        writePreferences(tmpDir, { global: { uiLayoutMode: 'dev-workflow' } });

        expect(readEffectiveDisabledLlmTools(tmpDir, wsId)).toEqual(getEffectiveDefaultDisabledTools('dev-workflow'));
    });

    it('uses classic-mode defaults when layout mode is not set', () => {
        expect(readEffectiveDisabledLlmTools(tmpDir, wsId)).toEqual(getEffectiveDefaultDisabledTools(undefined));
    });

    it('lets an explicit empty repo preference enable every tool in classic mode', () => {
        writePreferences(tmpDir, { global: { uiLayoutMode: 'classic' } });
        writeRepoPreferences(tmpDir, wsId, { disabledLlmTools: [] });

        expect(readEffectiveDisabledLlmTools(tmpDir, wsId)).toEqual([]);
    });

    it('filters stale create_bug from explicit repo preferences', () => {
        fs.mkdirSync(path.join(tmpDir, 'repos', wsId), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'repos', wsId, 'preferences.json'),
            JSON.stringify({ disabledLlmTools: ['create_bug', 'ask_user'] }),
        );

        expect(readEffectiveDisabledLlmTools(tmpDir, wsId)).toEqual(['ask_user']);
    });
});

// ============================================================================
// applyLlmToolPreferences
// ============================================================================

describe('applyLlmToolPreferences', () => {
    const makeTool = (name: string) => ({
        name,
        description: `${name} desc`,
        parameters: {},
        handler: async () => ({}),
    });

    it('filters tools by disabled list', () => {
        const addons = [
            { tools: [makeTool('suggest_follow_ups')], suffix: ' A' },
            { tools: [makeTool('tavily_web_search')], suffix: ' B' },
            { tools: [makeTool('memory')], suffix: ' C' },
        ];
        const result = applyLlmToolPreferences(addons, ['tavily_web_search']);
        expect(result.tools.map(t => t.name)).toEqual(['suggest_follow_ups', 'memory']);
        expect(result.toolGuidance).toBe(' A C');
    });

    it('uses default disabled list when undefined', () => {
        const addons = [
            { tools: [makeTool('suggest_follow_ups')], suffix: ' A' },
            { tools: [makeTool('tavily_web_search')], suffix: ' B' },
        ];
        const result = applyLlmToolPreferences(addons, undefined);
        expect(result.tools.map(t => t.name)).toEqual(['suggest_follow_ups']);
        expect(result.toolGuidance).toBe(' A');
    });

    it('keeps all tools when disabled list is empty', () => {
        const addons = [
            { tools: [makeTool('suggest_follow_ups')], suffix: ' A' },
            { tools: [makeTool('tavily_web_search')], suffix: ' B' },
        ];
        const result = applyLlmToolPreferences(addons, []);
        expect(result.tools.map(t => t.name)).toEqual(['suggest_follow_ups', 'tavily_web_search']);
        expect(result.toolGuidance).toBe(' A B');
    });

    it('removes suffix when all tools from an addon are disabled', () => {
        const addons = [
            { tools: [makeTool('suggest_follow_ups')], suffix: ' A' },
            { tools: [makeTool('tavily_web_search')], suffix: ' B' },
        ];
        const result = applyLlmToolPreferences(addons, ['tavily_web_search']);
        expect(result.toolGuidance).toBe(' A');
    });

    it('handles addon with multiple tools — partial filtering', () => {
        const addons = [
            { tools: [makeTool('search_conversations'), makeTool('get_conversation')], suffix: ' X' },
        ];
        const result = applyLlmToolPreferences(addons, ['get_conversation']);
        expect(result.tools.map(t => t.name)).toEqual(['search_conversations']);
        expect(result.toolGuidance).toBe(' X');
    });

    it('handles addon with multiple tools — all filtered', () => {
        const addons = [
            { tools: [makeTool('search_conversations'), makeTool('get_conversation')], suffix: ' X' },
        ];
        const result = applyLlmToolPreferences(addons, ['search_conversations', 'get_conversation']);
        expect(result.tools).toHaveLength(0);
        expect(result.toolGuidance).toBe('');
    });

    it('handles empty addons array', () => {
        const result = applyLlmToolPreferences([], ['tavily_web_search']);
        expect(result.tools).toHaveLength(0);
        expect(result.toolGuidance).toBe('');
    });

    it('handles addon with empty tools array', () => {
        const addons = [
            { tools: [] as any[], suffix: '' },
            { tools: [makeTool('memory')], suffix: ' M' },
        ];
        const result = applyLlmToolPreferences(addons, []);
        expect(result.tools.map(t => t.name)).toEqual(['memory']);
        expect(result.toolGuidance).toBe(' M');
    });
});
