/**
 * Prompt Builder Tests (executors/prompt-builder)
 *
 * Unit tests for all exported pure functions:
 * - buildModeSystemMessage
 * - withRepoInstructions
 * - findContextFileSuffix
 * - extractPrompt
 * - applySkillContent
 * - buildConversationHistoryContext
 * - buildFollowUpSuggestionsAddon
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
    };
});

const mockLoadInstructions = vi.fn();
const mockBuildFollowPromptText = vi.fn((opts: any) => {
    if (opts.promptFilePath) return `Follow prompt: ${opts.promptFilePath}`;
    return opts.promptContent ?? '';
});
const mockBuildAutoFolderLocationBlock = vi.fn(() => 'auto-folder-block');
const mockToForwardSlashes = vi.fn((p: string) => p.replace(/\\/g, '/'));
const mockToNativePath = vi.fn((p: string) => p);

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        loadInstructions: (...args: any[]) => mockLoadInstructions(...args),
        buildFollowPromptText: (...args: any[]) => mockBuildFollowPromptText(...args),
        buildAutoFolderLocationBlock: (...args: any[]) => mockBuildAutoFolderLocationBlock(...args),
        toForwardSlashes: (...args: any[]) => mockToForwardSlashes(...args),
        toNativePath: (...args: any[]) => mockToNativePath(...args),
        READ_ONLY_SYSTEM_MESSAGE: 'READ_ONLY',
    };
});

const mockCreateSuggestFollowUpsTool = vi.fn(() => ({ name: 'suggest_follow_ups' }));
vi.mock('../../src/server/suggest-follow-ups-tool', () => ({
    createSuggestFollowUpsTool: () => mockCreateSuggestFollowUpsTool(),
}));

import {
    buildModeSystemMessage,
    appendAutoFolderBlock,
    withRepoInstructions,
    findContextFileSuffix,
    extractPrompt,
    applySkillContent,
    buildConversationHistoryContext,
    buildFollowUpSuggestionsAddon,
} from '../../src/server/executors/prompt-builder';

// ============================================================================
// buildModeSystemMessage
// ============================================================================

describe('buildModeSystemMessage', () => {
    it('returns undefined for autopilot mode', () => {
        expect(buildModeSystemMessage('autopilot')).toBeUndefined();
    });

    it('returns undefined for undefined mode', () => {
        expect(buildModeSystemMessage(undefined)).toBeUndefined();
    });

    it('returns system message for ask mode', () => {
        const result = buildModeSystemMessage('ask');
        expect(result).toBeDefined();
        expect(result!.mode).toBe('append');
        expect(result!.content).toContain('READ_ONLY');
    });

    it('returns system message for plan mode', () => {
        const result = buildModeSystemMessage('plan');
        expect(result).toBeDefined();
        expect(result!.mode).toBe('append');
    });

    it('does NOT include auto-folder block (use appendAutoFolderBlock separately)', () => {
        const result = buildModeSystemMessage('ask');
        expect(result!.content).not.toContain('auto-folder-block');
    });
});

// ============================================================================
// appendAutoFolderBlock
// ============================================================================

describe('appendAutoFolderBlock', () => {
    it('returns original when autoFolderContext is undefined', () => {
        const msg = { mode: 'append' as const, content: 'base' };
        expect(appendAutoFolderBlock(msg, undefined)).toBe(msg);
    });

    it('returns undefined when systemMessage is undefined', () => {
        const ctx = { tasksRoot: '/tasks', existingFolders: ['feat1'] };
        expect(appendAutoFolderBlock(undefined, ctx)).toBeUndefined();
    });

    it('appends auto-folder block to system message', () => {
        const msg = { mode: 'append' as const, content: 'base' };
        const ctx = { tasksRoot: '/tasks', existingFolders: ['feat1'] };
        const result = appendAutoFolderBlock(msg, ctx);
        expect(result!.content).toContain('base');
        expect(result!.content).toContain('auto-folder-block');
    });

    it('auto-folder block appears after repo instructions when used with withRepoInstructions', async () => {
        mockLoadInstructions.mockResolvedValue('repo custom instructions with Save to D:/projects/shortcuts');
        const ctx = { tasksRoot: '/tasks', existingFolders: ['feat1'] };

        const withRepo = await withRepoInstructions(
            buildModeSystemMessage('plan'),
            '/some/dir',
            'plan',
        );
        const result = appendAutoFolderBlock(withRepo, ctx);

        const content = result!.content;
        const repoIdx = content.indexOf('repo custom instructions');
        const folderIdx = content.indexOf('auto-folder-block');
        expect(repoIdx).toBeGreaterThan(-1);
        expect(folderIdx).toBeGreaterThan(-1);
        expect(folderIdx).toBeGreaterThan(repoIdx);
    });
});

// ============================================================================
// withRepoInstructions
// ============================================================================

describe('withRepoInstructions', () => {
    beforeEach(() => {
        mockLoadInstructions.mockReset();
    });

    it('returns original systemMessage when no working directory', async () => {
        const msg = { mode: 'append' as const, content: 'base' };
        const result = await withRepoInstructions(msg, undefined, 'ask');
        expect(result).toBe(msg);
    });

    it('returns original systemMessage when no mode', async () => {
        const msg = { mode: 'append' as const, content: 'base' };
        const result = await withRepoInstructions(msg, '/some/dir', undefined);
        expect(result).toBe(msg);
    });

    it('returns original systemMessage when loadInstructions returns undefined', async () => {
        mockLoadInstructions.mockResolvedValue(undefined);
        const msg = { mode: 'append' as const, content: 'base' };
        const result = await withRepoInstructions(msg, '/dir', 'ask');
        expect(result).toBe(msg);
    });

    it('appends instructions to existing system message', async () => {
        mockLoadInstructions.mockResolvedValue('extra instructions');
        const msg = { mode: 'append' as const, content: 'base' };
        const result = await withRepoInstructions(msg, '/dir', 'ask');
        expect(result!.content).toBe('base\n\nextra instructions');
    });

    it('creates new system message when none provided', async () => {
        mockLoadInstructions.mockResolvedValue('only instructions');
        const result = await withRepoInstructions(undefined, '/dir', 'plan');
        expect(result!.content).toBe('only instructions');
        expect(result!.mode).toBe('append');
    });

    it('returns original when loadInstructions throws', async () => {
        mockLoadInstructions.mockRejectedValue(new Error('fail'));
        const msg = { mode: 'append' as const, content: 'base' };
        const result = await withRepoInstructions(msg, '/dir', 'ask');
        expect(result).toBe(msg);
    });
});

// ============================================================================
// findContextFileSuffix
// ============================================================================

describe('findContextFileSuffix', () => {
    it('returns undefined when planFilePath is undefined', () => {
        expect(findContextFileSuffix(undefined)).toBeUndefined();
    });

    it('returns undefined when CONTEXT.md does not exist', () => {
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
        expect(findContextFileSuffix('/some/plan.md')).toBeUndefined();
    });

    it('returns context suffix when CONTEXT.md exists', () => {
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
        mockToNativePath.mockReturnValue('/some/CONTEXT.md');
        const result = findContextFileSuffix('/some/plan.md');
        expect(result).toContain('CONTEXT.md');
        expect(result).toMatch(/See context details in/);
    });
});

// ============================================================================
// extractPrompt
// ============================================================================

describe('extractPrompt', () => {
    const makeTask = (payload: any, displayName?: string): any => ({
        id: 't1',
        type: payload.kind === 'chat' ? 'chat' : payload.kind,
        priority: 'normal',
        status: 'queued',
        displayName,
        config: {},
        payload,
    });

    it('returns run-workflow prompt', () => {
        const task = makeTask({ kind: 'run-workflow', workflowPath: '/flows/my-flow', workingDirectory: '/' });
        const result = extractPrompt(task);
        expect(result).toBe('Run workflow: my-flow');
    });

    it('returns run-script prompt', () => {
        const task = makeTask({ kind: 'run-script', script: 'echo hello' });
        const result = extractPrompt(task);
        expect(result).toBe('Run script: `echo hello`');
    });

    it('returns chat payload prompt', () => {
        const task = makeTask({ kind: 'chat', mode: 'ask', prompt: 'What is X?' });
        const result = extractPrompt(task);
        expect(result).toBe('What is X?');
    });

    it('uses displayName as fallback for empty chat prompt', () => {
        const task = makeTask({ kind: 'chat', mode: 'ask', prompt: '' }, 'My Task');
        const result = extractPrompt(task);
        expect(result).toBe('My Task');
    });

    it('returns task-generation prompt as-is', () => {
        const task = makeTask({
            kind: 'chat', mode: 'autopilot', prompt: 'Generate tasks',
            context: { taskGeneration: { targetFolder: 'feat' } },
        });
        expect(extractPrompt(task)).toBe('Generate tasks');
    });

    it('builds follow-prompt text for context.files', () => {
        const task = makeTask({
            kind: 'chat', mode: 'autopilot', prompt: 'do it',
            context: { files: ['/path/to/prompt.md'] },
        });
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
        const result = extractPrompt(task);
        expect(result).toContain('/path/to/prompt.md');
    });

    it('falls back to displayName for unknown type', () => {
        const task = makeTask({ kind: 'unknown-type' }, 'My Display');
        const result = extractPrompt(task);
        expect(result).toBe('My Display');
    });
});

// ============================================================================
// applySkillContent
// ============================================================================

describe('applySkillContent', () => {
    const makeTask = (skills: string[]): any => ({
        id: 't1', type: 'chat', priority: 'normal', status: 'queued', config: {},
        payload: { kind: 'chat', mode: 'ask', prompt: '', context: { skills } },
    });

    it('returns prompt unchanged when no skills', () => {
        const task = makeTask([]);
        expect(applySkillContent('Hello', task)).toBe('Hello');
    });

    it('returns prompt unchanged when skills are present (applied via skillDirectories)', () => {
        const task = makeTask(['impl', 'code-review']);
        const result = applySkillContent('Do work', task);
        expect(result).toBe('Do work');
    });

    it('returns prompt when payload has no context', () => {
        const task: any = { id: 't1', type: 'chat', priority: 'normal', status: 'queued', config: {}, payload: { kind: 'chat' } };
        expect(applySkillContent('Hello', task)).toBe('Hello');
    });
});

// ============================================================================
// buildConversationHistoryContext
// ============================================================================

describe('buildConversationHistoryContext', () => {
    it('returns undefined for empty turns', () => {
        expect(buildConversationHistoryContext([])).toBeUndefined();
        expect(buildConversationHistoryContext(undefined)).toBeUndefined();
    });

    it('wraps turns in conversation_history tags', () => {
        const turns = [
            { role: 'user' as const, content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant' as const, content: 'Hi!', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ];
        const result = buildConversationHistoryContext(turns);
        expect(result).toContain('<conversation_history>');
        expect(result).toContain('[User]: Hello');
        expect(result).toContain('[Assistant]: Hi!');
        expect(result).toContain('</conversation_history>');
    });

    it('truncates long assistant responses at 2000 chars', () => {
        const longContent = 'x'.repeat(2100);
        const turns = [
            { role: 'assistant' as const, content: longContent, timestamp: new Date(), turnIndex: 0, timeline: [] },
        ];
        const result = buildConversationHistoryContext(turns);
        expect(result).toContain('(truncated)');
        const assistantLine = result!.split('\n').find(l => l.startsWith('[Assistant]:'))!;
        expect(assistantLine.length).toBeLessThan(2200);
    });

    it('does not truncate user messages', () => {
        const longContent = 'y'.repeat(2100);
        const turns = [
            { role: 'user' as const, content: longContent, timestamp: new Date(), turnIndex: 0, timeline: [] },
        ];
        const result = buildConversationHistoryContext(turns);
        expect(result).not.toContain('(truncated)');
    });
});

// ============================================================================
// buildFollowUpSuggestionsAddon
// ============================================================================

describe('buildFollowUpSuggestionsAddon', () => {
    beforeEach(() => {
        mockCreateSuggestFollowUpsTool.mockReset();
        mockCreateSuggestFollowUpsTool.mockReturnValue({ name: 'suggest_follow_ups' });
    });

    it('returns empty tools and suffix when disabled', () => {
        const result = buildFollowUpSuggestionsAddon(false, 3);
        expect(result.tools).toEqual([]);
        expect(result.suffix).toBe('');
    });

    it('returns tool and suffix when enabled', () => {
        const result = buildFollowUpSuggestionsAddon(true, 3);
        expect(result.tools).toHaveLength(1);
        expect(result.suffix).toContain('3 suggestions');
    });

    it('uses the count parameter in the suffix', () => {
        const result = buildFollowUpSuggestionsAddon(true, 5);
        expect(result.suffix).toContain('5 suggestions');
    });
});
