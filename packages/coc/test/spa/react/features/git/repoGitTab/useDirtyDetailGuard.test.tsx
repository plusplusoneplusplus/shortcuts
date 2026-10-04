/**
 * useDirtyDetailGuard — the Save / Don't Save / Cancel prompt for leaving an
 * edited working-tree diff in the Git tab (editable-working-tree-diff AC-04).
 */

import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useDirtyDetailGuard, type DirtyDetailGuard } from '../../../../../../src/server/spa/client/react/features/git/repoGitTab/useDirtyDetailGuard';

let current!: DirtyDetailGuard;
function Harness() {
    current = useDirtyDetailGuard('/repo/src/a.ts');
    return <>{current.dialog}</>;
}

function setup(save?: () => Promise<boolean>) {
    render(<Harness />);
    const navigate = vi.fn();
    act(() => {
        if (save) current.onRegisterSave(save);
    });
    return { navigate, switchFile: () => act(() => current.guard(navigate)('/repo/src/b.ts', 'unstaged')) };
}

describe('useDirtyDetailGuard', () => {
    it('navigates at once while the detail is clean', () => {
        const { navigate, switchFile } = setup();
        switchFile();
        expect(navigate).toHaveBeenCalledWith('/repo/src/b.ts', 'unstaged');
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
    });

    it('prompts while dirty and Cancel keeps the current file', () => {
        const save = vi.fn(async () => true);
        const { navigate, switchFile } = setup(save);
        act(() => current.onDirtyChange(true));
        switchFile();
        expect(navigate).not.toHaveBeenCalled();
        expect(screen.getByTestId('explorer-close-tabs-file').textContent).toBe('/repo/src/a.ts');
        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it("Don't Save navigates without writing", () => {
        const save = vi.fn(async () => true);
        const { navigate, switchFile } = setup(save);
        act(() => current.onDirtyChange(true));
        switchFile();
        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));
        expect(navigate).toHaveBeenCalledWith('/repo/src/b.ts', 'unstaged');
        expect(save).not.toHaveBeenCalled();
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
    });

    it('Save writes, then navigates', async () => {
        const save = vi.fn(async () => true);
        const { navigate, switchFile } = setup(save);
        act(() => current.onDirtyChange(true));
        switchFile();
        await act(async () => { fireEvent.click(screen.getByTestId('explorer-close-save-btn')); });
        expect(save).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/repo/src/b.ts', 'unstaged');
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).toBeNull();
    });

    it('a failed Save keeps the prompt open with an error and does not navigate', async () => {
        const save = vi.fn(async () => false);
        const { navigate, switchFile } = setup(save);
        act(() => current.onDirtyChange(true));
        switchFile();
        await act(async () => { fireEvent.click(screen.getByTestId('explorer-close-save-btn')); });
        expect(navigate).not.toHaveBeenCalled();
        expect(screen.getByTestId('explorer-close-tabs-error')).toBeTruthy();
    });

    it('Save with no registered save function fails safely', async () => {
        const { navigate, switchFile } = setup();
        act(() => current.onDirtyChange(true));
        switchFile();
        await act(async () => { fireEvent.click(screen.getByTestId('explorer-close-save-btn')); });
        expect(navigate).not.toHaveBeenCalled();
        expect(screen.getByTestId('explorer-close-tabs-error')).toBeTruthy();
    });
});
