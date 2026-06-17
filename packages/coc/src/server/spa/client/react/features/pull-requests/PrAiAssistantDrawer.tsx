/**
 * Slide-over chrome around `PullRequestChatPanel`.
 *
 * The drawer slides in from the right and renders the same chat-binding
 * surface used by commit chat. Visual chrome (backdrop, animation, close
 * button) is owned here; chat state lives entirely in the embedded panel.
 */

import { cn } from '../../ui';
import { PullRequestChatPanel } from './PullRequestChatPanel';
import { PullRequestChatPlacementFrame } from './PullRequestChatPlacementFrame';
import type { ReviewChatPresentation } from '../git/commits/commitChatPlacement';

export interface PrAiAssistantDrawerProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string;
    remoteUrl?: string | null;
    /** Stringified PR identifier — stable per provider. */
    prId: string;
    prNumber?: number;
    prTitle?: string;
    /** Repo identifier the PR belongs to (typically equal to workspaceId). */
    repoId?: string;
    /** When set, render the shared review-chat frame inside the drawer shell. */
    presentation?: ReviewChatPresentation;
    onUnpin?: () => void;
}

export function PrAiAssistantDrawer({
    open,
    onClose,
    workspaceId,
    remoteUrl,
    prId,
    prNumber,
    prTitle,
    repoId,
    presentation,
    onUnpin,
}: PrAiAssistantDrawerProps) {
    const chatContent = presentation ? (
        open ? (
            <PullRequestChatPlacementFrame
                workspaceId={workspaceId}
                remoteUrl={remoteUrl}
                prId={prId}
                prNumber={prNumber}
                prTitle={prTitle}
                repoId={repoId}
                presentation={presentation}
                onClose={onClose}
                onUnpin={onUnpin}
            />
        ) : null
    ) : (
        <>
            <header className="flex items-center justify-between gap-1.5 border-b border-gray-200 px-2 py-1.5 dark:border-gray-700">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Ask about this PR
                </h2>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close assistant"
                    className="grid h-6 w-6 place-items-center rounded-[5px] border border-gray-300 bg-white text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    data-testid="pr-ai-assistant-close"
                >
                    ×
                </button>
            </header>
            <div className="flex-1 min-h-0">
                <PullRequestChatPanel
                    workspaceId={workspaceId}
                    remoteUrl={remoteUrl}
                    prId={prId}
                    prNumber={prNumber}
                    prTitle={prTitle}
                    repoId={repoId}
                    onClose={onClose}
                />
            </div>
        </>
    );

    return (
        <>
            {open && (
                <button
                    type="button"
                    aria-label="Dismiss AI assistant"
                    onClick={onClose}
                    className="fixed inset-0 z-30 cursor-default bg-black/30 lg:hidden"
                    data-testid="pr-ai-assistant-backdrop"
                />
            )}
            <aside
                className={cn(
                    'fixed right-0 top-0 z-40 flex h-full w-[min(390px,92vw)] flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-200 ease-out dark:border-gray-700 dark:bg-gray-900',
                    open ? 'translate-x-0' : 'translate-x-full',
                )}
                aria-hidden={!open}
                data-testid="pr-ai-assistant"
            >
                {chatContent}
            </aside>
        </>
    );
}
