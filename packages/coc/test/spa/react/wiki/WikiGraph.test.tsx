/**
 * Unit tests for WikiGraph component.
 * Mocks D3 CDN loading to test loading, error, and rendering states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Shared test graph ────────────────────────────────────────────────────────

const graph = {
    components: [
        { id: 'c1', name: 'AuthService', path: 'src/auth.ts', purpose: 'Handles auth', category: 'api', complexity: 'low' as const },
        { id: 'c2', name: 'UserStore', path: 'src/store.ts', purpose: 'Stores users', category: 'db', complexity: 'medium' as const, dependencies: ['c1'] },
        { id: 'c3', name: 'Dashboard', path: 'src/ui.tsx', purpose: 'Main UI', category: 'ui', complexity: 'high' as const },
    ],
    categories: [
        { id: 'api', name: 'API' },
        { id: 'db', name: 'DB' },
        { id: 'ui', name: 'UI' },
    ],
    project: { name: 'Test Project', description: 'A test project' },
};

// ── D3 mock helpers ──────────────────────────────────────────────────────────

/** Captured click handler registered via node.on('click', handler). */
let capturedClickHandler: ((event: any, datum: any) => void) | null = null;
/** Nodes passed to d3.forceSimulation. */
let simulatedNodes: any[] = [];

/**
 * Creates a chainable mock D3 selection.
 * All methods return the same object so `.attr().style().on()` chains work.
 * The `.on('click', handler)` call stores the handler for test assertions.
 */
function makeD3Chain(): any {
    const chain: any = {};
    const passthroughs = [
        'attr', 'style', 'remove', 'call', 'scaleExtent', 'text',
        'distance', 'id', 'strength', 'radius', 'selectAll', 'join',
        'force', 'alphaTarget', 'restart', 'stop', 'alpha',
    ];
    for (const m of passthroughs) {
        chain[m] = (..._args: any[]) => chain;
    }
    chain.append = () => makeD3Chain();
    chain.data = (_d?: any[]) => chain;
    chain.on = (event: string, handler?: any) => {
        if (event === 'click' && typeof handler === 'function') {
            capturedClickHandler = handler;
        }
        return chain;
    };
    return chain;
}

function buildMockD3() {
    capturedClickHandler = null;
    simulatedNodes = [];
    const chain = makeD3Chain();
    return {
        select: () => chain,
        forceSimulation: (nodes?: any[]) => {
            if (nodes) simulatedNodes = nodes;
            return chain;
        },
        forceLink: () => chain,
        forceManyBody: () => chain,
        forceCenter: () => chain,
        forceCollide: () => chain,
        drag: () => chain,
        zoom: () => chain,
    };
}

// ── Script tag interception ───────────────────────────────────────────────────

/**
 * Intercepts document.createElement('script') to capture the D3 script element
 * so tests can programmatically fire onload / onerror.
 */
function interceptScriptCreation(): { fireLoad: () => void; fireError: () => void } {
    let captured: HTMLScriptElement | null = null;
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = original(tag);
        if (tag === 'script') captured = el as HTMLScriptElement;
        return el;
    });
    return {
        fireLoad: () => { if (captured?.onload) (captured.onload as any)(new Event('load')); },
        fireError: () => { if (captured?.onerror) (captured.onerror as any)(new Event('error')); },
    };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(() => {
    capturedClickHandler = null;
    simulatedNodes = [];
    delete (window as any).d3;
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).d3;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WikiGraph — loading state', () => {
    it('shows Spinner while D3 is loading (script not yet loaded)', async () => {
        // Intercept script creation so onload is never fired → loading stays true
        interceptScriptCreation();

        // Dynamic import to get a fresh module with cleared d3Promise
        vi.resetModules();
        const { WikiGraph } = await import('../../../../src/server/spa/client/react/wiki/WikiGraph');

        render(<WikiGraph wikiId="w1" graph={graph} onSelectComponent={vi.fn()} />);

        // Spinner must be in the DOM while loading
        await waitFor(() => {
            const container = document.querySelector('.flex.items-center.justify-center');
            expect(container).toBeTruthy();
        });
    });
});

describe('WikiGraph — D3 available', () => {
    beforeEach(() => {
        // Pre-seed window.d3 so ensureD3() resolves synchronously
        (window as any).d3 = buildMockD3();
    });

    it('renders the SVG container after D3 loads', async () => {
        vi.resetModules();
        const { WikiGraph } = await import('../../../../src/server/spa/client/react/wiki/WikiGraph');

        render(<WikiGraph wikiId="w1" graph={graph} onSelectComponent={vi.fn()} />);

        await waitFor(() => {
            expect(document.getElementById('wiki-graph-container')).toBeTruthy();
        });
    });

    it('renders SVG element', async () => {
        vi.resetModules();
        const { WikiGraph } = await import('../../../../src/server/spa/client/react/wiki/WikiGraph');

        render(<WikiGraph wikiId="w1" graph={graph} onSelectComponent={vi.fn()} />);

        await waitFor(() => {
            expect(document.querySelector('svg')).toBeTruthy();
        });
    });

    it('renders a legend entry for each category', async () => {
        vi.resetModules();
        const { WikiGraph } = await import('../../../../src/server/spa/client/react/wiki/WikiGraph');

        render(<WikiGraph wikiId="w1" graph={graph} onSelectComponent={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText('api')).toBeTruthy();
            expect(screen.getByText('db')).toBeTruthy();
            expect(screen.getByText('ui')).toBeTruthy();
        });
    });

    it('calls onSelectComponent when the captured click handler fires', async () => {
        (window as any).d3 = buildMockD3();
        vi.resetModules();
        const { WikiGraph } = await import('../../../../src/server/spa/client/react/wiki/WikiGraph');

        const onSelect = vi.fn();
        render(<WikiGraph wikiId="w1" graph={graph} onSelectComponent={onSelect} />);

        await waitFor(() => {
            expect(document.getElementById('wiki-graph-container')).toBeTruthy();
        });

        // Simulate D3 click on a node datum
        expect(capturedClickHandler).not.toBeNull();
        capturedClickHandler!(null, { id: 'c1' });

        expect(onSelect).toHaveBeenCalledWith('c1');
    });
});

describe('WikiGraph — D3 CDN error', () => {
    it('shows error message when D3 CDN fails to load', async () => {
        // Intercept script and fire onerror immediately
        const { fireError } = interceptScriptCreation();
        vi.resetModules();
        const { WikiGraph } = await import('../../../../src/server/spa/client/react/wiki/WikiGraph');

        render(<WikiGraph wikiId="w1" graph={graph} onSelectComponent={vi.fn()} />);

        // Allow the script tag to be created and appended
        await Promise.resolve();
        fireError();

        await waitFor(() => {
            expect(screen.getByText('Failed to load graph library')).toBeTruthy();
        });
    });
});

describe('WikiGraph — COMPLEXITY_RADIUS', () => {
    it('COMPLEXITY_RADIUS constants match expected values', async () => {
        vi.resetModules();
        // Read the source file to verify the constants
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/wiki/WikiGraph.tsx'),
            'utf-8'
        );
        expect(src).toContain('low: 8');
        expect(src).toContain('medium: 12');
        expect(src).toContain('high: 18');
    });
});
