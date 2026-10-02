/**
 * Badge on a tool-call row saying how an approval-gated CoC LLM tool call was
 * settled. Rows for tools the repo does not gate carry no outcome and render
 * nothing.
 */

import type { ToolCallApprovalOutcome } from '../../../../types/dashboard';
import { cn } from '../../../../ui';

const BADGES: Record<ToolCallApprovalOutcome, { label: string; className: string }> = {
    'approve-once': {
        label: 'approved once',
        className: 'bg-[#dafbe1] text-[#1a7f37] dark:bg-[#1f3a2a] dark:text-[#85e89d]',
    },
    'approve-session': {
        label: 'approved for session',
        className: 'bg-[#dafbe1] text-[#1a7f37] dark:bg-[#1f3a2a] dark:text-[#85e89d]',
    },
    deny: {
        label: 'denied',
        className: 'bg-[#ffebe9] text-[#cf222e] dark:bg-[#3d1f22] dark:text-[#f97583]',
    },
    'auto-allowed': {
        label: 'auto-allowed (no user present)',
        className: 'bg-[#f5f5f4] text-[#6b7280] dark:bg-[#3c3c3c] dark:text-[#9aa0a6]',
    },
};

export function LlmToolApprovalBadge({ outcome }: { outcome?: ToolCallApprovalOutcome }) {
    const badge = outcome ? BADGES[outcome] : undefined;
    if (!badge) return null;
    return (
        <span
            className={cn('shrink-0 rounded-sm px-1.5 py-px font-sans text-[10.5px] font-medium', badge.className)}
            data-testid="tool-call-approval-badge"
            data-approval-outcome={outcome}
        >
            {badge.label}
        </span>
    );
}
