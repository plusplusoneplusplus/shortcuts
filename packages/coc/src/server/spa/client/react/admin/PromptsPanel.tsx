/**
 * PromptsPanel — read-only viewer for built-in AI prompt templates.
 * Fetches from GET /api/admin/prompts and renders grouped PromptCards.
 */

import { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../ui';
import { getApiBase } from '../utils/config';
import { PromptCard } from './PromptCard';

interface BuiltInPrompt {
    id: string;
    title: string;
    group: string;
    source: string;
    description: string;
    text: string;
}

interface PromptsPanelProps {
    onError: (msg: string) => void;
}

const GROUP_ORDER = ['Pipeline', 'Memory', 'UI'];

export function PromptsPanel({ onError }: PromptsPanelProps) {
    const [prompts, setPrompts] = useState<BuiltInPrompt[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(getApiBase() + '/admin/prompts');
            if (!res.ok) throw new Error('Failed to load prompts');
            const data: Record<string, BuiltInPrompt> = await res.json();
            setPrompts(Object.values(data));
        } catch (err: any) {
            onError(err.message || 'Failed to load prompts');
        } finally {
            setLoading(false);
        }
    }, [onError]);

    useEffect(() => {
        load();
    }, [load]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-[#848484]" data-testid="prompts-loading">
                <Spinner size="sm" /> Loading…
            </div>
        );
    }

    // Group prompts by their group field
    const grouped = new Map<string, BuiltInPrompt[]>();
    for (const p of prompts) {
        const list = grouped.get(p.group) ?? [];
        list.push(p);
        grouped.set(p.group, list);
    }

    // Sort groups by predefined order
    const sortedGroups = [...grouped.entries()].sort(
        (a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0])
    );

    return (
        <div className="space-y-4" data-testid="prompts-panel">
            <div>
                <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">Prompt Templates</h2>
                <p className="text-xs text-[#616161] dark:text-[#9d9d9d]">
                    These are the AI instructions used internally by CoC. They are read-only in this view.
                </p>
            </div>

            {sortedGroups.map(([group, items]) => (
                <div key={group} className="space-y-2">
                    <h3 className="text-xs font-semibold text-[#616161] dark:text-[#999] uppercase tracking-wide">
                        {group}
                    </h3>
                    {items.map(p => (
                        <PromptCard
                            key={p.id}
                            title={p.title}
                            source={p.source}
                            description={p.description}
                            text={p.text}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}
