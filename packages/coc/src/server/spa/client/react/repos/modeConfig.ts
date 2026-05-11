export type ChatMode = 'ask' | 'plan' | 'autopilot' | 'ralph';

/**
 * Per-mode visual identity tokens for chat-input cards.
 *
 * `ring` MUST use the `focus-within:` prefix (not `focus:`) so the colour
 * propagates to the stacked card's `focus-within:ring-2` activator on the
 * parent <div> — the focused element is a contenteditable child, so plain
 * `focus:` wouldn't match the parent and the ring would fall back to
 * Tailwind's default blue, producing a blue/mode-colour border conflict.
 *
 * Opacity is held at `/30` so the ring complements rather than competes
 * with the solid mode-coloured border.
 */
export const MODE_BORDER_COLORS: Record<ChatMode, { border: string; ring: string }> = {
    autopilot: { border: 'border-green-500 dark:border-green-400', ring: 'focus-within:ring-green-500/30' },
    ask: { border: 'border-yellow-500 dark:border-yellow-400', ring: 'focus-within:ring-yellow-500/30' },
    plan: { border: 'border-blue-500 dark:border-blue-400', ring: 'focus-within:ring-blue-500/30' },
    ralph: { border: 'border-purple-500 dark:border-purple-400', ring: 'focus-within:ring-purple-500/30' },
};

export const MODE_ICONS: Record<ChatMode, string> = {
    ask: '💡',
    plan: '📋',
    autopilot: '🤖',
    ralph: '🔄',
};

/**
 * Per-mode accent text colors for in-conversation labels (e.g. the mode-change divider).
 * Mirrors the border accents from `MODE_BORDER_COLORS` but as text classes.
 */
export const MODE_TEXT_COLORS: Record<ChatMode, string> = {
    autopilot: 'text-green-600 dark:text-green-400',
    ask: 'text-yellow-600 dark:text-yellow-400',
    plan: 'text-blue-600 dark:text-blue-400',
    ralph: 'text-purple-600 dark:text-purple-400',
};

export const MODE_LABELS: Record<ChatMode, string> = {
    ask: '💡 Ask',
    plan: '📋 Plan',
    autopilot: '🤖 Autopilot',
    ralph: '🔄 Ralph',
};

export const MODE_TOOLTIPS: Record<ChatMode, string> = {
    ask: 'Ask — get answers without making changes',
    plan: 'Plan — create a step-by-step plan',
    autopilot: 'Autopilot — execute changes automatically',
    ralph: 'Ralph — iterative AI coding loop with guided goal setting',
};

const MODE_ORDER: ChatMode[] = ['ask', 'plan', 'autopilot'];

export function cycleMode(current: ChatMode, allowedModes?: ChatMode[]): ChatMode {
    const modes = allowedModes ?? MODE_ORDER;
    const idx = modes.indexOf(current);
    return modes[(idx + 1) % modes.length];
}
