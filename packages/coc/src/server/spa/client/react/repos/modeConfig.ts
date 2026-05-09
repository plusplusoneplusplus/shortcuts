export type ChatMode = 'ask' | 'plan' | 'autopilot';

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
};

export const MODE_ICONS: Record<ChatMode, string> = {
    ask: '💡',
    plan: '📋',
    autopilot: '🤖',
};

export const MODE_LABELS: Record<ChatMode, string> = {
    ask: '💡 Ask',
    plan: '📋 Plan',
    autopilot: '🤖 Autopilot',
};

export const MODE_TOOLTIPS: Record<ChatMode, string> = {
    ask: 'Ask — get answers without making changes',
    plan: 'Plan — create a step-by-step plan',
    autopilot: 'Autopilot — execute changes automatically',
};

const MODE_ORDER: ChatMode[] = ['ask', 'plan', 'autopilot'];

export function cycleMode(current: ChatMode, allowedModes?: ChatMode[]): ChatMode {
    const modes = allowedModes ?? MODE_ORDER;
    const idx = modes.indexOf(current);
    return modes[(idx + 1) % modes.length];
}
