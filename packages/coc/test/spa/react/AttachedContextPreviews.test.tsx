// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachedContextPreviews } from '../../../src/server/spa/client/react/ui/AttachedContextPreviews';
import type { AttachedContextItem } from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';

function makeItem(overrides: Partial<AttachedContextItem> = {}): AttachedContextItem {
    return {
        kind: 'turn',
        id: 'ctx-1',
        turnIndex: 3,
        role: 'assistant',
        snippet: 'Some snippet content here',
        preview: 'Some snippet content here',
        ...overrides,
    };
}

describe('AttachedContextPreviews', () => {
    it('renders nothing when items array is empty', () => {
        const { container } = render(
            <AttachedContextPreviews items={[]} onRemove={vi.fn()} />,
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders a chip for each item', () => {
        const items = [
            makeItem({ id: 'ctx-1', turnIndex: 1, role: 'user', preview: 'User message' }),
            makeItem({ id: 'ctx-2', turnIndex: 2, role: 'assistant', preview: 'Assistant reply' }),
        ];
        render(<AttachedContextPreviews items={items} onRemove={vi.fn()} />);
        const chips = screen.getAllByTestId('attached-context-chip');
        expect(chips).toHaveLength(2);
    });

    it('displays the role label', () => {
        render(
            <AttachedContextPreviews
                items={[makeItem({ turnIndex: 5, role: 'assistant' })]}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByText('Assistant')).toBeTruthy();
    });

    it('displays "You" label for user role', () => {
        render(
            <AttachedContextPreviews
                items={[makeItem({ role: 'user', turnIndex: 2 })]}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByText('You')).toBeTruthy();
    });

    it('displays the preview text', () => {
        render(
            <AttachedContextPreviews
                items={[makeItem({ preview: 'This is a preview' })]}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByText('This is a preview')).toBeTruthy();
    });

    it('calls onRemove with the item id when dismiss button is clicked', () => {
        const onRemove = vi.fn();
        render(
            <AttachedContextPreviews
                items={[makeItem({ id: 'remove-me' })]}
                onRemove={onRemove}
            />,
        );
        fireEvent.click(screen.getByTestId('attached-context-remove'));
        expect(onRemove).toHaveBeenCalledWith('remove-me');
    });

    it('renders the 📎 icon', () => {
        render(
            <AttachedContextPreviews
                items={[makeItem()]}
                onRemove={vi.fn()}
            />,
        );
        expect(screen.getByText('📎')).toBeTruthy();
    });

    it('applies custom className', () => {
        render(
            <AttachedContextPreviews
                items={[makeItem()]}
                onRemove={vi.fn()}
                className="my-custom-class"
            />,
        );
        const container = screen.getByTestId('attached-context-previews');
        expect(container.classList.contains('my-custom-class')).toBe(true);
    });

    it('uses custom data-testid', () => {
        render(
            <AttachedContextPreviews
                items={[makeItem()]}
                onRemove={vi.fn()}
                data-testid="custom-test-id"
            />,
        );
        expect(screen.getByTestId('custom-test-id')).toBeTruthy();
    });

    it('renders session context identity details', () => {
        render(
            <AttachedContextPreviews
                items={[{
                    kind: 'session',
                    id: 'ctx-session',
                    sourceWorkspaceId: 'ws-1',
                    sourceProcessId: 'process-1234567890',
                    title: 'Debug source session',
                    status: 'failed',
                    lastActivityAt: '2026-01-01T00:00:00.000Z',
                    preview: 'Debug source session',
                }]}
                onRemove={vi.fn()}
            />,
        );

        expect(screen.getByTestId('attached-session-context-chip').textContent).toContain('Session');
        expect(screen.getByTestId('attached-session-context-chip').textContent).toContain('Debug source session');
        expect(screen.getByTestId('attached-session-context-meta').textContent).toContain('failed');
        expect(screen.getByTestId('attached-session-context-meta').textContent).toContain('process-…7890');
    });

    it('renders Ralph session context identity details with a purple Ralph chip', () => {
        render(
            <AttachedContextPreviews
                items={[{
                    kind: 'ralph-session',
                    id: 'ctx-ralph',
                    sourceWorkspaceId: 'ws-1',
                    sourceRalphSessionId: 'ralph-session-0001',
                    title: 'Ralph source',
                    displayLabel: 'Ralph source - 2 iter',
                    phase: 'executing',
                    status: 'running',
                    lastActivityAt: '2026-01-01T00:00:00.000Z',
                    childProcessIds: ['grill-proc', 'iter-1', 'iter-2'],
                    processCount: 3,
                    iterationCount: 2,
                    preview: 'Ralph source',
                }]}
                onRemove={vi.fn()}
            />,
        );

        const chip = screen.getByTestId('attached-ralph-context-chip');
        expect(chip.textContent).toContain('RALPH');
        expect(chip.textContent).toContain('Ralph source - 2 iter');
        expect(chip.className).toContain('border-purple-300');
        expect(screen.getByTestId('attached-ralph-context-meta').textContent).toContain('executing/running');
        expect(screen.getByTestId('attached-ralph-context-meta').textContent).toContain('3 processes');
        expect(screen.getByTestId('attached-ralph-context-meta').textContent).toContain('2 iterations');
        expect(screen.getByTestId('attached-ralph-context-meta').textContent).toContain('ralph-se…0001');
    });

    it('renders pointer context chips with stable labels and metadata', () => {
        render(
            <AttachedContextPreviews
                items={[
                    {
                        kind: 'work-item',
                        id: 'ctx-work-item',
                        sourceWorkspaceId: 'ws-1',
                        workItemId: 'wi-123',
                        workItemNumber: 123,
                        label: 'Work Item #123',
                        title: 'Fix context drag',
                        status: 'planning',
                        type: 'bug',
                        preview: 'Work Item #123',
                    },
                    {
                        kind: 'commit',
                        id: 'ctx-commit',
                        sourceWorkspaceId: 'ws-1',
                        commitHash: 'abcdef1234567890',
                        shortHash: 'abcdef1',
                        label: 'Commit abcdef1',
                        subject: 'Add context drag',
                        title: 'Add context drag',
                        preview: 'Commit abcdef1',
                    },
                    {
                        kind: 'range',
                        id: 'ctx-range',
                        sourceWorkspaceId: 'ws-1',
                        baseRef: 'origin/main',
                        headRef: 'feature/context-drag',
                        label: 'Range origin/main..feature/context-drag',
                        branchName: 'feature/context-drag',
                        commitCount: 4,
                        fileCount: 12,
                        preview: 'Range origin/main..feature/context-drag',
                    },
                    {
                        kind: 'pull-request',
                        id: 'ctx-pr',
                        sourceWorkspaceId: 'ws-1',
                        pullRequestId: '45',
                        number: 45,
                        label: 'PR #45',
                        title: 'Review context drag',
                        status: 'open',
                        preview: 'PR #45',
                    },
                ]}
                onRemove={vi.fn()}
            />,
        );

        expect(screen.getByTestId('attached-work-item-context-chip').textContent).toContain('Work Item #123');
        expect(screen.getByTestId('attached-commit-context-chip').textContent).toContain('Commit abcdef1');
        expect(screen.getByTestId('attached-range-context-chip').textContent).toContain('Range origin/main..feature/context-drag');
        expect(screen.getByTestId('attached-pull-request-context-chip').textContent).toContain('PR #45');
        expect(screen.getByTestId('attached-work-item-context-chip').textContent).toContain('planning');
        expect(screen.getByTestId('attached-commit-context-chip').textContent).toContain('Add context drag');
        expect(screen.getByTestId('attached-range-context-chip').textContent).toContain('4 commits');
        expect(screen.getByTestId('attached-pull-request-context-chip').textContent).toContain('open');
    });
});
