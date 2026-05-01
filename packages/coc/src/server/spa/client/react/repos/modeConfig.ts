export type ChatMode = 'ask' | 'plan' | 'autopilot';

export const MODE_BORDER_COLORS: Record<ChatMode, { border: string; ring: string }> = {
    autopilot: { border: 'border-green-500 dark:border-green-400', ring: 'focus:ring-green-500/50' },
    ask: { border: 'border-yellow-500 dark:border-yellow-400', ring: 'focus:ring-yellow-500/50' },
    plan: { border: 'border-blue-500 dark:border-blue-400', ring: 'focus:ring-blue-500/50' },
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
