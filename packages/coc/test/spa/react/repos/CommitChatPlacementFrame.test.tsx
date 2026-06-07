import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: (props: any) => (
        <div
            data-testid="commit-chat-panel"
            data-workspace-id={props.workspaceId}
            data-commit-hash={props.commitHash}
            data-commit-message={props.commitMessage ?? ''}
            data-hide-empty-header={props.hideEmptyHeader ? 'true' : 'false'}
        />
    ),
}));

import { CommitChatPlacementFrame } from '../../../../src/server/spa/client/react/features/git/commits/CommitChatPlacementFrame';

describe('CommitChatPlacementFrame', () => {
    it('renders a bottom-right lens frame with close and pin actions', () => {
        const onClose = vi.fn();
        const onPin = vi.fn();

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                commitMessage="fix: lens"
                presentation="lens"
                onClose={onClose}
                onPin={onPin}
            />,
        );

        const lens = screen.getByTestId('commit-chat-lens');
        expect(lens.className).toContain('absolute');
        expect(lens.className).toContain('bottom-4');
        expect(lens.className).toContain('right-4');
        expect(lens.className).toContain('max-w-[420px]');
        expect(lens.className).toContain('max-h-[55vh]');
        expect(screen.getByTestId('commit-chat-lens-header')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-panel').getAttribute('data-hide-empty-header')).toBe('true');

        fireEvent.click(screen.getByTestId('commit-chat-pin-btn'));
        fireEvent.click(screen.getByTestId('commit-chat-frame-close-btn'));

        expect(onPin).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('renders a side-panel frame with an unpin action', () => {
        const onUnpin = vi.fn();

        render(
            <CommitChatPlacementFrame
                workspaceId="ws1"
                commitHash="abc123def456"
                presentation="side-panel"
                onClose={() => {}}
                onUnpin={onUnpin}
            />,
        );

        expect(screen.getByTestId('commit-chat-side-panel')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-side-panel-header')).toBeTruthy();
        expect(screen.queryByTestId('commit-chat-pin-btn')).toBeNull();

        fireEvent.click(screen.getByTestId('commit-chat-unpin-btn'));

        expect(onUnpin).toHaveBeenCalledOnce();
    });
});
