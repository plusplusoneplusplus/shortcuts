import { useState, useCallback, useRef } from 'react';

export interface AttachedContextItem {
    id: string;
    turnIndex: number;
    role: 'user' | 'assistant';
    snippet: string;
    preview: string;
}

const PREVIEW_LENGTH = 100;

function truncatePreview(text: string): string {
    const oneLine = text.replace(/\n/g, ' ').trim();
    if (oneLine.length <= PREVIEW_LENGTH) return oneLine;
    return oneLine.slice(0, PREVIEW_LENGTH) + '…';
}

let nextId = 0;

export function useAttachedContext() {
    const [items, setItems] = useState<AttachedContextItem[]>([]);
    const itemsRef = useRef<AttachedContextItem[]>([]);
    itemsRef.current = items;

    const add = useCallback((turnIndex: number, role: 'user' | 'assistant', snippet: string) => {
        const item: AttachedContextItem = {
            id: `ctx-${++nextId}`,
            turnIndex,
            role,
            snippet,
            preview: truncatePreview(snippet),
        };
        setItems(prev => [...prev, item]);
    }, []);

    const remove = useCallback((id: string) => {
        setItems(prev => prev.filter(item => item.id !== id));
    }, []);

    const clear = useCallback(() => {
        setItems([]);
    }, []);

    const getItems = useCallback(() => itemsRef.current, []);

    return { items, add, remove, clear, getItems };
}

/**
 * Format attached context items into a text block to prepend to the user message.
 */
export function formatAttachedContext(items: AttachedContextItem[]): string {
    if (items.length === 0) return '';
    return items.map(item =>
        `<context from="${item.role}" turn="${item.turnIndex}">\n${item.snippet}\n</context>`
    ).join('\n\n') + '\n\n';
}
