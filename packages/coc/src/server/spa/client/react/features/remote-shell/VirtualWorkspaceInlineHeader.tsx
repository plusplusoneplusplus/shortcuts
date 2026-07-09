/**
 * VirtualWorkspaceInlineHeader — the in-body single-row header for a virtual
 * workspace (My Work / My Life), rendered by the view itself in the classic shell
 * and on mobile (where the remote-first TopBar header does not apply). Same
 * identity + sub-tabs + action buttons as `VirtualWorkspaceShellHeader`, in the
 * flat full-width row style the views have always used.
 */
import { cn } from '../../ui';
import { useVirtualWorkspaceHeader } from './useVirtualWorkspaceHeader';
import type { VirtualWorkspaceHeaderConfig } from './virtualWorkspaceHeader';

export interface VirtualWorkspaceInlineHeaderProps {
    config: VirtualWorkspaceHeaderConfig;
}

export function VirtualWorkspaceInlineHeader({ config }: VirtualWorkspaceInlineHeaderProps) {
    const { visibleTabs, activeTab, switchTab, statusMsg, isActionRunning, runAction } = useVirtualWorkspaceHeader(config);
    const prefix = config.testIdPrefix;

    return (
        <div
            className="flex items-center px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#2d2d2d] flex-shrink-0"
            data-testid={`${prefix}-header`}
        >
            <span className="text-sm font-semibold text-[#333] dark:text-[#ccc] mr-2 flex-shrink-0">
                {config.icon} {config.label}
            </span>
            {visibleTabs.map(t => (
                <button
                    key={t.key}
                    data-subtab={t.key}
                    title={t.shortcut}
                    className={cn(
                        'text-xs font-medium transition-colors relative whitespace-nowrap shrink-0 px-3 py-2',
                        activeTab === t.key
                            ? 'text-[#0078d4] dark:text-[#3794ff]'
                            : 'text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                    )}
                    onClick={() => switchTab(t.key)}
                    data-testid={`${prefix}-tab-${t.key}`}
                >
                    {t.label}
                    {activeTab === t.key && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
                    )}
                </button>
            ))}
            <div className="flex-1" />
            {/* Vertical splitter */}
            <div
                className="w-px self-stretch bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-2 my-1 flex-shrink-0"
                data-testid={`${prefix}-header-splitter`}
            />
            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
                {config.actions.map(action => {
                    const running = isActionRunning(action.key);
                    return (
                        <button
                            key={action.key}
                            className="text-xs px-2.5 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#3c3c3c] hover:bg-[#e8e8e8] dark:hover:bg-[#4a4a4a] text-[#333] dark:text-[#ccc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            onClick={() => runAction(action)}
                            disabled={running}
                            data-testid={action.testId}
                            title={action.title}
                        >
                            {running ? action.busyLabel : action.idleLabel}
                        </button>
                    );
                })}
                {statusMsg && (
                    <span className="text-xs text-[#666] dark:text-[#999] ml-1" data-testid={`${prefix}-status`}>
                        {statusMsg}
                    </span>
                )}
            </div>
        </div>
    );
}
