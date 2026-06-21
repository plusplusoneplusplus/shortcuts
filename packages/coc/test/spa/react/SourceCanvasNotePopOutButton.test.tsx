/**
 * Tests for SourceCanvasNotePopOutButton — the docked note editor's "Pop out"
 * header action (AC-03). Verifies it builds the same `#popout/markdown` URL the
 * floating dialog uses (workspace/filePath/displayPath/fetchMode/taskRootPath),
 * marks the file popped out, closes the canvas note on success, and surfaces a
 * toast (without closing) when the popup is blocked.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const { markPoppedOutMock, addToastMock } = vi.hoisted(() => ({
    markPoppedOutMock: vi.fn(),
    addToastMock: vi.fn(),
}));

const workspacesRef: { current: any[] } = { current: [{ id: 'ws1', rootPath: '/home/u/proj' }] };
vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: workspacesRef.current }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/MarkdownPopOutContext', () => ({
    useMarkdownPopOut: () => ({ markPoppedOut: markPoppedOutMock }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: addToastMock }),
}));

import { SourceCanvasNotePopOutButton } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasNotePopOutButton';

beforeEach(() => {
    markPoppedOutMock.mockClear();
    addToastMock.mockClear();
    workspacesRef.current = [{ id: 'ws1', rootPath: '/home/u/proj' }];
});

describe('SourceCanvasNotePopOutButton', () => {
    it('opens the #popout/markdown window with the auto fetchMode params for a non-task file', () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
        const onClose = vi.fn();
        const { getByTestId } = render(
            <SourceCanvasNotePopOutButton
                fileRef={{ fullPath: '/home/u/proj/docs/readme.md', kind: 'note' }}
                onClose={onClose}
            />,
        );

        fireEvent.click(getByTestId('source-canvas-popout-btn'));

        expect(openSpy).toHaveBeenCalledTimes(1);
        const calledUrl = String(openSpy.mock.calls[0][0]);
        expect(calledUrl).toContain('#popout/markdown');
        const url = new URL(calledUrl);
        expect(url.searchParams.get('workspace')).toBe('ws1');
        expect(url.searchParams.get('filePath')).toBe('/home/u/proj/docs/readme.md');
        expect(url.searchParams.get('displayPath')).toBe('/home/u/proj/docs/readme.md');
        expect(url.searchParams.get('fetchMode')).toBe('auto');
        expect(url.searchParams.get('taskRootPath')).toBeNull();

        // Success path: mark popped out + close the canvas note (dialog parity).
        expect(markPoppedOutMock).toHaveBeenCalledWith('ws1::/home/u/proj/docs/readme.md');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(addToastMock).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });

    it('uses the tasks fetchMode + task-relative filePath for a .vscode/tasks note', () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
        const { getByTestId } = render(
            <SourceCanvasNotePopOutButton
                fileRef={{ fullPath: '/home/u/proj/.vscode/tasks/plan.md', wsId: 'ws1', kind: 'note' }}
                onClose={() => {}}
            />,
        );

        fireEvent.click(getByTestId('source-canvas-popout-btn'));

        const url = new URL(String(openSpy.mock.calls[0][0]));
        expect(url.searchParams.get('workspace')).toBe('ws1');
        expect(url.searchParams.get('filePath')).toBe('plan.md');
        expect(url.searchParams.get('fetchMode')).toBe('tasks');
        openSpy.mockRestore();
    });

    it('shows a toast and does NOT close when the popup is blocked', () => {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
        const onClose = vi.fn();
        const { getByTestId } = render(
            <SourceCanvasNotePopOutButton
                fileRef={{ fullPath: '/home/u/proj/docs/readme.md', kind: 'note' }}
                onClose={onClose}
            />,
        );

        fireEvent.click(getByTestId('source-canvas-popout-btn'));

        expect(addToastMock).toHaveBeenCalledWith(
            'Pop-out blocked. Allow popups for this site and try again.',
            'error',
        );
        expect(markPoppedOutMock).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });

    it('is disabled and no-ops when no workspace resolves', () => {
        workspacesRef.current = [];
        const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
        const { getByTestId } = render(
            <SourceCanvasNotePopOutButton
                fileRef={{ fullPath: '/elsewhere/x.md', kind: 'note' }}
                onClose={() => {}}
            />,
        );

        const btn = getByTestId('source-canvas-popout-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        fireEvent.click(btn);
        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });
});
