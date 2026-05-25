/**
 * ProviderBadge — small neutral pill showing the AI provider for a chat.
 *
 * Renders a compact badge with the provider label ("Copilot", "Codex", or "Claude").
 * Used in the chat detail header and chat list rows to record which agent
 * handled (or is handling) the chat.
 *
 * Design decisions:
 * - Codex: emerald-tinted badge to distinguish from the default Copilot.
 * - Claude: violet/purple-tinted badge to distinguish from Codex and Copilot.
 * - Copilot: subtle gray badge (only shown when provider is explicitly set).
 * - Badge is always read-only; clicking does nothing.
 */

import { cn } from '../../ui/cn';

export type ChatProvider = 'copilot' | 'codex' | 'claude';

export interface ProviderBadgeProps {
    provider: ChatProvider;
    className?: string;
}

export function ProviderBadge({ provider, className }: ProviderBadgeProps) {
    const label = provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : 'Copilot';

    const variantClasses =
        provider === 'codex'
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-400/50 dark:border-emerald-500/50'
            : provider === 'claude'
            ? 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-400/50 dark:border-violet-500/50'
            : 'bg-[#f3f3f3] dark:bg-[#2a2a2a] text-[#6b6b6b] dark:text-[#999] border-[#d0d0d0]/70 dark:border-[#4a4a4a]';

    return (
        <span
            className={cn(
                'provider-badge inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border flex-shrink-0',
                variantClasses,
                className,
            )}
            data-testid="provider-badge"
            data-provider={provider}
            title={`Agent: ${label}`}
        >
            {label}
        </span>
    );
}
