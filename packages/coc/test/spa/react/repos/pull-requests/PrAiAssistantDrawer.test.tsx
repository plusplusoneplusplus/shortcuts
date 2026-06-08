/**
 * Tests for the slide-over chrome around `PullRequestChatPanel`.
 *
 * The drawer no longer owns chat state — it just renders the side-panel
 * shell and forwards props to the embedded panel.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Stub the chat panel so this test stays focused on the drawer chrome.
const mockPanelProps = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/features/pull-requests/PullRequestChatPanel', () => ({
    PullRequestChatPanel: (props: any) => {
        mockPanelProps(props);
        return (
            <div
                data-testid="pr-chat-panel-stub"
                data-workspace-id={props.workspaceId}
                data-pr-id={props.prId}
                data-pr-number={props.prNumber}
                data-pr-title={props.prTitle}
                data-repo-id={props.repoId}
            />
        );
    },
}));

import { PrAiAssistantDrawer } from '../../../../../src/server/spa/client/react/features/pull-requests/PrAiAssistantDrawer';
import { PullRequestChatPlacementFrame } from '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestChatPlacementFrame';

beforeEach(() => {
    mockPanelProps.mockReset();
});

describe('PrAiAssistantDrawer', () => {
    it('renders the embedded PullRequestChatPanel with PR props', () => {
        render(
            <PrAiAssistantDrawer
                open
                onClose={vi.fn()}
                workspaceId="repo-1"
                repoId="repo-1"
                prId="142"
                prNumber={142}
                prTitle="Add retry logic"
            />,
        );

        const panel = screen.getByTestId('pr-chat-panel-stub');
        expect(panel.getAttribute('data-workspace-id')).toBe('repo-1');
        expect(panel.getAttribute('data-pr-id')).toBe('142');
        expect(panel.getAttribute('data-pr-number')).toBe('142');
        expect(panel.getAttribute('data-pr-title')).toBe('Add retry logic');
        expect(panel.getAttribute('data-repo-id')).toBe('repo-1');
    });

    it('reports aria-hidden=true when closed and false when open', () => {
        const { rerender } = render(
            <PrAiAssistantDrawer
                open={false}
                onClose={vi.fn()}
                workspaceId="repo-1"
                prId="142"
            />,
        );
        expect(screen.getByTestId('pr-ai-assistant').getAttribute('aria-hidden')).toBe('true');

        rerender(
            <PrAiAssistantDrawer
                open
                onClose={vi.fn()}
                workspaceId="repo-1"
                prId="142"
            />,
        );
        expect(screen.getByTestId('pr-ai-assistant').getAttribute('aria-hidden')).toBe('false');
    });

    it('renders the mobile backdrop only when open', () => {
        const { rerender } = render(
            <PrAiAssistantDrawer
                open={false}
                onClose={vi.fn()}
                workspaceId="repo-1"
                prId="142"
            />,
        );
        expect(screen.queryByTestId('pr-ai-assistant-backdrop')).not.toBeInTheDocument();

        rerender(
            <PrAiAssistantDrawer
                open
                onClose={vi.fn()}
                workspaceId="repo-1"
                prId="142"
            />,
        );
        expect(screen.getByTestId('pr-ai-assistant-backdrop')).toBeInTheDocument();
    });

    it('calls onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <PrAiAssistantDrawer
                open
                onClose={onClose}
                workspaceId="repo-1"
                prId="142"
            />,
        );
        fireEvent.click(screen.getByTestId('pr-ai-assistant-close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the backdrop is clicked', () => {
        const onClose = vi.fn();
        render(
            <PrAiAssistantDrawer
                open
                onClose={onClose}
                workspaceId="repo-1"
                prId="142"
            />,
        );
        fireEvent.click(screen.getByTestId('pr-ai-assistant-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders shared framed side-panel chrome with an unpin action when requested', () => {
        const onUnpin = vi.fn();
        render(
            <PrAiAssistantDrawer
                open
                onClose={vi.fn()}
                onUnpin={onUnpin}
                workspaceId="repo-1"
                repoId="repo-1"
                prId="142"
                prNumber={142}
                prTitle="Add retry logic"
                presentation="side-panel"
            />,
        );

        expect(screen.getByTestId('pr-chat-side-panel')).toBeInTheDocument();
        expect(screen.getByTestId('pr-chat-side-panel-header')).toHaveTextContent('PR Chat');
        expect(screen.getByTestId('pr-chat-side-panel-header')).toHaveTextContent('#142');
        expect(screen.queryByText('Ask about this PR')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('pr-chat-unpin-btn'));
        expect(onUnpin).toHaveBeenCalledTimes(1);
    });
});

describe('PullRequestChatPlacementFrame', () => {
    it('renders a visible top-left resize grip for PR lenses', () => {
        render(
            <PullRequestChatPlacementFrame
                workspaceId="repo-1"
                repoId="repo-1"
                prId="142"
                prNumber={142}
                prTitle="Add retry logic"
                presentation="lens"
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByTestId('pr-chat-lens-resize-grip')).toHaveClass('cursor-nwse-resize');
    });

    it('renders a compact restorable PR lens pill when minimized', () => {
        const onRestore = vi.fn();

        render(
            <PullRequestChatPlacementFrame
                workspaceId="repo-1"
                repoId="repo-1"
                prId="142"
                prNumber={142}
                prTitle="Add retry logic"
                presentation="lens"
                onClose={vi.fn()}
                isMinimized
                onRestore={onRestore}
            />,
        );

        expect(screen.getByTestId('pr-chat-lens-minimized')).toHaveTextContent('PR Chat');
        expect(screen.getByTestId('pr-chat-lens-minimized')).toHaveTextContent('#142');
        expect(screen.getByTestId('pr-chat-lens-hidden-body')).toHaveClass('hidden');
        expect(screen.getByTestId('pr-chat-panel-stub')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('pr-chat-restore-btn'));

        expect(onRestore).toHaveBeenCalledOnce();
    });
});
