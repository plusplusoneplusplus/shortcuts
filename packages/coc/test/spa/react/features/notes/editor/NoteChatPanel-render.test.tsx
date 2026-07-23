// @vitest-environment jsdom
/**
 * Rendered-behavior tests for NoteChatPanel — the thin Notes adapter around the
 * shared InitialChatComposer (Verification #2).
 *
 * These mount the REAL NoteChatPanel and drive it through genuine render +
 * state transitions, replacing the source-string-only assertions in
 * NoteChatPanel.test.ts / NoteChatPanel-mode.test.ts for the adapter's own
 * behavior. The shared composer and ChatDetail are stubbed so the tests focus on
 * what NoteChatPanel actually owns: the empty / no-note / workspace states, the
 * submission adapter (flush ordering, AI-selection mapping, error preservation,
 * success transition to ChatDetail), the /new · /clear interceptor, and the
 * selected-text reference wiring.
 *
 * Covered ACs: AC-01 (thin adapter renders the shared composer), AC-02 (single
 * header + no-note vs workspace states), AC-03 (Ask/Autopilot allowed set +
 * resolved AI selection reaches createChat), AC-04 (references ride as a pending
 * prefix; /new · /clear reset without flush/create/consume), AC-06 (flush before
 * create, rejection preserves state, success renders ChatDetail once).
 *
 * The compact-settings-lists-only-Ask/Autopilot rendering, draft-key isolation,
 * and Workspace-scope-never-binds-per-note proofs live with the shared composer
 * (NewChatArea.test.tsx), the draft-key helper (useNotesChat.test.ts), and the
 * server binding path (note-chat-binding-scope.test.ts) respectively.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import type { NoteTextReference } from '../../../../../../src/server/spa/client/react/features/notes/editor/useNoteReferences';
import { formatNoteReferences } from '../../../../../../src/server/spa/client/react/features/notes/editor/useNoteReferences';

// ── Hoisted mutable test harness ─────────────────────────────────────────────
// `hoisted` is shared between the vi.mock factories (below) and the tests. Each
// test configures the mocked hook's behavior + captures the props the adapter
// hands to the shared composer / ChatDetail.
const hoisted = vi.hoisted(() => ({
    // useNotesChat mock config
    initialTaskId: null as string | null,
    chatNoteContext: null as { notePath: string; noteTitle?: string } | null,
    createChat: vi.fn(async (..._args: unknown[]) => null as string | null),
    resetChat: vi.fn(),
    // captured props
    composerProps: null as any,
    chatDetailProps: null as any,
    // shared app state
    workspaces: [{ id: 'ws-1', rootPath: '/home/user/repo' }] as any[],
    // deterministic ordering record (flush vs create)
    callOrder: [] as string[],
}));

// Mock the Notes hook with a REAL stateful mini-hook so createChat success flips
// taskId → the adapter transitions to ChatDetail exactly like production.
vi.mock('../../../../../../src/server/spa/client/react/features/notes/hooks/useNotesChat', async () => {
    const ReactMod = await import('react');
    return {
        notesChatDraftKey: (ws: string, scope: string, notePath: string | null) =>
            `notes-chat:${ws}:${scope}:${notePath ?? ''}`,
        useNotesChat: (opts: any) => {
            const [taskId, setTaskId] = ReactMod.useState<string | null>(hoisted.initialTaskId);
            const [scope, setScope] = ReactMod.useState<'per-note' | 'per-workspace'>(
                opts?.defaultScope ?? 'per-note',
            );
            const createChat = ReactMod.useCallback(async (...args: unknown[]) => {
                hoisted.callOrder.push('create');
                const r = await hoisted.createChat(...args);
                if (r) setTaskId(r);
                return r;
            }, []);
            const resetChat = ReactMod.useCallback(() => {
                hoisted.resetChat();
                setTaskId(null);
            }, []);
            return { taskId, chatNoteContext: hoisted.chatNoteContext, createChat, resetChat, scope, setScope };
        },
    };
});

// Stub the shared composer: capture its props + render the accessory (real
// reference chips), the hero identity, and a stable testid. Driving happens via
// hoisted.composerProps.onSubmit / interceptSubmit — the same callbacks the real
// composer would invoke.
vi.mock('../../../../../../src/server/spa/client/react/features/chat/NewChatArea', async () => {
    const ReactMod = await import('react');
    return {
        InitialChatComposer: (props: any) => {
            hoisted.composerProps = props;
            return ReactMod.createElement(
                'div',
                { 'data-testid': `${props.testIdPrefix}-composer` },
                ReactMod.createElement('div', { 'data-testid': 'composer-hero-title' }, props.heroTitle),
                ReactMod.createElement('div', { 'data-testid': 'composer-hero-desc' }, props.heroDescription),
                props.accessoryAboveInput,
            );
        },
    };
});

// Stub ChatDetail: capture its props + expose the bound taskId.
vi.mock('../../../../../../src/server/spa/client/react/features/chat/ChatDetail', async () => {
    const ReactMod = await import('react');
    return {
        ChatDetail: (props: any) => {
            hoisted.chatDetailProps = props;
            return ReactMod.createElement('div', { 'data-testid': 'chat-detail-stub' }, props.taskId);
        },
    };
});

// Passthrough the chat-preferences provider (its context is irrelevant here).
vi.mock('../../../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', async () => {
    const ReactMod = await import('react');
    return { ChatPreferencesProvider: ({ children }: any) => ReactMod.createElement(ReactMod.Fragment, null, children) };
});

// Minimal app state (workspace label lookup).
vi.mock('../../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: hoisted.workspaces } }),
}));

import { NoteChatPanel } from '../../../../../../src/server/spa/client/react/features/notes/editor/NoteChatPanel';

function makeRef(overrides: Partial<NoteTextReference> = {}): NoteTextReference {
    return {
        id: overrides.id ?? 'ref-1',
        text: overrides.text ?? 'selected snippet',
        preview: overrides.preview ?? 'selected snippet',
        noteTitle: overrides.noteTitle ?? 'A',
        notePath: overrides.notePath ?? 'docs/a.md',
        truncated: overrides.truncated,
    };
}

function renderPanel(props: Partial<React.ComponentProps<typeof NoteChatPanel>> = {}) {
    return render(
        <NoteChatPanel
            workspaceId="ws-1"
            notePath="docs/a.md"
            noteTitle="A"
            onClose={vi.fn()}
            {...props}
        />,
    );
}

beforeEach(() => {
    hoisted.initialTaskId = null;
    hoisted.chatNoteContext = null;
    hoisted.createChat = vi.fn(async () => null);
    hoisted.resetChat = vi.fn();
    hoisted.composerProps = null;
    hoisted.chatDetailProps = null;
    hoisted.workspaces = [{ id: 'ws-1', rootPath: '/home/user/repo' }];
    hoisted.callOrder = [];
});

describe('NoteChatPanel — rendered behavior', () => {
    describe('empty / no-note / workspace states (AC-01/AC-02)', () => {
        it('renders the shared composer with the note-chat prefix and note-scope identity', () => {
            renderPanel();
            expect(screen.getByTestId('note-chat-composer')).toBeTruthy();
            expect(screen.getByTestId('composer-hero-title')).toHaveTextContent('Notes Chat');
            expect(screen.getByTestId('composer-hero-desc')).toHaveTextContent('Ask about this note…');
            expect(screen.queryByTestId('chat-detail-stub')).toBeNull();
            // Single header in the empty state.
            expect(screen.getAllByTestId('notes-chat-header')).toHaveLength(1);
        });

        it('shows the no-note state and renders NO composer when per-note scope has no selected note', () => {
            renderPanel({ notePath: null, noteTitle: undefined });
            // "No note selected" appears both as the header context-label fallback
            // and in the empty-state body; the body copy below is what's unique.
            expect(screen.getByText('Select a note to start chatting')).toBeTruthy();
            expect(screen.getAllByText('No note selected').length).toBeGreaterThanOrEqual(1);
            expect(screen.queryByTestId('note-chat-composer')).toBeNull();
            // The single header is still the only header.
            expect(screen.getAllByTestId('notes-chat-header')).toHaveLength(1);
        });

        it('renders the composer with workspace-scope copy even without a selected note', () => {
            renderPanel({ notePath: null, noteTitle: undefined, defaultScope: 'per-workspace' });
            expect(screen.getByTestId('note-chat-composer')).toBeTruthy();
            expect(screen.getByTestId('composer-hero-desc')).toHaveTextContent(
                'Ask about your notes — one chat per workspace',
            );
        });

        it('pins the shared composer to Ask + Autopilot with a compact settings layout and no workflow launch', () => {
            renderPanel();
            expect(hoisted.composerProps.allowedModes).toEqual(['ask', 'autopilot']);
            expect(hoisted.composerProps.settingsLayout).toBe('compact');
            expect(hoisted.composerProps.enableRalphDirectGoal).toBe(false);
            expect(hoisted.composerProps.draftKey).toBe('notes-chat:ws-1:per-note:docs/a.md');
        });
    });

    describe('selected-text references (AC-04)', () => {
        it('rides references as the composer pending prefix and clears them only via the composer success callback', () => {
            const onClearReferences = vi.fn();
            const refs = [makeRef({ id: 'r1' }), makeRef({ id: 'r2', text: 'second' })];
            renderPanel({ references: refs, onClearReferences });
            expect(hoisted.composerProps.pendingPrefix).toBe(formatNoteReferences(refs));
            // onClearReferences is wired to the composer's success-only clear callback,
            // NOT invoked eagerly by the adapter.
            expect(hoisted.composerProps.onClearPendingPrefix).toBe(onClearReferences);
            expect(onClearReferences).not.toHaveBeenCalled();
        });

        it('renders removable reference chips in the accessory slot above the input', () => {
            const onRemoveReference = vi.fn();
            const refs = [makeRef({ id: 'r1' }), makeRef({ id: 'r2' })];
            renderPanel({ references: refs, onRemoveReference });
            const chips = screen.getAllByTestId('note-reference-chip');
            expect(chips).toHaveLength(2);
            fireEvent.click(screen.getAllByTestId('note-reference-chip-remove')[0]);
            expect(onRemoveReference).toHaveBeenCalledWith('r1');
        });

        it('omits the pending prefix when there are no references', () => {
            renderPanel({ references: [] });
            expect(hoisted.composerProps.pendingPrefix).toBeUndefined();
        });
    });

    describe('submission adapter — flush ordering and AI-selection mapping (AC-03/AC-06/AC-07)', () => {
        it('flushes onBeforeSend before calling createChat', async () => {
            const onBeforeSend = vi.fn(async () => {
                hoisted.callOrder.push('flush');
            });
            hoisted.createChat = vi.fn(async () => 'task-1');
            renderPanel({ onBeforeSend });
            await act(async () => {
                await hoisted.composerProps.onSubmit({ mode: 'ask', prompt: 'hi', context: {} });
            });
            expect(hoisted.callOrder).toEqual(['flush', 'create']);
        });

        it('maps a concrete-provider submission into createChat: skills + auto-routing split out, generic context passed through', async () => {
            hoisted.createChat = vi.fn(async () => 'task-1');
            renderPanel();
            await act(async () => {
                await hoisted.composerProps.onSubmit({
                    mode: 'autopilot',
                    prompt: 'analyze',
                    model: 'model-x',
                    provider: 'claude',
                    reasoningEffort: 'high',
                    config: { effortTier: 'tier-a' },
                    workingDirectory: '/wd',
                    attachments: [{ name: 'f.txt', dataUrl: 'data:,' }],
                    context: { skills: ['skill-1'], sessionContext: { foo: 'bar' } },
                });
            });
            expect(hoisted.createChat).toHaveBeenCalledTimes(1);
            const [prompt, model, mode, skills, attachments, aiSelection] = hoisted.createChat.mock.calls[0] as any[];
            expect(prompt).toBe('analyze');
            expect(model).toBe('model-x');
            expect(mode).toBe('autopilot');
            expect(skills).toEqual(['skill-1']);
            expect(attachments).toEqual([{ name: 'f.txt', dataUrl: 'data:,' }]);
            expect(aiSelection).toEqual({
                provider: 'claude',
                reasoningEffort: 'high',
                effortTier: 'tier-a',
                workingDirectory: '/wd',
                context: { sessionContext: { foo: 'bar' } },
            });
        });

        it('maps an Auto-provider submission to autoProviderRouting intent without a concrete provider', async () => {
            hoisted.createChat = vi.fn(async () => 'task-1');
            renderPanel();
            await act(async () => {
                await hoisted.composerProps.onSubmit({
                    mode: 'ask',
                    prompt: 'auto please',
                    provider: 'auto',
                    context: { autoProviderRouting: true },
                });
            });
            const aiSelection = (hoisted.createChat.mock.calls[0] as any[])[5];
            expect(aiSelection.autoProviderRouting).toBe(true);
            expect(aiSelection.provider).toBeUndefined();
            expect(aiSelection.context).toBeUndefined();
        });
    });

    describe('error preservation and success transition (AC-06)', () => {
        it('rejects when createChat returns null so the composer preserves state and no chat opens', async () => {
            const onClearReferences = vi.fn();
            hoisted.createChat = vi.fn(async () => null);
            renderPanel({ references: [makeRef()], onClearReferences });
            await expect(
                hoisted.composerProps.onSubmit({ mode: 'ask', prompt: 'boom', context: {} }),
            ).rejects.toThrow(/failed to create/i);
            // Still on the empty state; no ChatDetail, references not consumed by the adapter.
            expect(screen.getByTestId('note-chat-composer')).toBeTruthy();
            expect(screen.queryByTestId('chat-detail-stub')).toBeNull();
            expect(onClearReferences).not.toHaveBeenCalled();
        });

        it('transitions to ChatDetail exactly once on a successful create, with the Notes-restricted config', async () => {
            hoisted.createChat = vi.fn(async () => 'task-777');
            renderPanel();
            await act(async () => {
                await hoisted.composerProps.onSubmit({ mode: 'ask', prompt: 'go', context: {} });
            });
            const detail = screen.getAllByTestId('chat-detail-stub');
            expect(detail).toHaveLength(1);
            expect(detail[0]).toHaveTextContent('task-777');
            expect(screen.queryByTestId('note-chat-composer')).toBeNull();
            // The single Notes header remains the only header after the transition.
            expect(screen.getAllByTestId('notes-chat-header')).toHaveLength(1);
            expect(hoisted.chatDetailProps.hideHeader).toBe(true);
            expect(hoisted.chatDetailProps.compactModeSelector).toBe(true);
            expect(hoisted.chatDetailProps.disableScratchpad).toBe(true);
            expect(hoisted.chatDetailProps.allowedModes).toEqual(['ask', 'autopilot']);
        });
    });

    describe('/new and /clear reset interceptor (AC-04)', () => {
        it('resets the binding on exact trimmed, case-insensitive /new and /clear without flushing or creating', () => {
            const onBeforeSend = vi.fn(async () => {});
            renderPanel({ onBeforeSend });
            expect(hoisted.composerProps.interceptSubmit('/new')).toBe(true);
            expect(hoisted.composerProps.interceptSubmit('  /CLEAR ')).toBe(true);
            expect(hoisted.resetChat).toHaveBeenCalledTimes(2);
            expect(hoisted.createChat).not.toHaveBeenCalled();
            expect(onBeforeSend).not.toHaveBeenCalled();
        });

        it('does not intercept ordinary input or /new-prefixed words', () => {
            renderPanel();
            expect(hoisted.composerProps.interceptSubmit('hello')).toBe(false);
            expect(hoisted.composerProps.interceptSubmit('/newer')).toBe(false);
            expect(hoisted.composerProps.interceptSubmit('/clearall')).toBe(false);
            expect(hoisted.resetChat).not.toHaveBeenCalled();
        });
    });
});
