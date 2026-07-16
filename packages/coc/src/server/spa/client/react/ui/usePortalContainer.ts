import { useEffect, useRef } from 'react';

export function usePortalContainer(active: boolean): HTMLElement | null {
    const containerRef = useRef<HTMLElement | null>(null);

    if (containerRef.current === null && typeof document !== 'undefined') {
        containerRef.current = document.createElement('div');
    }

    useEffect(() => {
        if (!active || typeof document === 'undefined') return;
        const container = containerRef.current;
        if (!container) return;

        document.body.appendChild(container);
        return () => {
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
        };
    }, [active]);

    return active ? containerRef.current : null;
}
