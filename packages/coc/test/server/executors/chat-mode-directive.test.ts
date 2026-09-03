/**
 * The mode directive is the whole enforcement mechanism for ask mode (the tool
 * layer auto-approves Bash and file edits), so its content contract is pinned
 * here: what each mode emits, what a mode switch announces, and the fact that
 * a fresh autopilot chat emits nothing at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { READ_ONLY_SYSTEM_MESSAGE } from '@plusplusoneplusplus/forge';
import {
    CHAT_MODE_DIRECTIVE_TAG,
    MODE_SWITCHED_TO_AUTOPILOT_NOTE,
    buildChatModeDirective,
    buildChatModeDisplayBlock,
    loadChatModeInstructions,
    prependChatModeDirective,
    resolveFirstTurnDirectiveMode,
    shouldInjectChatModeDirective,
} from '../../../src/server/executors/chat-mode-directive';
import type { ChatModeInjectionCheck } from '../../../src/server/executors/chat-mode-directive';
import type { ChatMode } from '../../../src/server/tasks/task-types';

// ============================================================================
// buildChatModeDirective
// ============================================================================

describe('buildChatModeDirective', () => {
    it('emits the read-only prose in a tagged block for ask mode', () => {
        const directive = buildChatModeDirective({ mode: 'ask' })!;

        expect(directive.startsWith(`<${CHAT_MODE_DIRECTIVE_TAG}>`)).toBe(true);
        expect(directive.endsWith(`</${CHAT_MODE_DIRECTIVE_TAG}>`)).toBe(true);
        expect(directive).toContain(READ_ONLY_SYSTEM_MESSAGE.trim());
    });

    it('normalizes legacy plan mode to ask', () => {
        const plan = buildChatModeDirective({ mode: 'plan' as never })!;

        expect(plan).toBe(buildChatModeDirective({ mode: 'ask' }));
    });

    it('announces the switch when a chat leaves ask mode', () => {
        for (const mode of ['autopilot', 'ralph'] as const) {
            const directive = buildChatModeDirective({ mode, previousMode: 'ask' })!;

            expect(directive).toContain(MODE_SWITCHED_TO_AUTOPILOT_NOTE);
            expect(directive).not.toContain('coc-read-only-mode');
        }
    });

    it('says nothing on a fresh autopilot chat', () => {
        expect(buildChatModeDirective({ mode: 'autopilot' })).toBeUndefined();
        expect(buildChatModeDirective({ mode: 'autopilot', previousMode: 'autopilot' })).toBeUndefined();
        expect(buildChatModeDirective({ mode: 'ralph', previousMode: 'ralph' })).toBeUndefined();
    });

    it('drops the transition note once the chat has settled in autopilot', () => {
        // Re-announcing on every autopilot turn would be noise; the note is a
        // correction to what the model was told earlier, not standing guidance.
        expect(buildChatModeDirective({ mode: 'autopilot', previousMode: 'autopilot' })).toBeUndefined();
    });

    it('re-states the read-only block when a chat switches back to ask', () => {
        const directive = buildChatModeDirective({ mode: 'ask', previousMode: 'autopilot' })!;

        expect(directive).toContain(READ_ONLY_SYSTEM_MESSAGE.trim());
    });

    it('appends mode instructions after the mode prose', () => {
        const directive = buildChatModeDirective({
            mode: 'ask',
            modeInstructions: '<custom_instruction>\nASK-RULES\n</custom_instruction>',
        })!;

        expect(directive.indexOf('ASK-RULES')).toBeGreaterThan(directive.indexOf('read-only mode'));
    });

    it('carries mode instructions alone when the mode itself has nothing to say', () => {
        const directive = buildChatModeDirective({
            mode: 'autopilot',
            modeInstructions: 'AUTOPILOT-RULES',
        })!;

        expect(directive).toBe(`<${CHAT_MODE_DIRECTIVE_TAG}>\nAUTOPILOT-RULES\n</${CHAT_MODE_DIRECTIVE_TAG}>`);
    });

    it('ignores blank mode instructions', () => {
        expect(buildChatModeDirective({ mode: 'autopilot', modeInstructions: '   \n' })).toBeUndefined();
    });
});

// ============================================================================
// prependChatModeDirective
// ============================================================================

describe('prependChatModeDirective', () => {
    it('puts the directive in front of the prompt', () => {
        expect(prependChatModeDirective('do the thing', 'DIRECTIVE')).toBe('DIRECTIVE\n\ndo the thing');
    });

    it('is the identity when there is no directive', () => {
        const prompt = 'do the thing';

        expect(prependChatModeDirective(prompt, undefined)).toBe(prompt);
    });
});

// ============================================================================
// loadChatModeInstructions
// ============================================================================

describe('loadChatModeInstructions', () => {
    let repoDir: string;

    beforeEach(() => {
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mode-instructions-'));
        const instructionDir = path.join(repoDir, '.github', 'coc');
        fs.mkdirSync(instructionDir, { recursive: true });
        fs.writeFileSync(path.join(instructionDir, 'instructions.md'), 'SHARED-INSTRUCTIONS');
        fs.writeFileSync(path.join(instructionDir, 'instructions-ask.md'), 'ASK-ONLY-INSTRUCTIONS');
        fs.writeFileSync(path.join(instructionDir, 'instructions-autopilot.md'), 'AUTOPILOT-ONLY-INSTRUCTIONS');
    });

    afterEach(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it('loads only the mode half — the shared half stays in the system prompt', async () => {
        const ask = await loadChatModeInstructions(repoDir, 'ask');

        expect(ask).toContain('ASK-ONLY-INSTRUCTIONS');
        expect(ask).not.toContain('SHARED-INSTRUCTIONS');
    });

    it('maps ralph to the autopilot instruction file', async () => {
        const ralph = await loadChatModeInstructions(repoDir, 'ralph');

        expect(ralph).toContain('AUTOPILOT-ONLY-INSTRUCTIONS');
    });

    it('returns undefined without a working directory or mode', async () => {
        expect(await loadChatModeInstructions(undefined, 'ask')).toBeUndefined();
        expect(await loadChatModeInstructions(repoDir, undefined)).toBeUndefined();
    });

    it('returns undefined when the repo has no mode instruction file', async () => {
        const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-no-instructions-'));
        try {
            expect(await loadChatModeInstructions(emptyRepo, 'ask')).toBeUndefined();
        } finally {
            fs.rmSync(emptyRepo, { recursive: true, force: true });
        }
    });
});

// ============================================================================
// Chat-visible disclosure
// ============================================================================

describe('buildChatModeDisplayBlock', () => {
    it('discloses the mode prose but not the repo mode instructions', () => {
        const block = buildChatModeDisplayBlock({ mode: 'ask' })!;

        expect(block).toContain(READ_ONLY_SYSTEM_MESSAGE.trim());
        // Repo configuration is not conversation content — it would bury the
        // user's message in the bubble.
        expect(block).toBe(buildChatModeDirective({ mode: 'ask' }));
        expect(block).not.toBe(buildChatModeDirective({ mode: 'ask', modeInstructions: 'ASK-RULES' }));
    });

    it('has nothing to disclose on a fresh autopilot turn', () => {
        expect(buildChatModeDisplayBlock({ mode: 'autopilot' })).toBeUndefined();
    });
});

describe('resolveFirstTurnDirectiveMode', () => {
    /** A queued chat task, as `ProcessLifecycleRunner` sees it. */
    const chat = (extra: Record<string, unknown> = {}) => ({
        type: 'chat',
        payload: { kind: 'chat', prompt: 'hi', ...extra },
    });

    it('returns the chat mode for a plain chat', () => {
        expect(resolveFirstTurnDirectiveMode(chat({ mode: 'ask' }))).toBe('ask');
        expect(resolveFirstTurnDirectiveMode(chat({ mode: 'plan' }))).toBe('ask');
        expect(resolveFirstTurnDirectiveMode(chat({ mode: 'autopilot' }))).toBe('autopilot');
        // No mode at all is ask, matching normalizeChatModeOrDefault.
        expect(resolveFirstTurnDirectiveMode(chat())).toBe('ask');
    });

    it('pins the executors that hardcode ask, whatever the payload mode says', () => {
        expect(resolveFirstTurnDirectiveMode(chat({
            mode: 'autopilot',
            context: { commitChat: { sha: 'abc' } },
        }))).toBe('ask');
        expect(resolveFirstTurnDirectiveMode(chat({
            mode: 'autopilot',
            context: { classifyDiff: { repoId: 'r', prId: '1', headSha: 'sha' } },
        }))).toBe('ask');
        expect(resolveFirstTurnDirectiveMode(chat({
            mode: 'autopilot',
            context: { resolveComments: { documentUri: 'a.md', commentIds: ['c1'] } },
        }))).toBe('ask');
        expect(resolveFirstTurnDirectiveMode({
            type: 'pr-classification',
            payload: { kind: 'pr-classification', prompt: 'Classify' },
        })).toBe('ask');
    });

    it('returns undefined for the executors that send no directive', () => {
        // Over-claiming here would put a constraint in the transcript that the
        // model was never told.
        expect(resolveFirstTurnDirectiveMode(chat({ context: { noteChat: { notePath: 'n.md' } } }))).toBeUndefined();
        expect(resolveFirstTurnDirectiveMode(chat({ context: { noteCreate: { root: 'Notes' } } }))).toBeUndefined();
        expect(resolveFirstTurnDirectiveMode(chat({ context: { taskGeneration: { workspaceId: 'ws' } } }))).toBeUndefined();
        expect(resolveFirstTurnDirectiveMode(chat({ context: { replication: { templateId: 't' } } }))).toBeUndefined();
        expect(resolveFirstTurnDirectiveMode(chat({ context: { resolveDiffCommentsMulti: true } }))).toBeUndefined();
        expect(resolveFirstTurnDirectiveMode(chat({ mode: 'ralph' }))).toBeUndefined();
        expect(resolveFirstTurnDirectiveMode({ type: 'run-script', payload: { kind: 'run-script', script: 'ls' } })).toBeUndefined();
        expect(resolveFirstTurnDirectiveMode(undefined)).toBeUndefined();
        // Dreams runs its own internal steps through ProcessLifecycleRunner with
        // a chat-shaped payload, but never reaches a chat executor.
        expect(resolveFirstTurnDirectiveMode({
            type: 'dream-analyzer',
            payload: { kind: 'chat', mode: 'ask', prompt: 'Analyze these conversations.' },
        })).toBeUndefined();
    });
});

// ============================================================================
// shouldInjectChatModeDirective
// ============================================================================

describe('shouldInjectChatModeDirective', () => {
    const askMarker = buildChatModeDirective({ mode: 'ask' })!;
    const switchMarker = buildChatModeDirective({ mode: 'autopilot', previousMode: 'ask' })!;

    /** A user turn that carried the directive, with `marker` as its verbatim content. */
    const injected = (turnIndex: number, marker: string, timestamp = '2026-01-01T00:00:00.000Z') =>
        ({
            role: 'user' as const,
            content: 'hi',
            timestamp: new Date(timestamp),
            turnIndex,
            timeline: [],
            chatModeContext: marker,
        });

    const plain = (turnIndex: number, role: 'user' | 'assistant' = 'user') =>
        ({ role, content: 'x', timestamp: new Date('2026-01-01T00:00:00.000Z'), turnIndex, timeline: [] });

    const compactionNotice = (turnIndex: number) => ({ ...plain(turnIndex, 'assistant'), displayOnly: true });

    const cases: Array<{
        name: string;
        check: Partial<ChatModeInjectionCheck> & { mode: ChatMode };
        expected: boolean;
    }> = [
        {
            name: 'steady-state ask on a live session sends nothing',
            check: { mode: 'ask', previousMode: 'ask', turns: [injected(0, askMarker), plain(1, 'assistant')] },
            expected: false,
        },
        {
            name: 'signal 1: no resumable session re-injects',
            check: { mode: 'ask', previousMode: 'ask', turns: [injected(0, askMarker)], canResumeSession: false },
            expected: true,
        },
        {
            name: 'signal 2: autopilot -> ask re-injects',
            check: { mode: 'ask', previousMode: 'autopilot', turns: [injected(0, switchMarker)] },
            expected: true,
        },
        {
            name: 'signal 2: ask -> autopilot sends the switch note',
            check: { mode: 'autopilot', previousMode: 'ask', turns: [injected(0, askMarker)] },
            expected: true,
        },
        {
            name: 'steady-state autopilot after the switch note sends nothing',
            check: { mode: 'autopilot', previousMode: 'autopilot', turns: [injected(0, switchMarker)] },
            expected: false,
        },
        {
            name: 'signal 3: never injected re-injects',
            check: { mode: 'ask', previousMode: 'ask', turns: [plain(0), plain(1, 'assistant')] },
            expected: true,
        },
        {
            name: 'signal 4: a displayOnly compaction notice after the last injection re-injects',
            check: { mode: 'ask', previousMode: 'ask', turns: [injected(0, askMarker), compactionNotice(1)] },
            expected: true,
        },
        {
            name: 'signal 4: a completed compaction newer than the injection re-injects',
            check: {
                mode: 'ask',
                previousMode: 'ask',
                turns: [injected(0, askMarker, '2026-01-01T00:00:00.000Z')],
                compaction: { state: 'completed', completedAt: '2026-01-02T00:00:00.000Z' } as never,
            },
            expected: true,
        },
        {
            name: 'a completed compaction older than the injection is ignored',
            check: {
                mode: 'ask',
                previousMode: 'ask',
                turns: [injected(0, askMarker, '2026-01-03T00:00:00.000Z')],
                compaction: { state: 'completed', completedAt: '2026-01-02T00:00:00.000Z' } as never,
            },
            expected: false,
        },
        {
            name: 'signal 5: mode-instruction drift re-injects when the caller knows the instructions',
            check: {
                mode: 'ask',
                previousMode: 'ask',
                turns: [injected(0, buildChatModeDirective({ mode: 'ask', modeInstructions: 'old' })!)],
                modeInstructions: 'new',
                checkInstructionDrift: true,
            },
            expected: true,
        },
        {
            name: 'signal 5: unchanged instructions send nothing',
            check: {
                mode: 'ask',
                previousMode: 'ask',
                turns: [injected(0, buildChatModeDirective({ mode: 'ask', modeInstructions: 'same' })!)],
                modeInstructions: 'same',
                checkInstructionDrift: true,
            },
            expected: false,
        },
        {
            name: 'signal 5 is off for the display side, so drift is not disclosed',
            check: {
                mode: 'ask',
                previousMode: 'ask',
                turns: [injected(0, buildChatModeDirective({ mode: 'ask', modeInstructions: 'old' })!)],
            },
            expected: false,
        },
        {
            name: 'an instructions-only autopilot chat injects once',
            check: {
                mode: 'autopilot',
                previousMode: 'autopilot',
                turns: [plain(0)],
                modeInstructions: 'be terse',
                checkInstructionDrift: true,
            },
            expected: true,
        },
        {
            name: 'an instructions-only autopilot chat then sends nothing',
            check: {
                mode: 'autopilot',
                previousMode: 'autopilot',
                turns: [injected(0, buildChatModeDirective({ mode: 'autopilot', modeInstructions: 'be terse' })!)],
                modeInstructions: 'be terse',
                checkInstructionDrift: true,
            },
            expected: false,
        },
        {
            name: 'a bare autopilot turn has nothing to say, even on a cold resume',
            check: { mode: 'autopilot', previousMode: 'autopilot', turns: [], canResumeSession: false },
            expected: false,
        },
    ];

    for (const { name, check, expected } of cases) {
        it(name, () => {
            const decision = shouldInjectChatModeDirective({
                canResumeSession: true,
                compaction: undefined,
                turns: [],
                ...check,
            });
            expect(decision).toBe(expected);
        });
    }

    it('agrees with buildChatModeDirective on what a stable ask chat sends', () => {
        // Turn 1 injects, turns 2..N do not — AC-01 at the unit level.
        const turns: Array<ReturnType<typeof injected> | ReturnType<typeof plain>> = [];
        const sent: Array<string | undefined> = [];
        for (let turn = 0; turn < 4; turn++) {
            const inject = shouldInjectChatModeDirective({
                mode: 'ask',
                previousMode: turn === 0 ? undefined : 'ask',
                turns,
                compaction: undefined,
                canResumeSession: turn > 0,
            });
            const directive = inject ? buildChatModeDirective({ mode: 'ask' }) : undefined;
            sent.push(directive);
            turns.push(directive ? injected(turn, directive) : plain(turn));
        }

        expect(sent).toEqual([askMarker, undefined, undefined, undefined]);
    });
});
