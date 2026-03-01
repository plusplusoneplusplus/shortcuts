/**
 * Mock window.matchMedia for jsdom tests. Call in beforeEach/beforeAll.
 * Returns a cleanup function that restores the original matchMedia.
 *
 * @param width - The simulated viewport width in pixels.
 */
export function mockViewport(width: number): () => void {
    const original = window.matchMedia;

    window.matchMedia = (query: string): MediaQueryList => {
        const matches = evaluateQuery(query, width);
        const listeners: Array<(e: MediaQueryListEvent) => void> = [];

        return {
            matches,
            media: query,
            onchange: null,
            addEventListener(_event: string, fn: (e: MediaQueryListEvent) => void) {
                listeners.push(fn);
            },
            removeEventListener(_event: string, fn: (e: MediaQueryListEvent) => void) {
                const idx = listeners.indexOf(fn);
                if (idx !== -1) listeners.splice(idx, 1);
            },
            addListener(fn: (e: MediaQueryListEvent) => void) {
                listeners.push(fn);
            },
            removeListener(fn: (e: MediaQueryListEvent) => void) {
                const idx = listeners.indexOf(fn);
                if (idx !== -1) listeners.splice(idx, 1);
            },
            dispatchEvent(event: Event): boolean {
                for (const fn of listeners) {
                    fn(event as MediaQueryListEvent);
                }
                return true;
            },
        };
    };

    return () => {
        window.matchMedia = original;
    };
}

function evaluateQuery(query: string, width: number): boolean {
    let result = true;

    const maxWidthMatch = query.match(/max-width:\s*(\d+)px/);
    if (maxWidthMatch) {
        result = result && width <= parseInt(maxWidthMatch[1], 10);
    }

    const minWidthMatch = query.match(/min-width:\s*(\d+)px/);
    if (minWidthMatch) {
        result = result && width >= parseInt(minWidthMatch[1], 10);
    }

    return result;
}
