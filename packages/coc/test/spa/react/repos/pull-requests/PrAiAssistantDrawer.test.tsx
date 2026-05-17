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
});
