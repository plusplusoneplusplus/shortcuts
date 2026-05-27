/**
 * ProviderBadge — pill-style indicator showing the AI provider for a chat.
 *
 * Visual contract mirrors `ChatStatusPill` (the "Thinking" pill in the chat
 * header): a rounded-full bordered pill with a leading colored dot followed
 * by the provider label ("Copilot", "Codex", or "Claude"). Provider-specific
 * brand colors set the dot, text, and border tints:
 *
 *   - Copilot — green (matches the existing assistant avatar accent)
 *   - Claude  — warm coral/orange (Anthropic brand)
 *   - Codex   — indigo/blue-purple (OpenAI Codex cloud icon palette)
 *
 * The same provider palette also drives the assistant turn avatar so the
 * avatar's color tracks whichever provider produced the response. Consumers
 * outside this file should use {@link getProviderAvatarClasses} to opt into
 * the shared palette.
 */

import { cn } from '../../ui/cn';

export type ChatProvider = 'copilot' | 'codex' | 'claude';

interface ProviderColorVariant {
    /** Pill border + bg + text classes (matches ChatStatusPill `variant.pill`). */
    pill: string;
    /** Leading dot color classes. */
    dot: string;
    /** Round avatar (assistant turn) color classes — bg + text + border, light + dark. */
    avatar: string;
}

const PROVIDER_VARIANTS: Record<ChatProvider, ProviderColorVariant> = {
    copilot: {
        pill: 'border-[#16825d]/40 bg-[#16825d]/10 text-[#16825d] dark:text-[#89d185]',
        dot: 'bg-[#16825d] dark:bg-[#89d185]',
        avatar:
            'bg-[#dafbe1] text-[#15703a] border-[#b8e6c1]'
            + ' dark:bg-[#0f3a1f] dark:text-[#4ade80] dark:border-[#225a32]',
    },
    claude: {
        pill: 'border-[#d97757]/45 bg-[#d97757]/12 text-[#b5532c] dark:text-[#f4a17d]',
        dot: 'bg-[#d97757] dark:bg-[#f4a17d]',
        avatar:
            'bg-[#fdece1] text-[#b5532c] border-[#f5c7a8]'
            + ' dark:bg-[#3d1f10] dark:text-[#f4a17d] dark:border-[#6b3520]',
    },
    codex: {
        pill: 'border-[#6366f1]/45 bg-[#6366f1]/12 text-[#4f46e5] dark:text-[#a5b4fc]',
        dot: 'bg-[#6366f1] dark:bg-[#a5b4fc]',
        avatar:
            'bg-[#eef0ff] text-[#4f46e5] border-[#c7d2fe]'
            + ' dark:bg-[#1a1c3d] dark:text-[#a5b4fc] dark:border-[#3c40a0]',
    },
};

/**
 * Returns the Tailwind class string for the round assistant-turn avatar that
 * corresponds to the given provider. Falls back to Copilot's palette for
 * unknown / undefined providers so the visual stays in the existing green
 * family (no surprise color shift when provider metadata is missing).
 */
export function getProviderAvatarClasses(provider: ChatProvider | undefined): string {
    if (provider && PROVIDER_VARIANTS[provider]) {
        return PROVIDER_VARIANTS[provider].avatar;
    }
    return PROVIDER_VARIANTS.copilot.avatar;
}

export interface ProviderBadgeProps {
    provider: ChatProvider;
    className?: string;
}

export function ProviderBadge({ provider, className }: ProviderBadgeProps) {
    const label = provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : 'Copilot';
    const variant = PROVIDER_VARIANTS[provider] ?? PROVIDER_VARIANTS.copilot;

    return (
        <span
            className={cn(
                'provider-badge inline-flex items-center gap-1.5 border rounded-full whitespace-nowrap',
                'text-[11px] leading-none font-medium h-[20px] px-2 flex-shrink-0',
                variant.pill,
                className,
            )}
            data-testid="provider-badge"
            data-provider={provider}
            title={`Agent: ${label}`}
        >
            <span
                className={cn('inline-block w-[6px] h-[6px] rounded-full flex-shrink-0', variant.dot)}
                aria-hidden="true"
            />
            <span>{label}</span>
        </span>
    );
}
