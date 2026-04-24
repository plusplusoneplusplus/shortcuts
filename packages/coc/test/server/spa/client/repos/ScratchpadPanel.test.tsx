/**
 * @vitest-environment jsdom
 *
 * Unit tests for ScratchpadPanel — Run Skill button visibility and dispatch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockQueueDispatch = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: {},
        dispatch: mockQueueDispatch,
    }),
}));

// Stub NoteEditor to avoid Tiptap heavy dependencies.
// Renders toolbarRight if provided so we can assert on it.
vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: ({ toolbarRight }: { toolbarRight?: React.ReactNode }) => (
        <div data-testid="note-editor">
            {toolbarRight}
        </div>
    ),
}));

import { ScratchpadPanel } from '../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadPanel';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ScratchpadPanel — Run Skill button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    // ── isPlanFile detection ───────────────────────────────────────────────

    it('shows Run Skill button for exact "plan.md" filename', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.getByTestId('scratchpad-run-skill')).toBeTruthy();
    });

    it('shows Run Skill button for "*.plan.md" pattern', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/tasks/my-feature.plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.getByTestId('scratchpad-run-skill')).toBeTruthy();
    });

    it('shows Run Skill button for Windows-style backslash path with plan.md', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="C:\\Users\\user\\.coc\\repos\\ws1\\tasks\\coc\\something.plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.getByTestId('scratchpad-run-skill')).toBeTruthy();
    });

    it('does NOT show Run Skill button for a regular .md file', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/notes.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-run-skill')).toBeNull();
    });

    it('does NOT show Run Skill button for a file containing "plan" but not ending in "plan.md"', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/plan-notes.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-run-skill')).toBeNull();
    });

    it('does NOT show Run Skill button when notePath is null', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath={null}
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-run-skill')).toBeNull();
    });

    it('does NOT show Run Skill button for a non-md file named plan', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/plan.ts"
                onClose={vi.fn()}
                height="auto"
            />
        );
        expect(screen.queryByTestId('scratchpad-run-skill')).toBeNull();
    });

    // ── Dispatch behavior ──────────────────────────────────────────────────

    it('dispatches OPEN_DIALOG with correct workspaceId and contextFiles on click', async () => {
        const user = userEvent.setup();
        render(
            <ScratchpadPanel
                workspaceId="ws-abc"
                notePath="/tasks/feature.plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );

        const btn = screen.getByTestId('scratchpad-run-skill');
        await user.click(btn);

        expect(mockQueueDispatch).toHaveBeenCalledOnce();
        expect(mockQueueDispatch).toHaveBeenCalledWith({
            type: 'OPEN_DIALOG',
            workspaceId: 'ws-abc',
            contextFiles: ['/tasks/feature.plan.md'],
        });
    });

    it('passes toolbarRight into NoteEditor', () => {
        render(
            <ScratchpadPanel
                workspaceId="ws1"
                notePath="/repo/plan.md"
                onClose={vi.fn()}
                height="auto"
            />
        );
        // The Run Skill button should be rendered inside the (mocked) NoteEditor
        const editor = screen.getByTestId('note-editor');
        expect(editor.querySelector('[data-testid="scratchpad-run-skill"]')).toBeTruthy();
    });
});
