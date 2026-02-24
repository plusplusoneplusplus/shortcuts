/**
 * Browser-safe AI command definitions for SPA menus.
 *
 * Keep this in the dashboard client instead of importing from pipeline-core/ai,
 * because that barrel also exports Node-only SDK modules.
 */
export interface DashboardAICommand {
    id: string;
    label: string;
    icon?: string;
    isCustomInput?: boolean;
}

export const DASHBOARD_AI_COMMANDS: readonly DashboardAICommand[] = [
    {
        id: 'clarify',
        label: 'Clarify',
        icon: '💡',
    },
    {
        id: 'go-deeper',
        label: 'Go Deeper',
        icon: '🔍',
    },
    {
        id: 'custom',
        label: 'Custom...',
        icon: '💬',
        isCustomInput: true,
    },
] as const;
