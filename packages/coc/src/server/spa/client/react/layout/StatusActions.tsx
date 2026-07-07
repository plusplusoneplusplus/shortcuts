/**
 * StatusActions — the shared status/action cluster:
 *   [Connection status] [NotificationBell] [Quota] [Admin] [Theme]
 *
 * Two placements share one implementation:
 *   - `variant="topbar"` renders the historic top-right header cluster
 *     (connection pill on desktop, bare dot on mobile). Admin routing is
 *     delegated to `onAdminOpen` so the topbar keeps its existing callback.
 *   - `variant="sidebar"` renders a docked footer bar for the bottom of the
 *     left sidebar (remote-first shell). It full-bleeds a top border and lays
 *     the connection label and icon buttons out as a single row. It uses a
 *     soft blue-tinted background (distinct from the sidebar's neutral gray) so
 *     the dock reads as a separate strip rather than blending into the panel.
 *
 * The sidebar variant uses distinct `data-testid`s and drops the `id`
 * attributes so it never collides with the topbar cluster when both happen to
 * be mounted (the topbar cluster is only rendered when the sidebar footer is
 * absent, but the split panel keeps its footer mounted-but-hidden on other
 * sub-tabs).
 */

import { useTheme } from './ThemeProvider';
import { useApp } from '../contexts/AppContext';
import { NotificationBell } from '../shared/NotificationBell';
import { agentProviderQuotaIndicator as AgentProviderQuotaIndicator } from '../shared/AgentProviderQuotaIndicator';
import type { WsStatus } from '../hooks/useWebSocket';

const themeEmoji: Record<string, string> = {
    auto: '🌗',
    dark: '🌙',
    light: '☀️',
};

export const wsStatusConfig: Record<WsStatus, { color: string; label: string; pulse: boolean }> = {
    open: { color: 'bg-[#16825d] dark:bg-[#89d185]', label: 'Connected', pulse: false },
    connecting: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Connecting…', pulse: true },
    reconnecting: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Reconnecting…', pulse: true },
    closing: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Disconnecting…', pulse: true },
    closed: { color: 'bg-[#f14c4c] dark:bg-[#f48771]', label: 'Disconnected', pulse: false },
};

export interface StatusActionsProps {
    variant?: 'topbar' | 'sidebar';
    /** Admin-open handler for the topbar variant. The sidebar variant defaults
     *  to navigating to `#admin`. */
    onAdminOpen?: () => void;
}

export function StatusActions({ variant = 'topbar', onAdminOpen }: StatusActionsProps) {
    const { state } = useApp();
    const { theme, toggleTheme } = useTheme();

    const wsStatus: WsStatus = state.wsStatus ?? 'closed';
    const wsConfig = wsStatusConfig[wsStatus];

    // The admin shell hosts `admin` itself plus the embedded tool routes
    // (skills/logs/stats/servers). Reflect "user is in the admin shell" in the
    // highlight for any of those tabs.
    const inAdminShell = state.activeTab === 'admin'
        || state.activeTab === 'skills'
        || state.activeTab === 'logs'
        || state.activeTab === 'stats'
        || state.activeTab === 'servers';

    const handleAdmin = onAdminOpen ?? (() => { location.hash = '#admin'; });

    if (variant === 'sidebar') {
        return (
            <div
                className="flex flex-shrink-0 items-center justify-between gap-1 px-2 py-1.5 border-t border-[#b9d2f2] dark:border-[#34496b] bg-[#dbe8fa] dark:bg-[#23324a]"
                data-testid="sidebar-status-actions"
            >
                <span
                    className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[11px] font-medium text-[#656d76] dark:text-[#999] min-w-0"
                    title={wsConfig.label}
                    aria-label={`Connection: ${wsConfig.label}`}
                    data-testid="sidebar-ws-status-indicator"
                    data-ws-status={wsStatus}
                >
                    <span
                        className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${wsConfig.color}${wsConfig.pulse ? ' animate-pulse' : ''}`}
                        aria-hidden="true"
                    />
                    <span className="truncate" data-testid="sidebar-ws-status-label">{wsConfig.label}</span>
                </span>
                <span className="flex items-center gap-0.5 flex-shrink-0">
                    <NotificationBell />
                    <AgentProviderQuotaIndicator />
                    <button
                        data-tab="admin"
                        className={
                            `h-7 w-7 inline-flex items-center justify-center rounded touch-target text-base leading-none ` +
                            (inAdminShell ? 'bg-[#0078d4] text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                        }
                        aria-label="Admin"
                        title="Admin"
                        data-testid="sidebar-admin-toggle"
                        onClick={handleAdmin}
                    >
                        &#9881;
                    </button>
                    <button
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08] touch-target text-base leading-none"
                        aria-label="Toggle theme"
                        data-testid="sidebar-theme-toggle"
                        onClick={toggleTheme}
                    >
                        {themeEmoji[theme] || '🌗'}
                    </button>
                </span>
            </div>
        );
    }

    // ── topbar variant (historic top-right cluster) ──
    return (
        <>
            {/* WS status — pill on desktop, bare dot on mobile to save space */}
            <span
                className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-xs font-medium text-[#656d76] dark:text-[#999]"
                title={wsConfig.label}
                aria-label={`Connection: ${wsConfig.label}`}
                data-testid="ws-status-indicator"
                data-ws-status={wsStatus}
            >
                <span
                    className={`inline-block w-2 h-2 rounded-full ${wsConfig.color}${wsConfig.pulse ? ' animate-pulse' : ''}`}
                    aria-hidden="true"
                />
                <span data-testid="ws-status-label">{wsConfig.label}</span>
            </span>
            <span
                className="md:hidden inline-flex items-center justify-center h-7 w-7"
                title={wsConfig.label}
                aria-label={`Connection: ${wsConfig.label}`}
                data-testid="ws-status-indicator-mobile"
                data-ws-status={wsStatus}
            >
                <span
                    className={`inline-block w-2 h-2 rounded-full ${wsConfig.color}${wsConfig.pulse ? ' animate-pulse' : ''}`}
                />
            </span>
            <NotificationBell />
            <AgentProviderQuotaIndicator />
            <button
                id="admin-toggle"
                data-tab="admin"
                className={
                    `h-7 w-7 inline-flex items-center justify-center rounded touch-target text-base leading-none ` +
                    (inAdminShell ? 'bg-[#0078d4] text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                }
                aria-label="Admin"
                title="Admin"
                onClick={handleAdmin}
            >
                &#9881;
            </button>
            <button
                id="theme-toggle"
                className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08] touch-target text-base leading-none"
                aria-label="Toggle theme"
                onClick={toggleTheme}
            >
                {themeEmoji[theme] || '🌗'}
            </button>
        </>
    );
}
