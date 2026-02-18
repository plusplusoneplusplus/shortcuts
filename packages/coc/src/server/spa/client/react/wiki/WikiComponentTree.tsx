/**
 * WikiComponentTree — sidebar tree of components grouped by domain or category.
 */

import { useState, useMemo } from 'react';
import { cn } from '../shared/cn';

interface ComponentInfo {
    id: string;
    name: string;
    path: string;
    purpose: string;
    category: string;
    domain?: string;
    complexity?: 'low' | 'medium' | 'high';
}

interface DomainInfo {
    id: string;
    name: string;
    description: string;
    components: string[];
}

interface ComponentGraph {
    components: ComponentInfo[];
    categories: { id: string; name: string; description?: string }[];
    domains?: DomainInfo[];
    project: { name: string; description: string; mainLanguage?: string };
}

interface TreeGroup {
    id: string;
    name: string;
    components: ComponentInfo[];
}

interface WikiComponentTreeProps {
    graph: ComponentGraph;
    selectedComponentId: string | null;
    onSelect: (id: string) => void;
}

function buildGroups(graph: ComponentGraph): TreeGroup[] {
    if (graph.domains && graph.domains.length > 0) {
        const componentMap = new Map<string, ComponentInfo>();
        for (const c of graph.components) componentMap.set(c.id, c);
        const assignedIds = new Set<string>();
        const groups: TreeGroup[] = [];

        for (const domain of graph.domains) {
            const comps = (domain.components || [])
                .map(id => componentMap.get(id))
                .filter((c): c is ComponentInfo => !!c);
            if (comps.length === 0) continue;
            for (const c of comps) assignedIds.add(c.id);
            groups.push({ id: domain.id, name: domain.name, components: comps });
        }

        const unassigned = graph.components.filter(c => !assignedIds.has(c.id));
        if (unassigned.length > 0) {
            groups.push({ id: '__other', name: 'Other', components: unassigned });
        }
        return groups;
    }

    const categoryMap = new Map<string, ComponentInfo[]>();
    for (const comp of graph.components) {
        const cat = comp.category || 'other';
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        categoryMap.get(cat)!.push(comp);
    }
    return Array.from(categoryMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cat, comps]) => ({ id: cat, name: cat, components: comps }));
}

export function WikiComponentTree({ graph, selectedComponentId, onSelect }: WikiComponentTreeProps) {
    const [filter, setFilter] = useState('');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const groups = useMemo(() => buildGroups(graph), [graph]);

    const filteredGroups = useMemo(() => {
        if (!filter.trim()) return groups;
        const q = filter.toLowerCase();
        return groups
            .map(g => ({
                ...g,
                components: g.components.filter(c => c.name.toLowerCase().includes(q)),
            }))
            .filter(g => g.components.length > 0);
    }, [groups, filter]);

    const toggleGroup = (id: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div id="wiki-component-tree" className="flex flex-col h-full text-sm">
            <div className="p-2">
                <input
                    className="w-full px-2 py-1 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                    placeholder="Filter components…"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />
            </div>
            <div className="flex-1 overflow-y-auto">
                {filteredGroups.length === 0 && (
                    <div className="wiki-tree-empty px-3 py-2 text-xs text-[#848484]">No components found</div>
                )}
                {filteredGroups.map(group => {
                    const isCollapsed = collapsed.has(group.id);
                    return (
                        <div key={group.id} className="wiki-tree-group">
                            <div
                                className="wiki-tree-item flex items-center gap-1 px-3 py-1.5 cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04] select-none"
                                onClick={() => toggleGroup(group.id)}
                            >
                                <span className={cn('text-[10px] transition-transform', !isCollapsed && 'rotate-90')}>▶</span>
                                <span className="font-medium">{group.name}</span>
                                <span className="wiki-tree-count text-xs text-[#848484] ml-auto">({group.components.length})</span>
                            </div>
                            {!isCollapsed && (
                                <div className="wiki-tree-children">
                                    {group.components.map(comp => (
                                        <div
                                            key={comp.id}
                                            className={cn(
                                                'wiki-tree-component px-6 py-1 cursor-pointer truncate hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
                                                selectedComponentId === comp.id && 'active bg-[#0078d4]/10 text-[#0078d4] dark:text-[#3794ff]'
                                            )}
                                            data-id={comp.id}
                                            title={comp.purpose || ''}
                                            onClick={() => onSelect(comp.id)}
                                        >
                                            {comp.name}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
