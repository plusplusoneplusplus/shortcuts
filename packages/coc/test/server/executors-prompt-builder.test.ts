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

const mockCreateUpdateWorkItemTool = vi.fn(() => ({ tool: { name: 'create_update_work_item' } }));
vi.mock('../../src/server/llm-tools/create-update-work-item-tool', () => ({
    createCreateUpdateWorkItemTool: (...args: any[]) => mockCreateUpdateWorkItemTool(...args),
}));

import {
    buildForEachGenerationSystemMessage,
    buildModeSystemMessage,
    appendAutoFolderBlock,
    withRepoInstructions,
    findContextFileSuffix,
    extractPrompt,
    applySkillContent,
    prependSelectedSkillsDirective,
    resolveSelectedSkillReferences,
    buildConversationHistoryContext,
    buildFollowUpSuggestionsAddon,
    buildSearchConversationsAddon,
    buildCreateWorkItemAddon,
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

    it('ask-mode read-only message does not permit arbitrary file writes', () => {
        // The READ_ONLY_SYSTEM_MESSAGE must restrict general writes; only the plan
        // file and the attached note file are allowed exceptions.  This test is a
        // regression guard: if someone widens the message to allow broad writes the
        // real READ_ONLY_SYSTEM_MESSAGE (not the mock) should still contain the
        // restriction.  We verify the exported constant directly.
        const { READ_ONLY_SYSTEM_MESSAGE: realMsg } =
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('@plusplusoneplusplus/forge') as { READ_ONLY_SYSTEM_MESSAGE: string };
        expect(realMsg).toContain('read-only');
        // Must not grant blanket write access
        expect(realMsg).not.toMatch(/you may (create|write|modify) any file/i);
    });
});

describe('buildForEachGenerationSystemMessage', () => {
    it('describes a visible For Each generation chat with readable output and Advanced JSON', () => {
        const result = buildForEachGenerationSystemMessage({
            kind: 'generation',
            workspaceId: 'ws-1',
            generationId: 'for-each-gen-1',
            childMode: 'ask',
            originalRequest: 'Split this work into tasks',
            status: 'draft',
        });

        expect(result?.mode).toBe('append');
        expect(result?.content).toContain('visible CoC For Each item-plan generation chat');
        expect(result?.content).toContain('Advanced JSON');
        expect(result?.content).toContain('Child chat mode for proposed items: ask');
        expect(result?.content).toContain('do not start child chats');
    });
});

// ============================================================================
// appendAutoFolderBlock — ask mode with notes/Plans context
// ============================================================================

describe('appendAutoFolderBlock — ask mode uses notes/Plans path', () => {
    it('forwards notes/Plans tasksRoot when ask-mode auto-folder context is provided', () => {
        mockBuildAutoFolderLocationBlock.mockReturnValueOnce('ask-plan-save-block');
        const msg = buildModeSystemMessage('ask');
        // Simulate the context that resolveAutoFolderContext now returns for ask mode
        const ctx = { tasksRoot: '/home/user/.coc/repos/ws/notes/Plans', existingFolders: [] };
        const result = appendAutoFolderBlock(msg, ctx);
        expect(result!.content).toContain('ask-plan-save-block');
        expect(mockBuildAutoFolderLocationBlock).toHaveBeenCalledWith(
            '/home/user/.coc/repos/ws/notes/Plans',
            [],
        );
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

    it('enriches prompt with commit hash and message for commitChat context', () => {
        const task = makeTask({
            kind: 'chat', mode: 'ask', prompt: 'Explain this change',
            context: { commitChat: { commitHash: 'abc123', commitMessage: 'fix: null check' } },
        });
        const result = extractPrompt(task);
        expect(result).toContain("I'm asking about git commit abc123.");
        expect(result).toContain('Commit message: fix: null check');
        expect(result).toContain('Explain this change');
    });

    it('omits commit message line when not provided', () => {
        const task = makeTask({
            kind: 'chat', mode: 'ask', prompt: 'What changed?',
            context: { commitChat: { commitHash: 'abc123' } },
        });
        const result = extractPrompt(task);
        expect(result).toContain("I'm asking about git commit abc123.");
        expect(result).not.toContain('Commit message:');
        expect(result).toContain('What changed?');
    });

    it('uses displayName fallback for commitChat context with empty prompt', () => {
        const task = makeTask({
            kind: 'chat', mode: 'ask', prompt: '',
            context: { commitChat: { commitHash: 'abc123' } },
        }, 'Commit Chat');
        const result = extractPrompt(task);
        expect(result).toContain("I'm asking about git commit abc123.");
        expect(result).toContain('Commit Chat');
    });

    it('enriches prompt with PR number and title for pullRequestChat context', () => {
        const task = makeTask({
            kind: 'chat', mode: 'ask', prompt: 'Can this merge today?',
            context: { pullRequestChat: { prId: '142', prNumber: 142, prTitle: 'Add retry logic' } },
        });
        const result = extractPrompt(task);
        expect(result).toContain("I'm asking about pull request #142.");
        expect(result).toContain('PR title: Add retry logic');
        expect(result).toContain('Can this merge today?');
    });

    it('falls back to prId label when prNumber is missing for pullRequestChat', () => {
        const task = makeTask({
            kind: 'chat', mode: 'ask', prompt: 'What changed?',
            context: { pullRequestChat: { prId: 'PR-ABC' } },
        });
        const result = extractPrompt(task);
        expect(result).toContain("I'm asking about pull request PR-ABC.");
        expect(result).not.toContain('PR title:');
        expect(result).toContain('What changed?');
    });

    it('uses displayName fallback for pullRequestChat context with empty prompt', () => {
        const task = makeTask({
            kind: 'chat', mode: 'ask', prompt: '',
            context: { pullRequestChat: { prId: '500', prNumber: 500 } },
        }, 'PR Chat');
        const result = extractPrompt(task);
        expect(result).toContain("I'm asking about pull request #500.");
        expect(result).toContain('PR Chat');
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

describe('prependSelectedSkillsDirective', () => {
    it('returns prompt unchanged when no skills are selected', () => {
        expect(prependSelectedSkillsDirective('Hello')).toBe('Hello');
    });

    it('adds a directive for explicitly selected skills', () => {
        const result = prependSelectedSkillsDirective('Do work', ['impl', 'review']);
        expect(result).toContain('<selected_skills>');
        expect(result).toContain('The user explicitly selected these skills: impl, review.');
        expect(result).toContain('Do work');
    });

    it('deduplicates repeated skill names', () => {
        const result = prependSelectedSkillsDirective('Do work', ['impl', 'impl', 'review']);
        expect(result).toContain('The user explicitly selected these skills: impl, review.');
    });

    it('includes selected skill file paths when references are available', () => {
        const result = prependSelectedSkillsDirective('Do work', ['impl'], [
            { name: 'impl', skillFilePath: '/repo/.github/skills/impl/SKILL.md' },
        ]);
        expect(result).toContain('Load the selected skill instructions from these SKILL.md files before proceeding:');
        expect(result).toContain('- impl: /repo/.github/skills/impl/SKILL.md');
        expect(result).not.toContain('<skill name=');
    });
});

describe('resolveSelectedSkillReferences', () => {
    beforeEach(() => {
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReset();
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    });

    it('returns the first matching SKILL.md path in directory order', () => {
        (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((candidate: string) =>
            candidate === path.join('/global/skills', 'impl', 'SKILL.md'),
        );

        const result = resolveSelectedSkillReferences(
            ['impl'],
            ['/repo/.github/skills', '/global/skills'],
        );

        expect(result).toEqual([
            { name: 'impl', skillFilePath: path.join('/global/skills', 'impl', 'SKILL.md') },
        ]);
    });

    it('deduplicates selected skills and skips disabled skills', () => {
        (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

        const result = resolveSelectedSkillReferences(
            ['impl', 'impl', 'draft'],
            ['/skills'],
            ['draft'],
        );

        expect(result).toEqual([
            { name: 'impl', skillFilePath: path.join('/skills', 'impl', 'SKILL.md') },
        ]);
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

// ============================================================================
// buildSearchConversationsAddon
// ============================================================================

describe('buildSearchConversationsAddon', () => {
    it('returns empty tools and suffix when store does not support searchConversations', () => {
        const store = {} as any; // no searchConversations method
        const result = buildSearchConversationsAddon(store);
        expect(result.tools).toEqual([]);
        expect(result.suffix).toBe('');
    });

    it('returns search_conversations and get_conversation tools when store supports searchConversations', () => {
        const store = { searchConversations: vi.fn() } as any;
        const result = buildSearchConversationsAddon(store, 'ws-1');
        expect(result.tools).toHaveLength(2);
        const names = result.tools.map(t => t.name).sort();
        expect(names).toEqual(['get_conversation', 'search_conversations']);
        expect(result.suffix).toContain('search_conversations');
        expect(result.suffix).toContain('get_conversation');
    });

    it('suffix mentions past conversation history', () => {
        const store = { searchConversations: vi.fn() } as any;
        const result = buildSearchConversationsAddon(store);
        expect(result.suffix).toContain('conversation-history');
    });
});

// ============================================================================
// buildCreateWorkItemAddon
// ============================================================================

describe('buildCreateWorkItemAddon', () => {
    beforeEach(() => {
        mockCreateUpdateWorkItemTool.mockReset();
        mockCreateUpdateWorkItemTool.mockReturnValue({ tool: { name: 'create_update_work_item' } });
    });

    it('returns empty tools when dataDir is undefined', () => {
        const result = buildCreateWorkItemAddon(undefined, 'repo-1');
        expect(result.tools).toEqual([]);
        expect(result.suffix).toBe('');
    });

    it('returns empty tools when repoId is undefined', () => {
        const result = buildCreateWorkItemAddon('/data', undefined);
        expect(result.tools).toEqual([]);
        expect(result.suffix).toBe('');
    });

    it('returns only the unified create_update_work_item tool', () => {
        const result = buildCreateWorkItemAddon('/data', 'repo-1');
        expect(result.tools).toHaveLength(1);
        expect(result.tools[0].name).toBe('create_update_work_item');
        expect(result.tools.map(t => t.name)).not.toContain('update_work_item');
        expect(result.tools.map(t => t.name)).not.toContain('create_bug');
    });

    it('passes dataDir, repoId, and broadcastFn to factories', () => {
        const broadcast = vi.fn();
        buildCreateWorkItemAddon('/data', 'repo-1', broadcast);
        expect(mockCreateUpdateWorkItemTool).toHaveBeenCalledWith('/data', 'repo-1', broadcast);
    });

});

// ============================================================================
// systemMessageBuilder
// ============================================================================

import { systemMessageBuilder } from '../../src/server/executors/system-message-builder';

describe('systemMessageBuilder', () => {
    beforeEach(() => {
        mockLoadInstructions.mockReset();
        mockBuildAutoFolderLocationBlock.mockReset();
        mockBuildAutoFolderLocationBlock.mockReturnValue('auto-folder-block');
        mockToForwardSlashes.mockImplementation((p: string) => p.replace(/\\/g, '/'));
    });

    // -------------------------------------------------------------------------
    // .append()
    // -------------------------------------------------------------------------

    it('returns undefined when nothing is appended', async () => {
        const result = await systemMessageBuilder().build();
        expect(result).toBeUndefined();
    });

    it('returns a system message for a single string block', async () => {
        const result = await systemMessageBuilder().append('Hello').build();
        expect(result).toEqual({ mode: 'append', content: 'Hello' });
    });

    it('skips undefined blocks from .append()', async () => {
        const result = await systemMessageBuilder().append(undefined).build();
        expect(result).toBeUndefined();
    });

    it('skips empty-string blocks from .append()', async () => {
        const result = await systemMessageBuilder().append('').build();
        expect(result).toBeUndefined();
    });

    it('joins multiple blocks with double newlines', async () => {
        const result = await systemMessageBuilder()
            .append('Block A')
            .append('Block B')
            .build();
        expect(result!.content).toBe('Block A\n\nBlock B');
    });

    // -------------------------------------------------------------------------
    // .withRepoInstructions()
    // -------------------------------------------------------------------------

    it('appends repo instructions when loadInstructions returns content', async () => {
        mockLoadInstructions.mockResolvedValue('repo instructions');
        const result = await systemMessageBuilder()
            .withRepoInstructions('/repo', 'ask')
            .build();
        expect(result!.content).toBe('repo instructions');
    });

    it('is a no-op when workingDir is undefined', async () => {
        const result = await systemMessageBuilder()
            .withRepoInstructions(undefined, 'ask')
            .build();
        expect(result).toBeUndefined();
        expect(mockLoadInstructions).not.toHaveBeenCalled();
    });

    it('is a no-op when mode is undefined', async () => {
        const result = await systemMessageBuilder()
            .withRepoInstructions('/repo', undefined)
            .build();
        expect(result).toBeUndefined();
        expect(mockLoadInstructions).not.toHaveBeenCalled();
    });

    it('is a no-op when loadInstructions returns undefined', async () => {
        mockLoadInstructions.mockResolvedValue(undefined);
        const result = await systemMessageBuilder()
            .withRepoInstructions('/repo', 'ask')
            .build();
        expect(result).toBeUndefined();
    });

    it('is a no-op when loadInstructions throws', async () => {
        mockLoadInstructions.mockRejectedValue(new Error('fail'));
        const result = await systemMessageBuilder()
            .append('base')
            .withRepoInstructions('/repo', 'ask')
            .build();
        expect(result!.content).toBe('base');
    });

    // -------------------------------------------------------------------------
    // .appendToolGuidance()
    // -------------------------------------------------------------------------

    it('appends a tool-guidance block as eager content', async () => {
        const result = await systemMessageBuilder()
            .appendToolGuidance('Use the foo_tool for X.')
            .build();
        expect(result!.content).toBe('Use the foo_tool for X.');
    });

    it('joins tool guidance after prior content', async () => {
        const result = await systemMessageBuilder()
            .append('base instructions')
            .appendToolGuidance('Use the foo_tool for X.')
            .build();
        expect(result!.content).toBe('base instructions\n\nUse the foo_tool for X.');
    });

    it('is a no-op when tool-guidance block is undefined', async () => {
        const result = await systemMessageBuilder()
            .append('base')
            .appendToolGuidance(undefined)
            .build();
        expect(result!.content).toBe('base');
    });

    it('is a no-op when tool-guidance block is empty string', async () => {
        const result = await systemMessageBuilder()
            .append('base')
            .appendToolGuidance('')
            .build();
        expect(result!.content).toBe('base');
    });

    it('is a no-op when tool-guidance block is whitespace-only', async () => {
        const result = await systemMessageBuilder()
            .append('base')
            .appendToolGuidance('   \n\n  ')
            .build();
        expect(result!.content).toBe('base');
    });

    it('places tool guidance before auto-folder in the canonical chain', async () => {
        const ctx = { tasksRoot: '/tasks', existingFolders: ['feat1'] };
        const result = await systemMessageBuilder()
            .append('base')
            .appendToolGuidance('Use foo_tool.')
            .appendAutoFolder(ctx)
            .build();
        const content = result!.content;
        expect(content.indexOf('Use foo_tool.')).toBeLessThan(content.indexOf('auto-folder-block'));
    });

    // -------------------------------------------------------------------------
    // .appendAutoFolder()
    // -------------------------------------------------------------------------

    it('appends auto-folder block when prior content exists', async () => {
        const ctx = { tasksRoot: '/tasks', existingFolders: ['feat1'] };
        const result = await systemMessageBuilder()
            .append('base')
            .appendAutoFolder(ctx)
            .build();
        expect(result!.content).toBe('base\n\nauto-folder-block');
        expect(mockBuildAutoFolderLocationBlock).toHaveBeenCalledWith('/tasks', ['feat1']);
    });

    it('is a no-op when no prior content exists (preserves legacy behavior)', async () => {
        const ctx = { tasksRoot: '/tasks', existingFolders: [] };
        const result = await systemMessageBuilder()
            .appendAutoFolder(ctx)
            .build();
        expect(result).toBeUndefined();
    });

    it('is a no-op when ctx is undefined', async () => {
        const result = await systemMessageBuilder()
            .append('base')
            .appendAutoFolder(undefined)
            .build();
        expect(result!.content).toBe('base');
    });

    it('passes tasksRoot through toForwardSlashes', async () => {
        const ctx = { tasksRoot: 'C:\\tasks\\root', existingFolders: [] };
        await systemMessageBuilder().append('base').appendAutoFolder(ctx).build();
        expect(mockToForwardSlashes).toHaveBeenCalledWith('C:\\tasks\\root');
    });

    // -------------------------------------------------------------------------
    // .appendNoteFile()
    // -------------------------------------------------------------------------

    it('appendNoteFile appends note-file directive when prior content exists', async () => {
        const result = await systemMessageBuilder()
            .append('READ_ONLY')
            .appendNoteFile('notes/my-note.md')
            .build();
        expect(result!.content).toContain('notes/my-note.md');
        expect(result!.content).toContain('You may also edit the attached note file');
    });

    it('appendNoteFile is a no-op when notePath is undefined', async () => {
        const result = await systemMessageBuilder()
            .append('base')
            .appendNoteFile(undefined)
            .build();
        expect(result!.content).toBe('base');
    });

    it('appendNoteFile is a conditional step: no-op when no prior content exists', async () => {
        const result = await systemMessageBuilder()
            .appendNoteFile('notes/my-note.md')
            .build();
        expect(result).toBeUndefined();
    });

    it('appendNoteFile appears after autoFolder in the full chain', async () => {
        const ctx = { tasksRoot: '/tasks', existingFolders: [] };
        const result = await systemMessageBuilder()
            .append('READ_ONLY')
            .appendAutoFolder(ctx)
            .appendNoteFile('notes/my-note.md')
            .build();
        const content = result!.content;
        const folderIdx = content.indexOf('auto-folder-block');
        const noteIdx = content.indexOf('notes/my-note.md');
        expect(folderIdx).toBeGreaterThan(-1);
        expect(noteIdx).toBeGreaterThan(folderIdx);
    });

    // -------------------------------------------------------------------------
    // Full chain — ordering mirrors the legacy nesting
    // -------------------------------------------------------------------------

    it('produces content in insertion order: base → repoInstructions → autoFolder → noteFile', async () => {
        mockLoadInstructions.mockResolvedValue('repo-instructions');
        const ctx = { tasksRoot: '/tasks', existingFolders: [] };

        const result = await systemMessageBuilder()
            .append('READ_ONLY')
            .withRepoInstructions('/repo', 'ask')
            .appendAutoFolder(ctx)
            .appendNoteFile('notes/my-note.md')
            .build();

        const content = result!.content;
        const baseIdx = content.indexOf('READ_ONLY');
        const repoIdx = content.indexOf('repo-instructions');
        const folderIdx = content.indexOf('auto-folder-block');
        const noteIdx = content.indexOf('notes/my-note.md');

        expect(baseIdx).toBeGreaterThan(-1);
        expect(repoIdx).toBeGreaterThan(baseIdx);
        expect(folderIdx).toBeGreaterThan(repoIdx);
        expect(noteIdx).toBeGreaterThan(folderIdx);
    });

    it('always returns mode: append', async () => {
        const result = await systemMessageBuilder().append('x').build();
        expect(result!.mode).toBe('append');
    });
});
