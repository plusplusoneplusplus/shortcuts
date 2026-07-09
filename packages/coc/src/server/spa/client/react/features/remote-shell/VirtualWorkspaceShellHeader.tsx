/**
 * VirtualWorkspaceShellHeader — the single-row remote-first TopBar header for a
 * virtual workspace (My Work / My Life). Mirrors `RemoteShellHeader`'s visual
 * shell (identity chip · divider · tabs) but, since a virtual workspace has no
 * repo/git context, renders its own identity + sub-tab set and action buttons
 * (Sync / Generate Summary) instead of the repo-picker + clone-switcher clusters.
 *
 * Rendered by `TopBar` in the remote-first desktop shell; the matching in-body
 * header (`VirtualWorkspaceInlineHeader`) covers classic shell / mobile.
 */
import { useVirtualWorkspaceHeader } from './useVirtualWorkspaceHeader';
import type { VirtualWorkspaceHeaderConfig } from './virtualWorkspaceHeader';

export interface VirtualWorkspaceShellHeaderProps {
    config: VirtualWorkspaceHeaderConfig;
}

export function VirtualWorkspaceShellHeader({ config }: VirtualWorkspaceShellHeaderProps) {
    const { visibleTabs, activeTab, switchTab, statusMsg, isActionRunning, runAction } = useVirtualWorkspaceHeader(config);
    const prefix = config.testIdPrefix;

    return (
        <div
            className="hidden md:flex items-center gap-1.5 min-w-0 flex-1"
            data-testid="virtual-workspace-shell-header"
            data-workspace={config.workspaceId}
        >
            {/* Identity chip — mirrors the clone-switch pill, but static (no repo/git). */}
            <span
                data-testid={`${prefix}-shell-identity`}
                title={config.label}
                className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] flex-shrink-0"
            >
                <span aria-hidden>{config.icon}</span>
                <span className="max-w-[160px] truncate">{config.label}</span>
            </span>

            <span className="w-px h-[18px] bg-[#d8dee4] dark:bg-[#3c3c3c] flex-shrink-0" aria-hidden />

            <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
                {visibleTabs.map(t => {
                    const isActive = activeTab === t.key;
                    return (
                        <button
                            key={t.key}
                            data-testid={`${prefix}-shell-tab-${t.key}`}
                            data-subtab={t.key}
                            data-active={isActive ? 'true' : 'false'}
                            aria-current={isActive ? 'page' : undefined}
                            title={t.shortcut}
                            onClick={() => switchTab(t.key)}
                            className={
                                'relative inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md text-[13px] whitespace-nowrap shrink-0 transition-colors ' +
                                (isActive
                                    ? 'font-bold text-[#0969da] dark:text-[#79c0ff] shadow-[inset_0_-2px_0_#0969da] dark:shadow-[inset_0_-2px_0_#3794ff]'
                                    : 'font-semibold text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                            }
                        >
                            {t.label}
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
                {config.actions.map(action => {
                    const running = isActionRunning(action.key);
                    return (
                        <button
                            key={action.key}
                            data-testid={action.testId}
                            title={action.title}
                            onClick={() => runAction(action)}
                            disabled={running}
                            className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[12px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {running ? action.busyLabel : action.idleLabel}
                        </button>
                    );
                })}
                {statusMsg && (
                    <span
                        data-testid={`${prefix}-shell-status`}
                        className="text-[11px] text-[#656d76] dark:text-[#999] ml-0.5 whitespace-nowrap"
                    >
                        {statusMsg}
                    </span>
                )}
            </div>
        </div>
    );
}
