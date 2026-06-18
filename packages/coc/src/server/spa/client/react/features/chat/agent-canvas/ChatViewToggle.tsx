// Segmented Thread / Agents toggle for the chat top bar. Switches between the
// linear transcript and the spatial agent-run canvas. Ported from the
// coc-chat design's `.view-seg`, styled with the app's light/dark tokens.

import { cn } from '../../../ui/cn';
import { AcIcons } from './icons';

export type ChatView = 'thread' | 'agents';

/**
 * The view that should be shown after selecting an agent from the canvas,
 * breadcrumb, or cascade menu: a sub-agent id opens the spatial 'agents'
 * context, while the orchestrator root (null) returns to the linear 'thread'.
 * Pure so the "Orchestrator → back to thread" navigation stays unit-testable.
 */
export function viewForAgentSelection(agentId: string | null): ChatView {
    return agentId ? 'agents' : 'thread';
}

interface ChatViewToggleProps {
    view: ChatView;
    onChange: (view: ChatView) => void;
}

function SegButton({ active, onClick, testid, children }: {
    active: boolean;
    onClick: () => void;
    testid: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            data-testid={testid}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                active
                    ? 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] shadow-sm'
                    : 'text-[#6b6b6b] dark:text-[#9d9d9d] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
            )}
        >
            {children}
        </button>
    );
}

export function ChatViewToggle({ view, onChange }: ChatViewToggleProps) {
    return (
        <div
            role="group"
            aria-label="Conversation view"
            data-testid="chat-view-toggle"
            className="inline-flex items-center rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#2a2a2b] p-0.5 mr-1"
        >
            <SegButton active={view === 'thread'} onClick={() => onChange('thread')} testid="chat-view-thread">
                <AcIcons.Thread size={13} />Thread
            </SegButton>
            <SegButton active={view === 'agents'} onClick={() => onChange('agents')} testid="chat-view-agents">
                <AcIcons.Tree size={13} />Agents
            </SegButton>
        </div>
    );
}
