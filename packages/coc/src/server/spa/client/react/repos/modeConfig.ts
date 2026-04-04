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

const NEXT_MODE: Record<ChatMode, ChatMode> = {
    autopilot: 'ask',
    ask: 'autopilot',
    plan: 'autopilot',
};

export function cycleMode(current: ChatMode): ChatMode {
    return NEXT_MODE[current];
}
