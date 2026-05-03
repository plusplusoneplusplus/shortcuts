import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionGroup } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-attention-groups';
import type { PullRequest } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

const mockFetchApi = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: mockFetchApi,
}));

const templates = [
    {
        key: '/rerun',
        description: 'Rerun failed checks',
        templateText: 'Inspect pull requests {{prNumbers}} and trigger a rerun.\n\n{{prList}}',
    },
    {
        key: '/nudge',
        description: 'Nudge reviewers',
        templateText: 'Ask reviewers to follow up on {{prNumbers}}.',
    },
];

const selectedPrs: PullRequest[] = [
    makePr(123, 'Add memory reconciliation'),
    makePr(128, 'Fix auth edge case'),
    makePr(140, 'Update README'),
];

function makePr(number: number, title: string): PullRequest {
    return {
        id: number,
        number,
        title,
        sourceBranch: `feature/pr-${number}`,
        targetBranch: 'main',
        status: 'open',
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-01-16T12:30:00Z',
        author: { displayName: 'Alice' },
        reviewers: [],
    };
}

async function renderPanel(onClearSelection = vi.fn()) {
    mockFetchApi.mockResolvedValueOnce(templates);
    const { BatchCommandPanel } = await import(
        '../../../../../src/server/spa/client/react/features/pull-requests/BatchCommandPanel'
    );

    await act(async () => {
        render(
            <BatchCommandPanel
                selectedPrIds={new Set(selectedPrs.map(pr => String(pr.number)))}
                selectedPrs={selectedPrs}
                repoId="repo-1"
                workspaceId="ws-1"
                activeGroup={AttentionGroup.RerunNeeded}
                onClearSelection={onClearSelection}
            />,
        );
    });

    await waitFor(() => expect(screen.getByTestId('batch-command-input')).toHaveValue('/rerun'));
    return { onClearSelection };
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
});

describe('BatchCommandPanel', () => {
    it('lists selected PRs and resolves the default group template', async () => {
        await renderPanel();

        expect(screen.getByTestId('batch-command-heading')).toHaveTextContent('Batch: Rerun needed');
        expect(screen.getByTestId('batch-selected-pr-list')).toHaveTextContent('#123 Add memory reconciliation');
        expect(screen.getByTestId('batch-selected-pr-list')).toHaveTextContent('#128 Fix auth edge case');
        expect(screen.getByTestId('batch-selected-pr-list')).toHaveTextContent('#140 Update README');
        const preview = screen.getByTestId('batch-prompt-preview') as HTMLTextAreaElement;
        expect(preview.value).toContain('Inspect pull requests #123, #128, #140');
        expect(preview.value).toContain('#123 Add memory reconciliation');
    });

    it('updates the prompt preview when the command changes to another template', async () => {
        await renderPanel();

        fireEvent.change(screen.getByTestId('batch-command-input'), { target: { value: '/nudge' } });

        expect(screen.getByTestId('batch-prompt-preview')).toHaveValue('Ask reviewers to follow up on #123, #128, #140.');
    });

    it('preserves manual prompt edits and stops auto-resolving on later command changes', async () => {
        await renderPanel();

        fireEvent.change(screen.getByTestId('batch-prompt-preview'), { target: { value: 'Manually edited prompt' } });
        fireEvent.change(screen.getByTestId('batch-command-input'), { target: { value: '/nudge' } });

        expect(screen.getByTestId('batch-prompt-preview')).toHaveValue('Manually edited prompt');
    });

    it('shows slash-command autocomplete and inserts the selected command', async () => {
        await renderPanel();

        fireEvent.change(screen.getByTestId('batch-command-input'), { target: { value: '/', selectionStart: 1 } });
        expect(screen.getByTestId('slash-command-menu')).toBeInTheDocument();

        fireEvent.mouseDown(screen.getByText('nudge'));

        expect(screen.getByTestId('batch-command-input')).toHaveValue('/nudge');
        expect(screen.queryByTestId('slash-command-menu')).toBeNull();
        expect(screen.getByTestId('batch-prompt-preview')).toHaveValue('Ask reviewers to follow up on #123, #128, #140.');
    });

    it('queues a pr-batch task and clears selection after success', async () => {
        const onClearSelection = vi.fn();
        const rendered = await renderPanel(onClearSelection);
        mockFetchApi.mockResolvedValueOnce({ task: { id: 'task-1' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('queue-batch-job'));
        });

        expect(mockFetchApi).toHaveBeenLastCalledWith('/queue', {
            method: 'POST',
            body: JSON.stringify({
                type: 'chat',
                displayName: 'PR Batch: /rerun (3 PRs)',
                payload: {
                    kind: 'pr-batch',
                    workspaceId: 'ws-1',
                    repoId: 'repo-1',
                    prNumbers: [123, 128, 140],
                    action: '/rerun',
                    promptText: 'Inspect pull requests #123, #128, #140 and trigger a rerun.\n\n#123 Add memory reconciliation\n#128 Fix auth edge case\n#140 Update README',
                },
            }),
        });
        expect(rendered.onClearSelection).toHaveBeenCalledTimes(1);
    });

    it('disables queue submission while the command is empty', async () => {
        await renderPanel();

        fireEvent.change(screen.getByTestId('batch-command-input'), { target: { value: '' } });

        expect(screen.getByTestId('queue-batch-job')).toBeDisabled();
    });
});
