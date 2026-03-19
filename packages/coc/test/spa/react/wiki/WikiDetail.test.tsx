/**
 * Unit tests for WikiDetail component.
 * Covers loading state, graph-available rendering, error/empty state,
 * and tab-switching between Browse, Ask, and Graph views.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/context/ToastContext';
import { WikiDetail } from '../../../../src/server/spa/client/react/wiki/WikiDetail';

// Chainable D3 stub — all methods return the same chain so fluent calls don't throw.
function makeChain(): any {
    const chain: any = {};
    const methods = [
        'attr', 'style', 'remove', 'call', 'scaleExtent', 'text', 'selectAll',
        'join', 'force', 'alphaTarget', 'restart', 'stop', 'alpha',
        'distance', 'id', 'strength', 'radius',
    ];
    for (const m of methods) chain[m] = (..._args: any[]) => chain;
    chain.append = () => makeChain();
    chain.data = () => chain;
    chain.on = () => chain;
    return chain;
}
const d3Stub = {
    select: () => makeChain(),
    forceSimulation: () => makeChain(),
    forceLink: () => makeChain(),
    forceManyBody: () => makeChain(),
    forceCenter: () => makeChain(),
    forceCollide: () => makeChain(),
    drag: () => makeChain(),
    zoom: () => makeChain(),
};
// Pre-seed window.d3 so ensureD3() resolves immediately without CDN loading.
(window as any).d3 = d3Stub;

const noopToast = { addToast: () => {}, removeToast: () => {}, toasts: [] };

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={noopToast}>{children}</ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

/** Seeder that injects a wiki into AppContext before rendering WikiDetail. */
function SeededDetail({ wiki, initialTab }: { wiki: any; initialTab?: string }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_WIKIS', wikis: [wiki] });
        if (initialTab) {
            dispatch({ type: 'SELECT_WIKI_WITH_TAB', wikiId: wiki.id, tab: initialTab });
        } else {
            dispatch({ type: 'SELECT_WIKI', wikiId: wiki.id });
        }
    }, [dispatch, wiki, initialTab]);
    return <WikiDetail wikiId={wiki.id} />;
}

const loadedWiki = { id: 'w1', name: 'My Wiki', status: 'loaded' };

const mockGraph = {
    components: [
        { id: 'c1', name: 'AuthService', path: 'src/auth.ts', purpose: 'Authentication', category: 'api', complexity: 'low' },
    ],
    categories: [{ id: 'api', name: 'API' }],
    project: { name: 'My Wiki', description: 'Test project', mainLanguage: 'TypeScript' },
};

function mockFetchWithGraph() {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/graph')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGraph) });
        }
        if (url.includes('/admin/cache')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));
}

function mockFetchGraphFailure() {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/graph')) {
            return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));
}

function mockFetchNeverResolve() {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/graph')) {
            return new Promise(() => { /* never resolves */ });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));
}

beforeEach(() => {
    location.hash = '';
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Loading state ────────────────────────────────────────────────────────────

describe('WikiDetail — loading state', () => {
    it('shows a Spinner while the graph is loading', async () => {
        mockFetchNeverResolve();
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => {
            // The spinner container should be present while fetch is pending
            const spinnerContainer = document.querySelector('.flex.items-center.justify-center.h-full');
            expect(spinnerContainer).toBeTruthy();
        });
    });
});

// ── Graph loaded ─────────────────────────────────────────────────────────────

describe('WikiDetail — graph available', () => {
    beforeEach(() => {
        mockFetchWithGraph();
    });

    it('renders the project name once graph is loaded', async () => {
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('My Wiki')).toBeTruthy();
        });
    });

    it('renders component cards in the Browse tab', async () => {
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => {
            // data-component-id is set on each card in the project overview
            expect(document.querySelector('[data-component-id="c1"]')).toBeTruthy();
        });
    });

    it('shows Browse tab active by default', async () => {
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => {
            const browseBtn = screen.getByText('Browse');
            expect(browseBtn.className).toContain('active');
        });
    });

    it('switches to Ask tab and renders WikiAsk', async () => {
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => expect(screen.getByText('Ask')).toBeTruthy());
        fireEvent.click(screen.getByText('Ask'));

        await waitFor(() => {
            expect(screen.getByText('Ask a question about the codebase')).toBeTruthy();
        });
    });

    it('switches to Graph tab and renders graph container', async () => {
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => expect(screen.getByText('Graph')).toBeTruthy());
        fireEvent.click(screen.getByText('Graph'));

        await waitFor(() => {
            expect(document.getElementById('wiki-graph-container')).toBeTruthy();
        });
    });
});

// ── Error / empty state ───────────────────────────────────────────────────────

describe('WikiDetail — error state', () => {
    it('shows "No graph data available" when fetch fails', async () => {
        mockFetchGraphFailure();
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('No graph data available. Try generating the wiki first.')).toBeTruthy();
        });
    });

    it('shows Setup Required prompt for pending wiki with no graph', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/graph')) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }));

        const pendingWiki = { id: 'w-pending', name: 'Pending Wiki', status: 'pending' };
        render(
            <Wrap>
                <SeededDetail wiki={pendingWiki} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Setup Required')).toBeTruthy();
        });
    });
});

// ── Tab bar ───────────────────────────────────────────────────────────────────

describe('WikiDetail — tab bar', () => {
    beforeEach(() => {
        mockFetchWithGraph();
    });

    it('has all four tabs: Browse, Ask, Graph, Admin', async () => {
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => expect(screen.getByText('Browse')).toBeTruthy());
        expect(screen.getByText('Ask')).toBeTruthy();
        expect(screen.getByText('Graph')).toBeTruthy();
        expect(screen.getByText('Admin')).toBeTruthy();
    });

    it('updates location.hash when switching to Ask tab', async () => {
        render(
            <Wrap>
                <SeededDetail wiki={loadedWiki} />
            </Wrap>
        );

        await waitFor(() => expect(screen.getByText('Ask')).toBeTruthy());
        fireEvent.click(screen.getByText('Ask'));

        expect(location.hash).toBe('#wiki/w1/ask');
    });
});
