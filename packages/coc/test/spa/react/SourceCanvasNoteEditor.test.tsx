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

// Remote-server workspaces are aggregated into the repos list only — never into
// `state.workspaces` — so the editor must read them from ReposContext too.
const reposRef: { current: any[] } = { current: [] };
vi.mock('../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => ({ repos: reposRef.current }),
}));

import { SourceCanvasNoteEditor } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasNoteEditor';
import { noopCommentBackend } from '../../../src/server/spa/client/react/features/notes/editor/NoteEditorCommentBackend';

beforeEach(() => {
    noteEditorProps.mockClear();
    workspacesRef.current = [{ id: 'ws1', rootPath: '/home/u/proj' }];
    reposRef.current = [];
});

/** A remote workspace as it appears in the repos list (never in state.workspaces). */
const REMOTE_WS = {
    id: 'ws-v2-8777024115df4e9eb71f789e',
    rootPath: '/home/yihengtao/projects/remote-proj',
    baseUrl: 'http://127.0.0.1:4000',
    remote: {
        baseUrl: 'http://127.0.0.1:4000',
        serverId: 's1',
        serverLabel: 'remote',
        offline: false,
        connection: 'online',
        queue: 'idle',
    },
};

describe('SourceCanvasNoteEditor remote workspaces', () => {
    it('resolves a note by wsId hint when the workspace exists only in the repos list', () => {
        reposRef.current = [{ workspace: REMOTE_WS }];
        const notePath = '/home/yihengtao/.coc/repos/ws-v2-8777024115df4e9eb71f789e/notes/Plans/work-radar.plan.md';

        const { getByTestId, queryByTestId } = render(
            <SourceCanvasNoteEditor
                fileRef={{ fullPath: notePath, wsId: REMOTE_WS.id, kind: 'note' }}
            />,
        );

        expect(queryByTestId('source-canvas-note-error')).toBeNull();
        expect(getByTestId('source-canvas-note-editor').getAttribute('data-ws-id')).toBe(REMOTE_WS.id);
        const props = noteEditorProps.mock.calls[0][0];
        expect(props.workspaceId).toBe(REMOTE_WS.id);
        expect(props.notePath).toBe(notePath);
        expect(props.io).toEqual({ __kind: 'workspace' });
    });

    it('resolves a remote file by longest-prefix rootPath match with no wsId hint', () => {
        reposRef.current = [{ workspace: REMOTE_WS }];

        const { getByTestId } = render(
            <SourceCanvasNoteEditor
                fileRef={{ fullPath: '/home/yihengtao/projects/remote-proj/docs/readme.md', kind: 'note' }}
            />,
        );

        expect(getByTestId('source-canvas-note-editor').getAttribute('data-ws-id')).toBe(REMOTE_WS.id);
    });

    it('still errors when the repos list holds no matching workspace', () => {
        workspacesRef.current = [];
        reposRef.current = [{ workspace: REMOTE_WS }];

        const { getByTestId } = render(
            <SourceCanvasNoteEditor fileRef={{ fullPath: '/elsewhere/x.md', kind: 'note' }} />,
        );

        expect(getByTestId('source-canvas-note-error')).toBeTruthy();
    });
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

    it('forwards the ref line to the editor as scrollToLine (AC-04 best-effort scroll)', () => {
        render(
            <SourceCanvasNoteEditor
                fileRef={{ fullPath: '/home/u/proj/docs/readme.md', kind: 'note', line: 40 }}
            />,
        );
        const props = noteEditorProps.mock.calls[0][0];
        expect(props.scrollToLine).toBe(40);
    });

    it('passes no scrollToLine when the ref carried no line (opens at top)', () => {
        render(
            <SourceCanvasNoteEditor
                fileRef={{ fullPath: '/home/u/proj/docs/readme.md', kind: 'note' }}
            />,
        );
        const props = noteEditorProps.mock.calls[0][0];
        expect(props.scrollToLine).toBeUndefined();
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
