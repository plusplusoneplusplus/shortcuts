export const WORKFLOW_REGISTRY = [
    {
        mode: 'ask',
        icon: '💡',
        label: 'Ask',
        tooltip: 'Ask — get answers without making changes',
        dotClass: 'bg-yellow-500',
        border: 'border-yellow-500 dark:border-yellow-400',
        ring: 'focus-within:ring-yellow-500/30',
        text: 'text-yellow-600 dark:text-yellow-400',
        category: 'primary',
        defaultVisible: true,
        surfaces: ['new-chat', 'follow-up'],
    },
    {
        mode: 'autopilot',
        icon: '🤖',
        label: 'Autopilot',
        tooltip: 'Autopilot — execute changes automatically',
        dotClass: 'bg-green-500',
        border: 'border-green-500 dark:border-green-400',
        ring: 'focus-within:ring-green-500/30',
        text: 'text-green-600 dark:text-green-400',
        category: 'primary',
        defaultVisible: true,
        surfaces: ['new-chat', 'follow-up'],
    },
    {
        mode: 'ralph',
        icon: '🔄',
        label: 'Ralph',
        tooltip: 'Ralph — iterative AI coding loop with guided goal setting',
        dotClass: 'bg-purple-500',
        border: 'border-purple-500 dark:border-purple-400',
        ring: 'focus-within:ring-purple-500/30',
        text: 'text-purple-600 dark:text-purple-400',
        category: 'workflow',
        featureFlag: 'ralph',
        surfaces: ['new-chat'],
    },
    {
        mode: 'for-each',
        icon: '🔁',
        label: 'For Each',
        tooltip: 'For Each — generate a reviewed item plan, then run each item separately',
        dotClass: 'bg-sky-500',
        border: 'border-sky-500 dark:border-sky-400',
        ring: 'focus-within:ring-sky-500/30',
        text: 'text-sky-600 dark:text-sky-400',
        category: 'workflow',
        featureFlag: 'for-each',
        surfaces: ['new-chat'],
    },
] as const;

export type WorkflowRegistryEntry = typeof WORKFLOW_REGISTRY[number];
export type ChatMode = WorkflowRegistryEntry['mode'];
export type ChatModeCategory = WorkflowRegistryEntry['category'];
export type ChatModeSurface = WorkflowRegistryEntry['surfaces'][number];
export type ChatModeFeatureFlag = NonNullable<WorkflowRegistryEntry['featureFlag']>;
export type ChatModeFeatureFlags = Partial<Record<ChatModeFeatureFlag, boolean>>;

export interface VisibleChatModeOptions {
    surface: ChatModeSurface;
    category?: ChatModeCategory;
    featureFlags?: ChatModeFeatureFlags;
    allowedModes?: readonly ChatMode[];
}

export const DEFAULT_CHAT_MODES: readonly ChatMode[] = WORKFLOW_REGISTRY
    .filter(entry => entry.defaultVisible === true)
    .map(entry => entry.mode);

export function normalizeChatMode(mode: unknown): ChatMode | undefined {
    if (mode === 'plan') return 'ask';
    return WORKFLOW_REGISTRY.find(entry => entry.mode === mode)?.mode;
}

function isFeatureEnabled(entry: WorkflowRegistryEntry, featureFlags: ChatModeFeatureFlags | undefined): boolean {
    return !entry.featureFlag || featureFlags?.[entry.featureFlag] === true;
}

function isSurfaceVisible(entry: WorkflowRegistryEntry, surface: ChatModeSurface, allowedModes: readonly ChatMode[] | undefined): boolean {
    if (allowedModes) {
        return allowedModes.includes(entry.mode);
    }
    return entry.surfaces.includes(surface);
}

export function getVisibleChatModes({
    surface,
    category,
    featureFlags,
    allowedModes,
}: VisibleChatModeOptions): readonly ChatMode[] {
    return WORKFLOW_REGISTRY
        .filter(entry => (!category || entry.category === category)
            && isFeatureEnabled(entry, featureFlags)
            && isSurfaceVisible(entry, surface, allowedModes))
        .map(entry => entry.mode);
}

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
export const MODE_BORDER_COLORS: Record<ChatMode, { border: string; ring: string }> =
    Object.fromEntries(WORKFLOW_REGISTRY.map(entry => [
        entry.mode,
        { border: entry.border, ring: entry.ring },
    ])) as Record<ChatMode, { border: string; ring: string }>;

export const MODE_ICONS: Record<ChatMode, string> =
    Object.fromEntries(WORKFLOW_REGISTRY.map(entry => [entry.mode, entry.icon])) as Record<ChatMode, string>;

/**
 * Per-mode accent text colors for in-conversation labels (e.g. the mode-change divider).
 * Mirrors the border accents from `MODE_BORDER_COLORS` but as text classes.
 */
export const MODE_TEXT_COLORS: Record<ChatMode, string> =
    Object.fromEntries(WORKFLOW_REGISTRY.map(entry => [entry.mode, entry.text])) as Record<ChatMode, string>;

export const MODE_LABELS: Record<ChatMode, string> =
    Object.fromEntries(WORKFLOW_REGISTRY.map(entry => [
        entry.mode,
        `${entry.icon} ${entry.label}`,
    ])) as Record<ChatMode, string>;

export const MODE_TOOLTIPS: Record<ChatMode, string> =
    Object.fromEntries(WORKFLOW_REGISTRY.map(entry => [entry.mode, entry.tooltip])) as Record<ChatMode, string>;

const MODE_ORDER: readonly ChatMode[] = DEFAULT_CHAT_MODES;

export function cycleMode(current: ChatMode, allowedModes?: readonly ChatMode[]): ChatMode {
    const modes = allowedModes && allowedModes.length > 0 ? allowedModes : MODE_ORDER;
    const idx = modes.indexOf(current);
    if (idx === -1) return modes[0];
    return modes[(idx + 1) % modes.length];
}
