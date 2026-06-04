import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ImportFromGitHubDialog } from '../../../src/server/spa/client/react/features/work-items/ImportFromGitHubDialog';

const importFromGitHub = vi.fn();
const importFromAzureBoards = vi.fn();

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            importFromGitHub,
            importFromAzureBoards,
        },
    }),
}));

function renderDialog(props: Partial<ComponentProps<typeof ImportFromGitHubDialog>> = {}) {
    const onClose = vi.fn();
    const onImported = vi.fn();
    render(
        <ImportFromGitHubDialog
            open
            onClose={onClose}
            workspaceId="workspace-1"
            onImported={onImported}
            {...props}
        />,
    );
    return { onClose, onImported };
}

describe('ImportFromGitHubDialog', () => {
    beforeEach(() => {
        importFromGitHub.mockReset();
        importFromAzureBoards.mockReset();
        importFromGitHub.mockResolvedValue({ id: 'epic-1', title: 'Imported Epic' });
        importFromAzureBoards.mockResolvedValue({ id: 'epic-azure', title: 'Imported Azure Epic' });
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
        expect(onImported).toHaveBeenCalledWith({ id: 'epic-1', title: 'Imported Epic' }, 'github');
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

    it('submits a bare Azure Boards work item ID against the workspace-configured project', async () => {
        const { onClose, onImported } = renderDialog();

        fireEvent.click(screen.getByTestId('import-provider-azure-boards'));
        fireEvent.change(screen.getByTestId('import-azure-boards-work-item-input'), {
            target: { value: ' 12345 ' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Import'));
        });

        await waitFor(() => {
            expect(importFromAzureBoards).toHaveBeenCalledWith('workspace-1', { workItemId: 12345 });
        });
        expect(importFromGitHub).not.toHaveBeenCalled();
        expect(onImported).toHaveBeenCalledWith({ id: 'epic-azure', title: 'Imported Azure Epic' }, 'azure-boards');
        expect(onClose).toHaveBeenCalled();
    });

    it('submits a full Azure Boards work item URL unchanged', async () => {
        renderDialog();

        fireEvent.click(screen.getByTestId('import-provider-azure-boards'));
        fireEvent.change(screen.getByTestId('import-azure-boards-work-item-input'), {
            target: { value: 'https://dev.azure.com/org/project/_workitems/edit/12345' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Import'));
        });

        await waitFor(() => {
            expect(importFromAzureBoards).toHaveBeenCalledWith('workspace-1', {
                workItemUrl: 'https://dev.azure.com/org/project/_workitems/edit/12345',
            });
        });
    });

    it('hides provider selection and imports with the only allowed GitHub provider', async () => {
        renderDialog({ initialProvider: 'github', providerOptions: ['github'] });

        expect(screen.queryByTestId('import-provider-selector')).toBeNull();
        expect(screen.queryByTestId('import-provider-azure-boards')).toBeNull();
        fireEvent.change(screen.getByTestId('import-github-issue-input'), {
            target: { value: '42' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Import'));
        });

        await waitFor(() => {
            expect(importFromGitHub).toHaveBeenCalledWith('workspace-1', { issueNumber: 42 });
        });
        expect(importFromAzureBoards).not.toHaveBeenCalled();
    });

    it('hides provider selection and imports with the only allowed Azure Boards provider', async () => {
        renderDialog({ initialProvider: 'azure-boards', providerOptions: ['azure-boards'] });

        expect(screen.queryByTestId('import-provider-selector')).toBeNull();
        expect(screen.queryByTestId('import-provider-github')).toBeNull();
        fireEvent.change(screen.getByTestId('import-azure-boards-work-item-input'), {
            target: { value: '12345' },
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Import'));
        });

        await waitFor(() => {
            expect(importFromAzureBoards).toHaveBeenCalledWith('workspace-1', { workItemId: 12345 });
        });
        expect(importFromGitHub).not.toHaveBeenCalled();
    });

    it('prompts for either URL or number before importing', async () => {
        renderDialog();

        await act(async () => {
            fireEvent.keyDown(screen.getByTestId('import-github-issue-input'), { key: 'Enter' });
        });

        expect(screen.getByTestId('import-github-error')).toHaveTextContent('Please enter a GitHub issue URL or issue number');
        expect(importFromGitHub).not.toHaveBeenCalled();
    });

    it('prompts for either Azure URL or ID before importing', async () => {
        renderDialog();

        fireEvent.click(screen.getByTestId('import-provider-azure-boards'));
        await act(async () => {
            fireEvent.keyDown(screen.getByTestId('import-azure-boards-work-item-input'), { key: 'Enter' });
        });

        expect(screen.getByTestId('import-azure-boards-error')).toHaveTextContent('Please enter an Azure Boards work item URL or ID');
        expect(importFromAzureBoards).not.toHaveBeenCalled();
    });
});
