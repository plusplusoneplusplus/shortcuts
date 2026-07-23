/**
 * KustoEmbedGroup — coordinates the inline Kusto canvas embeds within a single
 * conversation so only the most recent one is expanded by default.
 *
 * Each embed's canvas type is only known after it loads, so the group works on
 * live DOM order: every kusto embed registers its wrapper element, and the
 * group reports which registered element is last in document order (i.e. the
 * newest turn's Kusto canvas). Earlier embeds default to collapsed.
 *
 * The context is optional — a `CanvasEmbed` rendered outside a provider (e.g. a
 * standalone preview) sees `null` and stays expanded, matching prior behavior.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export interface KustoEmbedGroupValue {
    /** Register an embed's wrapper element; returns an unregister callback. */
    register: (el: HTMLElement) => () => void;
    /** True when `el` is the last registered kusto embed in document order. */
    isLast: (el: HTMLElement | null) => boolean;
    /** Bumped whenever the registered set changes so consumers re-evaluate. */
    version: number;
}

const KustoEmbedGroupContext = createContext<KustoEmbedGroupValue | null>(null);

export function KustoEmbedGroupProvider({ children }: { children: ReactNode }) {
    const elementsRef = useRef<Set<HTMLElement>>(new Set());
    const [version, setVersion] = useState(0);

    const register = useCallback((el: HTMLElement) => {
        elementsRef.current.add(el);
        setVersion(v => v + 1);
        return () => {
            elementsRef.current.delete(el);
            setVersion(v => v + 1);
        };
    }, []);

    const isLast = useCallback((el: HTMLElement | null): boolean => {
        if (!el || !elementsRef.current.has(el)) return false;
        for (const other of elementsRef.current) {
            if (other === el) continue;
            // `other` follows `el` in document order → `el` is not the last one.
            if (el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) {
                return false;
            }
        }
        return true;
    }, []);

    // `version` is the only mutable field, so bumping it produces a fresh value
    // object and forces consumers to recompute `isLast` against the live set.
    const value = useMemo<KustoEmbedGroupValue>(() => ({ register, isLast, version }), [register, isLast, version]);

    return <KustoEmbedGroupContext.Provider value={value}>{children}</KustoEmbedGroupContext.Provider>;
}

export function useKustoEmbedGroup(): KustoEmbedGroupValue | null {
    return useContext(KustoEmbedGroupContext);
}
