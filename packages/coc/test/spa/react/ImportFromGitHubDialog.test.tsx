import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportFromGitHubDialog } from '../../../src/server/spa/client/react/features/work-items/ImportFromGitHubDialog';

const importFromGitHub = vi.fn();

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            importFromGitHub,
        },
    }),
}));

function renderDialog() {
    const onClose = vi.fn();
    const onImported = vi.fn();
    render(
        <ImportFromGitHubDialog
            open
            onClose={onClose}
            workspaceId="workspace-1"
            onImported={onImported}
        />,
    );
    return { onClose, onImported };
}

describe('ImportFromGitHubDialog', () => {
    beforeEach(() => {
        importFromGitHub.mockReset();
        importFromGitHub.mockResolvedValue({ id: 'epic-1', title: 'Imported Epic' });
    });

    it('submits a full GitHub issue URL unchanged', async () => {
        const { onClose, onImported } = renderDialog();

        fireEvent.change(screen.getByTestId('import-github-issue-input'), {
            target: { value: 'https://github.com/org/repo/issues/42' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Import'));
        });

        await waitFor(() => {
            expect(importFromGitHub).toHaveBeenCalledWith('workspace-1', {
                issueUrl: 'https://github.com/org/repo/issues/42',
            });
        });
        expect(onImported).toHaveBeenCalledWith({ id: 'epic-1', title: 'Imported Epic' });
        expect(onClose).toHaveBeenCalled();
    });

    it('submits a bare issue number against the workspace-configured repo', async () => {
        renderDialog();

        fireEvent.change(screen.getByTestId('import-github-issue-input'), {
            target: { value: ' 42 ' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Import'));
        });

        await waitFor(() => {
            expect(importFromGitHub).toHaveBeenCalledWith('workspace-1', { issueNumber: 42 });
        });
    });

    it('prompts for either URL or number before importing', async () => {
        renderDialog();

        await act(async () => {
            fireEvent.keyDown(screen.getByTestId('import-github-issue-input'), { key: 'Enter' });
        });

        expect(screen.getByTestId('import-github-error')).toHaveTextContent('Please enter a GitHub issue URL or issue number');
        expect(importFromGitHub).not.toHaveBeenCalled();
    });
});
