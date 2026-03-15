export type ChatMode = 'ask' | 'plan' | 'autopilot';

export const MODE_BORDER_COLORS: Record<ChatMode, { border: string; ring: string }> = {
    autopilot: { border: 'border-green-500 dark:border-green-400', ring: 'focus:ring-green-500/50' },
    ask: { border: 'border-yellow-500 dark:border-yellow-400', ring: 'focus:ring-yellow-500/50' },
    plan: { border: 'border-blue-500 dark:border-blue-400', ring: 'focus:ring-blue-500/50' },
};

const MODES: ChatMode[] = ['ask', 'plan', 'autopilot'];

export function cycleMode(current: ChatMode): ChatMode {
    return MODES[(MODES.indexOf(current) + 1) % MODES.length];
}
