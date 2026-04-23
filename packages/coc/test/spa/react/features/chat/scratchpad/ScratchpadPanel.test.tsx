import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScratchpadPanel } from '../../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadPanel';

vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: (props: { workspaceId: string; notePath: string | null }) => (
        <div data-testid="mock-note-editor" data-workspace-id={props.workspaceId} data-note-path={props.notePath ?? ''} />
    ),
}));

describe('ScratchpadPanel', () => {
    it('renders with data-testid="scratchpad-panel"', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="40%" />);
        expect(screen.getByTestId('scratchpad-panel')).toBeTruthy();
    });

    it('applies height as inline style', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="40%" />);
        const panel = screen.getByTestId('scratchpad-panel');
        expect(panel.style.height).toBe('40%');
    });

    it('applies numeric height as px in inline style', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height={240} />);
        const panel = screen.getByTestId('scratchpad-panel');
        expect(panel.style.height).toBe('240px');
    });

    it('sets minHeight to 0 in inline style', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="50%" />);
        const panel = screen.getByTestId('scratchpad-panel');
        expect(panel.style.minHeight).toBe('0');
    });

    it('renders NoteEditor with correct workspaceId and notePath', () => {
        render(<ScratchpadPanel workspaceId="ws-abc" notePath="tasks/plan.md" onClose={vi.fn()} height="50%" />);
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-workspace-id')).toBe('ws-abc');
        expect(editor.getAttribute('data-note-path')).toBe('tasks/plan.md');
    });

    it('renders without crashing when notePath is null', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath={null} onClose={vi.fn()} height="50%" />);
        const editor = screen.getByTestId('mock-note-editor');
        expect(editor.getAttribute('data-note-path')).toBe('');
    });

    it('has overflow-hidden class', () => {
        render(<ScratchpadPanel workspaceId="ws-1" notePath="note.md" onClose={vi.fn()} height="40%" />);
        const panel = screen.getByTestId('scratchpad-panel');
        expect(panel.className).toContain('overflow-hidden');
    });
});
