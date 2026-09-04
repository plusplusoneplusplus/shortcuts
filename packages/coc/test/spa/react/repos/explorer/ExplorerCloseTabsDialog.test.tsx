// @vitest-environment jsdom
/**
 * AC-04 (presentation): the Save / Don't Save / Cancel prompt itself. The
 * panel-level wiring is covered by ExplorerPanel.tabclose.test.tsx; this pins
 * the dialog's own contract — what it lists, which outcome each control
 * reports, and that it goes inert while a save is in flight.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ExplorerCloseTabsDialog } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerCloseTabsDialog';

afterEach(cleanup);

function setup(props: Partial<React.ComponentProps<typeof ExplorerCloseTabsDialog>> = {}) {
    const onSave = vi.fn();
    const onDontSave = vi.fn();
    const onCancel = vi.fn();
    render(
        <ExplorerCloseTabsDialog
            open
            paths={['src/a.ts']}
            onSave={onSave}
            onDontSave={onDontSave}
            onCancel={onCancel}
            {...props}
        />,
    );
    return { onSave, onDontSave, onCancel };
}

describe('ExplorerCloseTabsDialog', () => {
    it('renders nothing when closed', () => {
        setup({ open: false });
        expect(screen.queryByTestId('explorer-close-tabs-prompt')).not.toBeInTheDocument();
    });

    it('lists every affected file with its full path as the tooltip', () => {
        setup({ paths: ['src/a.ts', 'deep/nested/b.ts'] });
        const files = screen.getAllByTestId('explorer-close-tabs-file');
        expect(files.map(node => node.textContent)).toEqual(['src/a.ts', 'deep/nested/b.ts']);
        expect(files[1]).toHaveAttribute('title', 'deep/nested/b.ts');
        expect(screen.getByTestId('explorer-close-tabs-prompt')).toHaveTextContent('changes to 2 files');
    });

    it('reports each of the three outcomes', () => {
        const { onSave, onDontSave, onCancel } = setup();
        fireEvent.click(screen.getByTestId('explorer-close-save-btn'));
        fireEvent.click(screen.getByTestId('explorer-close-dont-save-btn'));
        fireEvent.click(screen.getByTestId('explorer-close-cancel-btn'));
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onDontSave).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('treats Escape as Cancel, so the tab set is never changed by dismissing', () => {
        const { onCancel, onDontSave } = setup();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onDontSave).not.toHaveBeenCalled();
    });

    it('disables every action while saving', () => {
        const { onSave } = setup({ saving: true });
        const save = screen.getByTestId('explorer-close-save-btn');
        expect(save).toBeDisabled();
        expect(save).toHaveTextContent('Saving…');
        expect(screen.getByTestId('explorer-close-dont-save-btn')).toBeDisabled();
        expect(screen.getByTestId('explorer-close-cancel-btn')).toBeDisabled();
        fireEvent.click(save);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('shows a failed save in the error style', () => {
        setup({ error: 'Failed to save the file.' });
        expect(screen.getByTestId('explorer-close-tabs-error')).toHaveTextContent('Failed to save the file.');
    });
});
