/**
 * ToolCard — one collapsible card in the Dev Tools panel.
 *
 * The header is a button that toggles expansion; the body mounts only while
 * expanded so a collapsed tool costs nothing. Styling mirrors the dashboard's
 * existing light/dark chrome pairs (see WorkspaceRightDock).
 */

import type { ReactNode } from 'react';

export interface ToolCardProps {
    id: string;
    name: string;
    description: string;
    expanded: boolean;
    onToggle: () => void;
    children: ReactNode;
}

export function ToolCard({ id, name, description, expanded, onToggle, children }: ToolCardProps) {
    return (
        <section
            className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] overflow-hidden"
            data-testid={`dev-tool-card-${id}`}
            data-expanded={expanded ? 'true' : 'false'}
        >
            <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                onClick={onToggle}
                aria-expanded={expanded}
                data-testid={`dev-tool-toggle-${id}`}
            >
                <span
                    className="text-[10px] text-[#656d76] dark:text-[#999] w-3 flex-shrink-0"
                    aria-hidden="true"
                >
                    {expanded ? '▼' : '▶'}
                </span>
                <span className="min-w-0">
                    <span className="block text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">{name}</span>
                    <span className="block text-[11px] text-[#656d76] dark:text-[#999] truncate">{description}</span>
                </span>
            </button>
            {expanded && (
                <div
                    className="px-3 pb-3 pt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid={`dev-tool-body-${id}`}
                >
                    {children}
                </div>
            )}
        </section>
    );
}
