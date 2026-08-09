/**
 * DevToolsPanel — one scrollable page of collapsible tool cards with a filter
 * box at the top.
 *
 * State (filter text, which cards are expanded) is in-memory only: it lives as
 * long as the dialog is mounted and resets when the dialog is reopened. No
 * localStorage, no server round-trips.
 */

import { useMemo, useState } from 'react';
import { DEV_TOOLS, DEFAULT_EXPANDED_TOOL_ID } from './registry';
import { filterTools } from './logic/filterTools';
import { ToolCard } from './ToolCard';

export function DevToolsPanel() {
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>(
        () => (DEFAULT_EXPANDED_TOOL_ID ? { [DEFAULT_EXPANDED_TOOL_ID]: true } : {}),
    );

    const visible = useMemo(() => filterTools(DEV_TOOLS, query), [query]);

    const toggle = (id: string) => {
        setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <div className="flex flex-col gap-3" data-testid="dev-tools-panel">
            <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter tools…"
                aria-label="Filter tools"
                data-testid="dev-tools-filter"
                className="w-full h-8 px-2 rounded border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#848484] focus:outline-none focus:border-[#0078d4]"
            />
            {visible.length === 0 ? (
                <p className="text-xs text-[#656d76] dark:text-[#999]" data-testid="dev-tools-empty">
                    No tools match
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {visible.map(tool => {
                        const Body = tool.component;
                        return (
                            <ToolCard
                                key={tool.id}
                                id={tool.id}
                                name={tool.name}
                                description={tool.description}
                                expanded={!!expanded[tool.id]}
                                onToggle={() => toggle(tool.id)}
                            >
                                <Body />
                            </ToolCard>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
