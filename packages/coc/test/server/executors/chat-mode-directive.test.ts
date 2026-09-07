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
    PLAN_SAVE_GUIDANCE_INTRO,
    buildChatModeDirective,
    buildChatModeDisplayBlock,
    loadChatModeInstructions,
    parseChatModeMarker,
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

// ============================================================================
// Plan save guidance nested inside the read-only section
// ============================================================================

describe('plan save guidance', () => {
    const ctx = (existingFolders: string[], tasksRoot = '/data/repos/ws-a/notes/Plans') =>
        ({ tasksRoot, existingFolders });

    it('nests the destination inside the read-only section, before its closing tag', () => {
        const directive = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['chat-retry']) })!;

        const readOnlyOpen = directive.indexOf('<coc-read-only-mode>');
        const intro = directive.indexOf(PLAN_SAVE_GUIDANCE_INTRO);
        const save = directive.indexOf('- Save location:');
        const readOnlyClose = directive.indexOf('</coc-read-only-mode>');
        const modeClose = directive.indexOf(`</${CHAT_MODE_DIRECTIVE_TAG}>`);

        expect(readOnlyOpen).toBeGreaterThanOrEqual(0);
        expect(intro).toBeGreaterThan(readOnlyOpen);
        expect(save).toBeGreaterThan(intro);
        expect(readOnlyClose).toBeGreaterThan(save);
        expect(modeClose).toBeGreaterThan(readOnlyClose);
    });

    it('keeps the shared SDK constant free of workspace data', () => {
        buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['chat-retry']) });

        expect(READ_ONLY_SYSTEM_MESSAGE).not.toContain('Save location');
        expect(READ_ONLY_SYSTEM_MESSAGE).not.toContain('chat-retry');
    });

    it('renders the resolved root, the folder list, and the naming rule', () => {
        const directive = buildChatModeDirective({
            mode: 'ask',
            planSaveContext: ctx(['right-panel', 'chat-retry']),
        })!;

        expect(directive).toContain('/data/repos/ws-a/notes/Plans/<chosen-folder>/<descriptive-name>.plan.md');
        expect(directive).toContain('Existing folder options: chat-retry, right-panel');
        expect(directive).toContain('kebab-case, ≤3 words');
    });

    it('scopes the guidance to an explicit request rather than every question', () => {
        const directive = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx([]) })!;

        expect(directive).toContain('If the user asks you to save a plan:');
    });

    it('reports (none yet) for an empty workspace and still names the root', () => {
        const directive = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx([]) })!;

        expect(directive).toContain('Existing folder options: (none yet)');
        expect(directive).toContain('/data/repos/ws-a/notes/Plans/<chosen-folder>');
    });

    it('renders the same bytes whatever order the directory listing came back in', () => {
        const a = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['b-folder', 'a-folder', 'c-folder']) });
        const b = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['c-folder', 'a-folder', 'b-folder']) });

        expect(a).toBe(b);
    });

    it('does not mutate the caller\u2019s folder array', () => {
        const folders = ['z-folder', 'a-folder'];
        buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(folders) });

        expect(folders).toEqual(['z-folder', 'a-folder']);
    });

    it('drops archive folders from the advertised choices', () => {
        const directive = buildChatModeDirective({
            mode: 'ask',
            planSaveContext: ctx(['archive', 'archive/old', 'right-panel']),
        })!;

        expect(directive).toContain('Existing folder options: right-panel');
    });

    it('converts a Windows root to forward slashes', () => {
        const directive = buildChatModeDirective({
            mode: 'ask',
            planSaveContext: ctx(['plans'], 'C:\\Users\\dev\\.coc\\repos\\ws-a\\notes\\Plans'),
        })!;

        expect(directive).toContain('C:/Users/dev/.coc/repos/ws-a/notes/Plans/<chosen-folder>');
        expect(directive).not.toContain('\\');
    });

    it('handles a root containing spaces', () => {
        const directive = buildChatModeDirective({
            mode: 'ask',
            planSaveContext: ctx([], '/data/My Repos/ws a/notes/Plans'),
        })!;

        expect(directive).toContain('/data/My Repos/ws a/notes/Plans/<chosen-folder>');
    });

    it('falls back to the bare read-only rules with no context', () => {
        expect(buildChatModeDirective({ mode: 'ask' })).toBe(
            buildChatModeDirective({ mode: 'ask', planSaveContext: undefined }),
        );
        expect(buildChatModeDirective({ mode: 'ask' })).not.toContain('Save location');
    });

    it('is ask-only: autopilot and its transition note carry no destination', () => {
        expect(buildChatModeDirective({ mode: 'autopilot', planSaveContext: ctx(['x']) })).toBeUndefined();
        const transition = buildChatModeDirective({
            mode: 'autopilot',
            previousMode: 'ask',
            planSaveContext: ctx(['x']),
        })!;
        expect(transition).toContain(MODE_SWITCHED_TO_AUTOPILOT_NOTE);
        expect(transition).not.toContain('Save location');
    });

    it('applies to legacy plan mode through the same normalization', () => {
        expect(buildChatModeDirective({ mode: 'plan' as never, planSaveContext: ctx(['x']) }))
            .toBe(buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['x']) }));
    });

    it('keeps repo mode instructions after the read-only section, not inside it', () => {
        const directive = buildChatModeDirective({
            mode: 'ask',
            planSaveContext: ctx(['x']),
            modeInstructions: 'ASK-ONLY-INSTRUCTIONS',
        })!;

        expect(directive.indexOf('ASK-ONLY-INSTRUCTIONS'))
            .toBeGreaterThan(directive.indexOf('</coc-read-only-mode>'));
    });
});

// ============================================================================
// parseChatModeMarker
// ============================================================================

describe('parseChatModeMarker', () => {
    const ctx = { tasksRoot: '/data/repos/ws-a/notes/Plans', existingFolders: ['right-panel'] };

    it('splits a directive carrying guidance and instructions into three pieces', () => {
        const marker = buildChatModeDirective({
            mode: 'ask',
            planSaveContext: ctx,
            modeInstructions: 'ASK-ONLY',
        })!;

        const parsed = parseChatModeMarker(marker);
        expect(parsed.prose).toContain('Save location');
        expect(parsed.prose!.endsWith('</coc-read-only-mode>')).toBe(true);
        expect(parsed.instructions).toBe('ASK-ONLY');
        expect(parsed.proseBase).not.toContain('Save location');
    });

    it('recovers exactly the guidance-free rules a folder-blind caller would build', () => {
        const withGuidance = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx })!;
        const without = buildChatModeDirective({ mode: 'ask' })!;

        expect(parseChatModeMarker(withGuidance).proseBase).toBe(parseChatModeMarker(without).prose);
    });

    it('recognizes a legacy marker that predates the guidance', () => {
        const legacy = `<${CHAT_MODE_DIRECTIVE_TAG}>\n${READ_ONLY_SYSTEM_MESSAGE.trim()}\n</${CHAT_MODE_DIRECTIVE_TAG}>`;

        const parsed = parseChatModeMarker(legacy);
        expect(parsed.prose).toBe(READ_ONLY_SYSTEM_MESSAGE.trim());
        expect(parsed.proseBase).toBe(READ_ONLY_SYSTEM_MESSAGE.trim());
        expect(parsed.instructions).toBeUndefined();
    });

    it('recognizes the autopilot transition note, with and without instructions', () => {
        expect(parseChatModeMarker(buildChatModeDirective({ mode: 'autopilot', previousMode: 'ask' })!))
            .toEqual({ prose: MODE_SWITCHED_TO_AUTOPILOT_NOTE, proseBase: MODE_SWITCHED_TO_AUTOPILOT_NOTE });

        const withInstructions = parseChatModeMarker(buildChatModeDirective({
            mode: 'autopilot',
            previousMode: 'ask',
            modeInstructions: 'AUTOPILOT-ONLY',
        })!);
        expect(withInstructions.prose).toBe(MODE_SWITCHED_TO_AUTOPILOT_NOTE);
        expect(withInstructions.instructions).toBe('AUTOPILOT-ONLY');
    });

    it('yields no prose for a marker whose read-only section never closes', () => {
        const malformed = `<${CHAT_MODE_DIRECTIVE_TAG}>\n<coc-read-only-mode>\nrules but no close\n</${CHAT_MODE_DIRECTIVE_TAG}>`;

        const parsed = parseChatModeMarker(malformed);
        expect(parsed.prose).toBeUndefined();
        expect(parsed.proseBase).toBeUndefined();
    });

    it('treats an instructions-only marker as carrying no prose', () => {
        const marker = buildChatModeDirective({ mode: 'autopilot', modeInstructions: 'AUTOPILOT-ONLY' })!;

        expect(parseChatModeMarker(marker)).toEqual({ instructions: 'AUTOPILOT-ONLY' });
    });
});

// ============================================================================
// shouldInjectChatModeDirective — plan-destination drift
// ============================================================================

describe('shouldInjectChatModeDirective — plan-destination drift', () => {
    const root = '/data/repos/ws-a/notes/Plans';
    const ctx = (existingFolders: string[], tasksRoot = root) => ({ tasksRoot, existingFolders });

    const injected = (marker: string) => ([{
        role: 'user' as const,
        content: 'hi',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        turnIndex: 0,
        timeline: [],
        chatModeContext: marker,
    }]);

    /** The executor's own comparison: it resolved the context, so it checks drift. */
    const ask = (
        planSaveContext: { tasksRoot: string; existingFolders: string[] } | undefined,
        turns: ReturnType<typeof injected>,
        overrides: Partial<ChatModeInjectionCheck> = {},
    ) => shouldInjectChatModeDirective({
        mode: 'ask',
        previousMode: 'ask',
        planSaveContext,
        checkPlanContextDrift: true,
        turns,
        compaction: undefined,
        canResumeSession: true,
        ...overrides,
    });

    it('skips when the destination and folder list are unchanged', () => {
        const marker = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a', 'b']) })!;

        expect(ask(ctx(['a', 'b']), injected(marker))).toBe(false);
    });

    it('skips when the same folders come back in a different order', () => {
        const marker = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a', 'b', 'c']) })!;

        expect(ask(ctx(['c', 'b', 'a']), injected(marker))).toBe(false);
    });

    it('re-injects once when a folder is added, removed, or renamed', () => {
        const marker = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a', 'b']) })!;

        expect(ask(ctx(['a', 'b', 'c']), injected(marker))).toBe(true);
        expect(ask(ctx(['a']), injected(marker))).toBe(true);
        expect(ask(ctx(['a', 'b-renamed']), injected(marker))).toBe(true);

        // …and then settles.
        const refreshed = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a', 'b', 'c']) })!;
        expect(ask(ctx(['a', 'b', 'c']), injected(refreshed))).toBe(false);
    });

    it('re-injects when the resolved root changes (a different workspace)', () => {
        const marker = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a']) })!;

        expect(ask(ctx(['a'], '/data/repos/ws-b/notes/Plans'), injected(marker))).toBe(true);
    });

    it('re-injects when the turn becomes eligible or becomes suppressed', () => {
        const withGuidance = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a']) })!;
        const without = buildChatModeDirective({ mode: 'ask' })!;

        expect(ask(ctx(['a']), injected(without))).toBe(true);
        expect(ask(undefined, injected(withGuidance))).toBe(true);
    });

    it('re-injects once for a legacy marker that predates the guidance, then settles', () => {
        const legacy = `<${CHAT_MODE_DIRECTIVE_TAG}>\n${READ_ONLY_SYSTEM_MESSAGE.trim()}\n</${CHAT_MODE_DIRECTIVE_TAG}>`;

        expect(ask(ctx(['a']), injected(legacy))).toBe(true);

        const refreshed = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a']) })!;
        expect(ask(ctx(['a']), injected(refreshed))).toBe(false);
    });

    it('re-injects for a marker whose read-only section is malformed', () => {
        const malformed = `<${CHAT_MODE_DIRECTIVE_TAG}>\n<coc-read-only-mode>\ntruncated\n</${CHAT_MODE_DIRECTIVE_TAG}>`;

        expect(ask(ctx(['a']), injected(malformed))).toBe(true);
        expect(ask(undefined, injected(malformed))).toBe(true);
    });

    it('leaves a folder-blind caller unmoved by a destination it cannot see', () => {
        // The display side never resolves folders. Without the stripped
        // comparison it would read "unknown" as "removed" and disclose a block
        // the executor did not send.
        const marker = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a', 'b']) })!;

        expect(shouldInjectChatModeDirective({
            mode: 'ask',
            previousMode: 'ask',
            turns: injected(marker),
            compaction: undefined,
            canResumeSession: true,
        })).toBe(false);
    });

    it('keeps folder drift and repo-instruction drift independent', () => {
        const marker = buildChatModeDirective({
            mode: 'ask',
            planSaveContext: ctx(['a']),
            modeInstructions: 'ASK-ONLY',
        })!;

        // Instructions changed, folders held.
        expect(ask(ctx(['a']), injected(marker), {
            modeInstructions: 'ASK-ONLY-V2',
            checkInstructionDrift: true,
        })).toBe(true);
        // Folders changed, instructions held.
        expect(ask(ctx(['a', 'b']), injected(marker), {
            modeInstructions: 'ASK-ONLY',
            checkInstructionDrift: true,
        })).toBe(true);
        // Neither changed.
        expect(ask(ctx(['a']), injected(marker), {
            modeInstructions: 'ASK-ONLY',
            checkInstructionDrift: true,
        })).toBe(false);
    });

    it('still re-injects on a cold resume and after a compaction', () => {
        const marker = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a']) })!;

        expect(ask(ctx(['a']), injected(marker), { canResumeSession: false })).toBe(true);
        expect(ask(ctx(['a']), injected(marker), {
            compaction: { state: 'completed', completedAt: '2026-02-01T00:00:00.000Z' } as never,
        })).toBe(true);
    });

    it('sends the transition note, and no destination, when ask switches to autopilot', () => {
        const marker = buildChatModeDirective({ mode: 'ask', planSaveContext: ctx(['a']) })!;

        expect(shouldInjectChatModeDirective({
            mode: 'autopilot',
            previousMode: 'ask',
            planSaveContext: undefined,
            checkPlanContextDrift: true,
            turns: injected(marker),
            compaction: undefined,
            canResumeSession: true,
        })).toBe(true);
    });
});
