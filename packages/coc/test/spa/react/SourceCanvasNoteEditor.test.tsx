/**
 * Tests for SourceCanvasNoteEditor — the editable markdown body of the docked
 * source canvas (AC-02). Verifies the embedded NoteEditor is wired with the
 * shared resolver's workspace/path/IO and the inert `noopCommentBackend`
 * (parity with the floating dialog), and that an unresolvable ref shows an
 * error instead of mounting the editor.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

/* ── Capture the props the NoteEditor is mounted with ───────────────────── */

const noteEditorProps = vi.fn();

vi.mock('../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: (props: any) => {
        noteEditorProps(props);
        return <div data-testid="note-editor-mock" data-note-path={props.notePath} />;
    },
}));

vi.mock('../../../src/server/spa/client/react/tasks/TasksNoteEditorIO', () => ({
    createTasksNoteEditorIO: () => ({ __kind: 'tasks' }),
}));

vi.mock('../../../src/server/spa/client/react/tasks/WorkspaceFileNoteEditorIO', () => ({
    createWorkspaceFileNoteEditorIO: () => ({ __kind: 'workspace' }),
}));

const workspacesRef: { current: any[] } = { current: [{ id: 'ws1', rootPath: '/home/u/proj' }] };
vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: workspacesRef.current }, dispatch: vi.fn() }),
}));

import { SourceCanvasNoteEditor } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasNoteEditor';
import { noopCommentBackend } from '../../../src/server/spa/client/react/features/notes/editor/NoteEditorCommentBackend';

beforeEach(() => {
    noteEditorProps.mockClear();
    workspacesRef.current = [{ id: 'ws1', rootPath: '/home/u/proj' }];
});

describe('SourceCanvasNoteEditor', () => {
    it('mounts NoteEditor with the inert noopCommentBackend (dialog parity)', () => {
        const { getByTestId } = render(
            <SourceCanvasNoteEditor
                fileRef={{ fullPath: '/home/u/proj/.vscode/tasks/plan.md', kind: 'note' }}
            />,
        );
        expect(getByTestId('source-canvas-note-editor')).toBeTruthy();
        expect(getByTestId('note-editor-mock')).toBeTruthy();
        const props = noteEditorProps.mock.calls[0][0];
        expect(props.commentBackend).toBe(noopCommentBackend);
    });

    it('uses the tasks IO + task-relative path + taskRootPath for a .vscode/tasks file', () => {
        render(
            <SourceCanvasNoteEditor
                fileRef={{
                    fullPath: '/home/u/proj/.vscode/tasks/plan.md',
                    wsId: 'ws1',
                    kind: 'note',
                }}
            />,
        );
        const props = noteEditorProps.mock.calls[0][0];
        expect(props.workspaceId).toBe('ws1');
        expect(props.notePath).toBe('plan.md');
        expect(props.io).toEqual({ __kind: 'tasks' });
    });

    it('uses the workspace-file IO + full path for a markdown file outside tasks', () => {
        render(
            <SourceCanvasNoteEditor
                fileRef={{ fullPath: '/home/u/proj/docs/readme.md', kind: 'note' }}
            />,
        );
        const props = noteEditorProps.mock.calls[0][0];
        expect(props.workspaceId).toBe('ws1');
        expect(props.notePath).toBe('/home/u/proj/docs/readme.md');
        expect(props.io).toEqual({ __kind: 'workspace' });
    });

    it('shows an error and does not mount the editor when no workspace resolves', () => {
        workspacesRef.current = [];
        const { getByTestId, queryByTestId } = render(
            <SourceCanvasNoteEditor
                fileRef={{ fullPath: '/elsewhere/x.md', kind: 'note' }}
            />,
        );
        expect(getByTestId('source-canvas-note-error')).toBeTruthy();
        expect(queryByTestId('note-editor-mock')).toBeNull();
    });
});
