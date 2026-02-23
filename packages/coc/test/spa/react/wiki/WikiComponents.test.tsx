/**
 * Tests for Wiki React components.
 * Covers WikiList, AddWikiDialog, WikiComponentTree, WikiAsk, WikiAdmin, useWiki hook,
 * and WebSocket wiki event dispatching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp, appReducer, type AppContextState } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/context/QueueContext';
import { WikiComponentTree } from '../../../../src/server/spa/client/react/wiki/WikiComponentTree';
import { WikiList, shortenPath } from '../../../../src/server/spa/client/react/wiki/WikiList';
import { AddWikiDialog } from '../../../../src/server/spa/client/react/wiki/AddWikiDialog';
import { WikiAsk } from '../../../../src/server/spa/client/react/wiki/WikiAsk';
import { WikiAdmin } from '../../../../src/server/spa/client/react/wiki/WikiAdmin';
import { WikiDetail } from '../../../../src/server/spa/client/react/wiki/WikiDetail';
import { WikiGraph } from '../../../../src/server/spa/client/react/wiki/WikiGraph';

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

function SeededWikiDetail({
    wiki,
    initialTab,
}: {
    wiki: any;
    initialTab?: string;
}) {
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

// ============================================================================
// AppContext reducer — wiki actions
// ============================================================================

describe('AppContext reducer — wiki actions', () => {
    const baseState: AppContextState = {
        processes: [],
        selectedId: null,
        workspace: '__all',
        statusFilter: '__all',
        searchQuery: '',
        expandedGroups: {},
        activeTab: 'repos',
        workspaces: [],
        selectedRepoId: null,
        activeRepoSubTab: 'info',
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list',
        wikiDetailInitialTab: null,
        wikiDetailInitialAdminTab: null,
        wikis: [],
        conversationCache: {},
    };

    it('SET_WIKIS replaces wiki list', () => {
        const wikis = [{ id: 'w1', name: 'Wiki 1' }, { id: 'w2', name: 'Wiki 2' }];
        const result = appReducer(baseState, { type: 'SET_WIKIS', wikis });
        expect(result.wikis).toEqual(wikis);
    });

    it('SELECT_WIKI sets selectedWikiId and switches to detail view', () => {
        const result = appReducer(baseState, { type: 'SELECT_WIKI', wikiId: 'w1' });
        expect(result.selectedWikiId).toBe('w1');
        expect(result.selectedWikiComponentId).toBeNull();
        expect(result.wikiView).toBe('detail');
    });

    it('SELECT_WIKI with null clears selection and returns to list view', () => {
        const withWiki = { ...baseState, selectedWikiId: 'w1', wikiView: 'detail' as const };
        const result = appReducer(withWiki, { type: 'SELECT_WIKI', wikiId: null });
        expect(result.selectedWikiId).toBeNull();
        expect(result.wikiView).toBe('list');
    });

    it('SELECT_WIKI_COMPONENT sets selectedWikiComponentId', () => {
        const result = appReducer(baseState, { type: 'SELECT_WIKI_COMPONENT', componentId: 'comp1' });
        expect(result.selectedWikiComponentId).toBe('comp1');
    });

    it('ADD_WIKI appends wiki to list', () => {
        const wiki = { id: 'w-new', name: 'New Wiki' };
        const result = appReducer(baseState, { type: 'ADD_WIKI', wiki });
        expect(result.wikis).toHaveLength(1);
        expect(result.wikis[0].id).toBe('w-new');
    });

    it('UPDATE_WIKI updates matching wiki', () => {
        const withWikis = { ...baseState, wikis: [{ id: 'w1', name: 'Old', status: 'pending' }] };
        const result = appReducer(withWikis, { type: 'UPDATE_WIKI', wiki: { id: 'w1', name: 'Updated' } });
        expect(result.wikis[0].name).toBe('Updated');
    });

    it('UPDATE_WIKI ignores non-matching wiki', () => {
        const withWikis = { ...baseState, wikis: [{ id: 'w1', name: 'Old' }] };
        const result = appReducer(withWikis, { type: 'UPDATE_WIKI', wiki: { id: 'w999', name: 'Updated' } });
        expect(result.wikis[0].name).toBe('Old');
    });

    it('REMOVE_WIKI removes wiki from list', () => {
        const withWikis = { ...baseState, wikis: [{ id: 'w1' }, { id: 'w2' }] };
        const result = appReducer(withWikis, { type: 'REMOVE_WIKI', wikiId: 'w1' });
        expect(result.wikis).toHaveLength(1);
        expect(result.wikis[0].id).toBe('w2');
    });

    it('REMOVE_WIKI clears selectedWikiId if removed wiki was selected', () => {
        const withSelected = { ...baseState, wikis: [{ id: 'w1' }], selectedWikiId: 'w1', wikiView: 'detail' as const };
        const result = appReducer(withSelected, { type: 'REMOVE_WIKI', wikiId: 'w1' });
        expect(result.selectedWikiId).toBeNull();
        expect(result.wikiView).toBe('list');
    });

    it('WIKI_RELOAD updates matching wiki', () => {
        const withWikis = { ...baseState, wikis: [{ id: 'w1', status: 'generating' }] };
        const result = appReducer(withWikis, { type: 'WIKI_RELOAD', wiki: { id: 'w1', status: 'loaded', componentCount: 42 } });
        expect(result.wikis[0].status).toBe('loaded');
        expect(result.wikis[0].componentCount).toBe(42);
    });

    it('WIKI_RELOAD adds wiki if not found', () => {
        const result = appReducer(baseState, { type: 'WIKI_RELOAD', wiki: { id: 'w-new', status: 'loaded' } });
        expect(result.wikis).toHaveLength(1);
        expect(result.wikis[0].id).toBe('w-new');
    });

    it('WIKI_REBUILDING sets status to generating', () => {
        const withWikis = { ...baseState, wikis: [{ id: 'w1', status: 'loaded' }] };
        const result = appReducer(withWikis, { type: 'WIKI_REBUILDING', wikiId: 'w1' });
        expect(result.wikis[0].status).toBe('generating');
    });

    it('WIKI_ERROR sets status to error with message', () => {
        const withWikis = { ...baseState, wikis: [{ id: 'w1', status: 'generating' }] };
        const result = appReducer(withWikis, { type: 'WIKI_ERROR', wikiId: 'w1', error: 'Something failed' });
        expect(result.wikis[0].status).toBe('error');
        expect(result.wikis[0].errorMessage).toBe('Something failed');
    });

    it('SELECT_WIKI_WITH_TAB sets wikiDetailInitialTab', () => {
        const result = appReducer(baseState, { type: 'SELECT_WIKI_WITH_TAB', wikiId: 'w1', tab: 'admin' });
        expect(result.selectedWikiId).toBe('w1');
        expect(result.wikiView).toBe('detail');
        expect(result.wikiDetailInitialTab).toBe('admin');
        expect(result.wikiDetailInitialAdminTab).toBeNull();
    });

    it('SELECT_WIKI_WITH_TAB sets wikiDetailInitialAdminTab', () => {
        const result = appReducer(baseState, { type: 'SELECT_WIKI_WITH_TAB', wikiId: 'w1', tab: 'admin', adminTab: 'seeds' });
        expect(result.selectedWikiId).toBe('w1');
        expect(result.wikiDetailInitialTab).toBe('admin');
        expect(result.wikiDetailInitialAdminTab).toBe('seeds');
    });

    it('SELECT_WIKI clears wikiDetailInitialTab and adminTab', () => {
        const withTab = { ...baseState, wikiDetailInitialTab: 'admin', wikiDetailInitialAdminTab: 'seeds' };
        const result = appReducer(withTab, { type: 'SELECT_WIKI', wikiId: 'w1' });
        expect(result.wikiDetailInitialTab).toBeNull();
        expect(result.wikiDetailInitialAdminTab).toBeNull();
    });
});

// ============================================================================
// WikiComponentTree — grouping logic
// ============================================================================

describe('WikiComponentTree', () => {
    const mockGraphWithDomains = {
        project: { name: 'Test', description: 'Test project' },
        components: [
            { id: 'c1', name: 'Component A', path: '/a', purpose: 'Purpose A', category: 'ui', domain: 'd1' },
            { id: 'c2', name: 'Component B', path: '/b', purpose: 'Purpose B', category: 'api', domain: 'd1' },
            { id: 'c3', name: 'Component C', path: '/c', purpose: 'Purpose C', category: 'db' },
        ],
        categories: [{ id: 'ui', name: 'UI' }, { id: 'api', name: 'API' }, { id: 'db', name: 'DB' }],
        domains: [
            { id: 'd1', name: 'Frontend', description: 'Frontend domain', components: ['c1', 'c2'] },
        ],
    };

    const mockGraphWithCategories = {
        project: { name: 'Test', description: 'Test project' },
        components: [
            { id: 'c1', name: 'Widget', path: '/w', purpose: 'Widget', category: 'ui' },
            { id: 'c2', name: 'Router', path: '/r', purpose: 'Router', category: 'core' },
            { id: 'c3', name: 'DB Layer', path: '/d', purpose: 'Database', category: 'db' },
        ],
        categories: [{ id: 'ui', name: 'UI' }, { id: 'core', name: 'Core' }, { id: 'db', name: 'DB' }],
    };

    it('groups by domains when present', () => {
        const onSelect = vi.fn();
        render(
            <WikiComponentTree
                graph={mockGraphWithDomains}
                selectedComponentId={null}
                onSelect={onSelect}
            />
        );
        expect(screen.getByText('Frontend')).toBeTruthy();
        expect(screen.getByText('Other')).toBeTruthy();
        expect(screen.getByText('Component A')).toBeTruthy();
        expect(screen.getByText('Component C')).toBeTruthy();
    });

    it('groups by categories when no domains', () => {
        const onSelect = vi.fn();
        render(
            <WikiComponentTree
                graph={mockGraphWithCategories}
                selectedComponentId={null}
                onSelect={onSelect}
            />
        );
        expect(screen.getByText('ui')).toBeTruthy();
        expect(screen.getByText('core')).toBeTruthy();
        expect(screen.getByText('db')).toBeTruthy();
    });

    it('calls onSelect when component clicked', () => {
        const onSelect = vi.fn();
        render(
            <WikiComponentTree
                graph={mockGraphWithCategories}
                selectedComponentId={null}
                onSelect={onSelect}
            />
        );
        fireEvent.click(screen.getByText('Widget'));
        expect(onSelect).toHaveBeenCalledWith('c1');
    });

    it('highlights selected component', () => {
        const onSelect = vi.fn();
        render(
            <WikiComponentTree
                graph={mockGraphWithCategories}
                selectedComponentId="c2"
                onSelect={onSelect}
            />
        );
        const el = screen.getByText('Router');
        expect(el.className).toContain('active');
    });

    it('filters components by search input', () => {
        const onSelect = vi.fn();
        render(
            <WikiComponentTree
                graph={mockGraphWithCategories}
                selectedComponentId={null}
                onSelect={onSelect}
            />
        );
        const input = screen.getByPlaceholderText('Filter components…');
        fireEvent.change(input, { target: { value: 'Widget' } });
        expect(screen.getByText('Widget')).toBeTruthy();
        expect(screen.queryByText('Router')).toBeNull();
    });
});

// ============================================================================
// WikiList — renders wiki cards with correct status badges
// ============================================================================

describe('WikiList', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w1', name: 'My Wiki', status: 'loaded', color: '#3b82f6', componentCount: 10, generatedAt: new Date().toISOString() },
                { id: 'w2', name: 'Other Wiki', status: 'generating', color: '#ef4444' },
                { id: 'w3', name: 'Failed Wiki', status: 'error', color: '#22c55e' },
            ]),
        }));
    });

    it('renders wiki cards', async () => {
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('My Wiki')).toBeTruthy();
        });
        expect(screen.getByText('Other Wiki')).toBeTruthy();
        expect(screen.getByText('Failed Wiki')).toBeTruthy();
    });

    it('shows correct status badges', async () => {
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('Ready')).toBeTruthy();
        });
        expect(screen.getByText('Generating')).toBeTruthy();
        expect(screen.getByText('Error')).toBeTruthy();
    });

    it('shows empty state when no wikis', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('No wikis registered.')).toBeTruthy();
        });
    });

    it('shows "Setup Required" badge for pending wikis', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w-pending', name: 'Pending Wiki', status: 'pending', color: '#aaa' },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('Setup Required')).toBeTruthy();
        });
    });

    it('shows "→ Setup" CTA button only on pending wiki cards', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w1', name: 'Loaded Wiki', status: 'loaded', color: '#3b82f6', componentCount: 5 },
                { id: 'w2', name: 'Pending Wiki', status: 'pending', color: '#aaa' },
                { id: 'w3', name: 'Generating Wiki', status: 'generating', color: '#eee' },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('Loaded Wiki')).toBeTruthy();
        });
        const setupButtons = screen.getAllByText('→ Setup');
        expect(setupButtons).toHaveLength(1);
    });

    it('does not show "→ Setup" CTA on loaded wikis', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w1', name: 'Loaded Wiki', status: 'loaded', color: '#3b82f6', componentCount: 10 },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('Ready')).toBeTruthy();
        });
        expect(screen.queryByText('→ Setup')).toBeNull();
    });

    it('does not show "→ Setup" CTA on generating or error wikis', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w2', name: 'Generating Wiki', status: 'generating', color: '#ef4444' },
                { id: 'w3', name: 'Error Wiki', status: 'error', color: '#22c55e' },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('Generating Wiki')).toBeTruthy();
        });
        expect(screen.queryByText('→ Setup')).toBeNull();
    });
    it('shows repo path on wiki card when repoPath is provided', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w1', name: 'My Wiki', status: 'loaded', color: '#3b82f6', repoPath: '/tmp/my-project', componentCount: 10 },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('My Wiki')).toBeTruthy();
        });
        expect(screen.getByText(/📂.*\/tmp\/my-project/)).toBeTruthy();
    });

    it('shows full repoPath as tooltip', async () => {
        const fullPath = '/tmp/my-project';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w1', name: 'My Wiki', status: 'loaded', color: '#3b82f6', repoPath: fullPath },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('My Wiki')).toBeTruthy();
        });
        const repoDiv = screen.getByTitle(fullPath);
        expect(repoDiv).toBeTruthy();
    });

    it('hides repo path row when repoPath is empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w1', name: 'No Path Wiki', status: 'loaded', color: '#3b82f6', repoPath: '' },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('No Path Wiki')).toBeTruthy();
        });
        expect(screen.queryByText(/📂/)).toBeNull();
    });

    it('hides repo path row when repoPath is undefined', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w1', name: 'No Path Wiki', status: 'loaded', color: '#3b82f6' },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('No Path Wiki')).toBeTruthy();
        });
        expect(screen.queryByText(/📂/)).toBeNull();
    });

    it('shows repo path for pending wikis too', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: 'w1', name: 'Pending Wiki', status: 'pending', color: '#aaa', repoPath: '/tmp/pending-repo' },
            ]),
        }));
        render(<Wrap><WikiList /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('Pending Wiki')).toBeTruthy();
        });
        expect(screen.getByText(/📂.*\/tmp\/pending-repo/)).toBeTruthy();
    });
});

// ============================================================================
// shortenPath — home directory replacement
// ============================================================================

describe('shortenPath', () => {
    it('replaces /Users/xxx prefix with ~', () => {
        expect(shortenPath('/Users/alice/projects/foo')).toBe('~/projects/foo');
    });

    it('replaces /home/xxx prefix with ~', () => {
        expect(shortenPath('/home/bob/repos/bar')).toBe('~/repos/bar');
    });

    it('returns path unchanged when no home prefix detected', () => {
        expect(shortenPath('/opt/data/repo')).toBe('/opt/data/repo');
    });

    it('returns empty string unchanged', () => {
        expect(shortenPath('')).toBe('');
    });

    it('handles path that is exactly a home directory', () => {
        expect(shortenPath('/Users/alice')).toBe('~');
    });

    it('handles Windows-style paths without home prefix', () => {
        expect(shortenPath('C:\\Users\\alice\\projects')).toBe('C:\\Users\\alice\\projects');
    });
});

// ============================================================================
// AddWikiDialog — form validation and submission
// ============================================================================

describe('AddWikiDialog', () => {
    it('shows validation error when name is empty', async () => {
        const onClose = vi.fn();
        const onAdded = vi.fn();
        render(<AddWikiDialog open={true} onClose={onClose} onAdded={onAdded} />);

        fireEvent.click(screen.getByText('Create'));
        await waitFor(() => {
            expect(screen.getByText('Name is required')).toBeTruthy();
        });
    });

    it('shows validation error when repo path is empty', async () => {
        const onClose = vi.fn();
        const onAdded = vi.fn();
        render(<AddWikiDialog open={true} onClose={onClose} onAdded={onAdded} />);

        const nameInput = screen.getByPlaceholderText('My Project Wiki');
        fireEvent.change(nameInput, { target: { value: 'Test Wiki' } });
        fireEvent.click(screen.getByText('Create'));
        await waitFor(() => {
            expect(screen.getByText('Repository path is required')).toBeTruthy();
        });
    });

    it('submits correct POST body and closes on success', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'new-wiki' }) });
        vi.stubGlobal('fetch', mockFetch);
        const onClose = vi.fn();
        const onAdded = vi.fn();

        render(<AddWikiDialog open={true} onClose={onClose} onAdded={onAdded} />);

        fireEvent.change(screen.getByPlaceholderText('My Project Wiki'), { target: { value: 'Test Wiki' } });
        fireEvent.change(screen.getByPlaceholderText('/path/to/repo'), { target: { value: '/my/repo' } });
        fireEvent.click(screen.getByText('Create'));

        await waitFor(() => {
            expect(onClose).toHaveBeenCalled();
        });
        expect(onAdded).toHaveBeenCalled();
        const call = mockFetch.mock.calls.find((c: any[]) => c[0].toString().includes('/wikis'));
        expect(call).toBeTruthy();
        const body = JSON.parse(call![1].body);
        expect(body.name).toBe('Test Wiki');
        expect(body.repoPath).toBe('/my/repo');
        expect(body.color).toBe('#3b82f6');
    });
});

// ============================================================================
// WikiAsk — message handling
// ============================================================================

describe('WikiAsk', () => {
    it('renders with input field and send button', () => {
        render(<WikiAsk wikiId="w1" wikiName="Test Wiki" currentComponentId={null} />);
        expect(screen.getByPlaceholderText('Ask a question…')).toBeTruthy();
        expect(screen.getByText('Send')).toBeTruthy();
    });

    it('shows empty state text', () => {
        render(<WikiAsk wikiId="w1" wikiName="Test Wiki" currentComponentId={null} />);
        expect(screen.getByText('Ask a question about the codebase')).toBeTruthy();
    });

    it('appends user message immediately on send', async () => {
        // Mock a streaming response
        const mockReader = {
            read: vi.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new TextEncoder().encode('data: {"type":"done","fullResponse":"Hi","sessionId":"s1"}\n\n'),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            body: { getReader: () => mockReader },
        }));

        render(<WikiAsk wikiId="w1" wikiName="Test Wiki" currentComponentId={null} />);
        const input = screen.getByPlaceholderText('Ask a question…');
        fireEvent.change(input, { target: { value: 'What is this?' } });
        fireEvent.click(screen.getByText('Send'));

        await waitFor(() => {
            expect(screen.getByText('What is this?')).toBeTruthy();
        });
    });
});

// ============================================================================
// WikiAdmin — Generate tab renders phase cards
// ============================================================================

describe('WikiAdmin', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        }));
    });

    it('shows phase cards in Generate tab', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            expect(screen.getByText('Discovery')).toBeTruthy();
        });
        expect(screen.getByText('Consolidation')).toBeTruthy();
        expect(screen.getByText('Analysis')).toBeTruthy();
        expect(screen.getByText('Writing')).toBeTruthy();
        expect(screen.getByText('Website')).toBeTruthy();
    });

    it('shows Run buttons for each phase', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            const runButtons = screen.getAllByText('Run');
            expect(runButtons.length).toBe(5);
        });
    });

    it('has Run All button', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            expect(screen.getByText('Run All')).toBeTruthy();
        });
    });

    it('shows Danger Zone with Delete Wiki button on Delete tab', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            expect(screen.getByText('Delete')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('Delete'));
        await waitFor(() => {
            expect(screen.getByText('Danger Zone')).toBeTruthy();
            expect(screen.getByText('Delete Wiki')).toBeTruthy();
        });
    });

    it('does not show Danger Zone on Generate tab', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            expect(screen.getByText('Discovery')).toBeTruthy();
        });
        expect(screen.queryByText('Danger Zone')).toBeNull();
    });

    it('Delete tab button has danger styling', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            const deleteBtn = screen.getByText('Delete');
            expect(deleteBtn.className).toContain('f14c4c');
        });
    });

    it('loads config content and saves with { content } payload', async () => {
        const mockFetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = (init?.method || 'GET').toUpperCase();

            if (url.includes('/admin/cache')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                });
            }

            if (method === 'GET' && url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        exists: true,
                        content: 'model: gpt-4o\n',
                        path: '/tmp/deep-wiki.config.yaml',
                    }),
                });
            }

            if (method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true }),
                });
            }

            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({}),
            });
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<WikiAdmin wikiId="w1" />);
        fireEvent.click(screen.getByText('Config'));

        await waitFor(() => {
            expect(screen.getByText('/tmp/deep-wiki.config.yaml')).toBeTruthy();
        });

        const textarea = screen.getByRole('textbox');
        expect((textarea as HTMLTextAreaElement).value).toBe('model: gpt-4o\n');

        fireEvent.change(textarea, { target: { value: 'model: claude-haiku-4.5\n' } });
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(screen.getByText('Saved')).toBeTruthy();
        });

        const putCall = mockFetch.mock.calls.find((call: any[]) => {
            const url = String(call[0]);
            const method = (call[1]?.method || 'GET').toUpperCase();
            return url.includes('/admin/config') && method === 'PUT';
        });
        expect(putCall).toBeTruthy();
        expect(JSON.parse(putCall[1].body)).toEqual({
            content: 'model: claude-haiku-4.5\n',
        });
    });

    it('normalizes generated seeds using theme field (not name)', async () => {
        // Mock SSE stream that returns seeds with theme/description/hints
        const ssePayload = [
            'data: {"type":"status","message":"Generating..."}\n\n',
            'data: {"type":"done","success":true,"seeds":[{"theme":"auth","description":"Authentication","hints":["login"]},{"theme":"db","description":"Database","hints":["sql"]}]}\n\n',
        ].join('');

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(ssePayload));
                controller.close();
            },
        });

        const mockFetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = (init?.method || 'GET').toUpperCase();
            if (url.includes('/admin/seeds/generate') && method === 'POST') {
                return Promise.resolve({ ok: true, body: stream.getReader ? stream : { getReader: () => stream.getReader() } });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ exists: false, content: null }) });
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<WikiAdmin wikiId="w1" initialTab="seeds" />);
        await waitFor(() => {
            expect(screen.getByText('Generate Seeds')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Generate Seeds'));

        await waitFor(() => {
            const editor = document.getElementById('seeds-editor') as HTMLTextAreaElement;
            expect(editor).toBeTruthy();
            if (editor) {
                // Must use 'theme' field, not 'name'
                expect(editor.value).toContain('theme');
                expect(editor.value).not.toContain('[object Object]');
                // Should not use the old 'name:' serialization
                expect(editor.value).not.toMatch(/^- name:/m);
            }
        });
    });
});

// ============================================================================
// WikiAdmin seed YAML serialization (unit-level)
// ============================================================================

describe('WikiAdmin seed YAML normalization', () => {
    it('normalizes seeds with missing/wrong fields gracefully', () => {
        // Test the normalization logic directly
        const seeds: any[] = [
            { theme: 'auth', description: 'Auth module', hints: ['login'] },
            { theme: { nested: 'object' }, description: 'Bad theme', hints: [] },
            { theme: 'db', description: 123 as any, hints: 'not-array' as any },
        ];

        const normalized = seeds.map((s: any) => ({
            theme: typeof s.theme === 'string' ? s.theme : String(s.theme ?? ''),
            description: typeof s.description === 'string' ? s.description : '',
            hints: Array.isArray(s.hints) ? s.hints : [],
        }));

        expect(normalized[0]).toEqual({ theme: 'auth', description: 'Auth module', hints: ['login'] });
        expect(normalized[1].theme).toBe('[object Object]');
        expect(normalized[1].description).toBe('Bad theme');
        expect(normalized[2].description).toBe('');
        expect(normalized[2].hints).toEqual([]);
    });

    it('loads existing seeds as YAML (not JSON) when API returns an object', async () => {
        const mockFetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/admin/seeds')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        exists: true,
                        content: { themes: [{ theme: 'auth', description: 'Auth module', hints: ['login'] }] },
                        path: '/test/repo/seeds.yaml',
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
        vi.stubGlobal('fetch', mockFetch);

        const { unmount } = render(<WikiAdmin wikiId="w1" initialTab="seeds" />);

        await waitFor(() => {
            const editor = document.getElementById('seeds-editor') as HTMLTextAreaElement;
            expect(editor).toBeTruthy();
            if (editor) {
                // Content must be YAML, not JSON
                expect(editor.value).not.toContain('{');
                expect(editor.value).toContain('theme: auth');
                expect(editor.value).toContain('hints:');
            }
        });

        unmount();
    });

    it('generated seeds content is YAML (not JSON)', async () => {
        const ssePayload = [
            'data: {"type":"done","success":true,"seeds":[{"theme":"auth","description":"Auth","hints":["login"]}]}\n\n',
        ].join('');

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(ssePayload));
                controller.close();
            },
        });

        const mockFetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = (init?.method || 'GET').toUpperCase();
            if (url.includes('/admin/seeds/generate') && method === 'POST') {
                return Promise.resolve({ ok: true, body: stream.getReader ? stream : { getReader: () => stream.getReader() } });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ exists: false, content: null }) });
        });
        vi.stubGlobal('fetch', mockFetch);

        const { unmount } = render(<WikiAdmin wikiId="w1" initialTab="seeds" />);
        await waitFor(() => expect(screen.getByText('Generate Seeds')).toBeTruthy());
        fireEvent.click(screen.getByText('Generate Seeds'));

        await waitFor(() => {
            const editor = document.getElementById('seeds-editor') as HTMLTextAreaElement;
            expect(editor).toBeTruthy();
            if (editor) {
                expect(editor.value).not.toContain('{');
                expect(editor.value).toContain('theme: auth');
            }
        });

        unmount();
    });
});

// ============================================================================
// WikiAdmin — sub-tab routing via props
// ============================================================================

describe('WikiAdmin sub-tab routing', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        }));
    });

    it('defaults to Generate tab when no initialTab', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            expect(screen.getByText('Discovery')).toBeTruthy();
        });
    });

    it('opens Seeds tab when initialTab="seeds"', async () => {
        render(<WikiAdmin wikiId="w1" initialTab="seeds" />);
        await waitFor(() => {
            expect(screen.getByText('Generate Seeds')).toBeTruthy();
        });
    });

    it('opens Config tab when initialTab="config"', async () => {
        const mockFetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/admin/config')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        exists: true,
                        content: 'model: gpt-4o\n',
                        path: '/tmp/deep-wiki.config.yaml',
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<WikiAdmin wikiId="w1" initialTab="config" />);
        await waitFor(() => {
            expect(screen.getByText('/tmp/deep-wiki.config.yaml')).toBeTruthy();
        });
    });

    it('opens Delete tab when initialTab="delete"', async () => {
        render(<WikiAdmin wikiId="w1" initialTab="delete" />);
        await waitFor(() => {
            expect(screen.getByText('Danger Zone')).toBeTruthy();
        });
    });

    it('calls onTabChange when switching sub-tabs', async () => {
        const onTabChange = vi.fn();
        render(<WikiAdmin wikiId="w1" onTabChange={onTabChange} />);
        await waitFor(() => {
            expect(screen.getByText('Seeds')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('Seeds'));
        expect(onTabChange).toHaveBeenCalledWith('seeds');
    });

    it('calls onTabChange with "config" when clicking Config', async () => {
        const onTabChange = vi.fn();
        render(<WikiAdmin wikiId="w1" onTabChange={onTabChange} />);
        await waitFor(() => {
            expect(screen.getByText('Config')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('Config'));
        expect(onTabChange).toHaveBeenCalledWith('config');
    });

    it('sub-tab buttons have data-wiki-admin-tab attribute', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            expect(screen.getByText('Generate')).toBeTruthy();
        });
        for (const t of ['generate', 'seeds', 'config', 'delete']) {
            const btn = document.querySelector(`[data-wiki-admin-tab="${t}"]`);
            expect(btn).toBeTruthy();
        }
    });
});

// ============================================================================
// WikiDetail — pending setup/admin path
// ============================================================================

describe('WikiDetail pending setup flow', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/wikis/w-pending/graph')) {
                return Promise.resolve({
                    ok: false,
                    status: 404,
                    json: () => Promise.resolve({ error: 'Not generated' }),
                });
            }
            if (url.includes('/wikis/w-pending/admin/cache')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({}),
                });
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({}),
            });
        }));
    });

    it('shows admin setup content when selecting Admin tab on a pending wiki', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w-pending', name: 'Pending Wiki', status: 'pending' }}
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Admin')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('Admin'));

        await waitFor(() => {
            expect(screen.getByText('Run All')).toBeTruthy();
        });
        expect(screen.queryByText('→ Run Setup Wizard')).toBeNull();
    });

    it('switches from setup prompt to admin setup content when clicking setup button', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w-pending', name: 'Pending Wiki', status: 'pending' }}
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('→ Run Setup Wizard')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('→ Run Setup Wizard'));

        await waitFor(() => {
            expect(screen.getByText('Run All')).toBeTruthy();
        });
    });
});

// ============================================================================
// WikiDetail — tab routing via URL hash
// ============================================================================

describe('WikiDetail tab routing', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/graph')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        components: [{ id: 'c1', name: 'Component A', path: '/a', purpose: 'Purpose A', category: 'ui' }],
                        categories: [{ id: 'ui', name: 'UI' }],
                        project: { name: 'Test Project', description: 'A test', mainLanguage: 'TypeScript' },
                    }),
                });
            }
            if (url.includes('/admin/cache')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }));
        location.hash = '';
    });

    it('renders browse tab by default', async () => {
        render(
            <Wrap>
                <SeededWikiDetail wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }} />
            </Wrap>
        );

        await waitFor(() => {
            const browseBtn = screen.getByText('Browse');
            expect(browseBtn.className).toContain('active');
        });
    });

    it('renders admin tab when initialTab is "admin"', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }}
                    initialTab="admin"
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Run All')).toBeTruthy();
        });
        const adminBtn = screen.getByText('Admin');
        expect(adminBtn.className).toContain('active');
    });

    it('renders ask tab when initialTab is "ask"', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }}
                    initialTab="ask"
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Ask a question about the codebase')).toBeTruthy();
        });
        const askBtn = screen.getByText('Ask');
        expect(askBtn.className).toContain('active');
    });

    it('updates hash when clicking a tab', async () => {
        render(
            <Wrap>
                <SeededWikiDetail wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Ask')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Ask'));

        expect(location.hash).toBe('#wiki/w1/ask');
    });

    it('updates hash to #wiki/:id for browse tab (no /browse suffix)', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }}
                    initialTab="ask"
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Browse')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Browse'));

        expect(location.hash).toBe('#wiki/w1');
    });

    it('updates hash to admin tab', async () => {
        render(
            <Wrap>
                <SeededWikiDetail wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Admin')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Admin'));

        expect(location.hash).toBe('#wiki/w1/admin');
    });

    it('updates hash to graph tab', async () => {
        render(
            <Wrap>
                <SeededWikiDetail wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Graph')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Graph'));

        expect(location.hash).toBe('#wiki/w1/graph');
    });

    it('encodes wiki ID in hash', async () => {
        render(
            <Wrap>
                <SeededWikiDetail wiki={{ id: 'my wiki', name: 'Spaced Wiki', status: 'loaded' }} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Ask')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Ask'));

        expect(location.hash).toBe('#wiki/my%20wiki/ask');
    });

    it('updates hash to admin sub-tab when clicking Seeds in admin', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }}
                    initialTab="admin"
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Seeds')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Seeds'));

        expect(location.hash).toBe('#wiki/w1/admin/seeds');
    });

    it('updates hash to admin/config when clicking Config in admin', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }}
                    initialTab="admin"
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Config')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Config'));

        expect(location.hash).toBe('#wiki/w1/admin/config');
    });

    it('updates hash to admin/delete when clicking Delete in admin', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }}
                    initialTab="admin"
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Delete')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Delete'));

        expect(location.hash).toBe('#wiki/w1/admin/delete');
    });

    it('updates hash to plain admin when clicking Generate (default sub-tab)', async () => {
        render(
            <Wrap>
                <SeededWikiDetail
                    wiki={{ id: 'w1', name: 'My Wiki', status: 'loaded' }}
                    initialTab="admin"
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Seeds')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Seeds'));
        fireEvent.click(screen.getByText('Generate'));

        expect(location.hash).toBe('#wiki/w1/admin');
    });
});

// ============================================================================
// useWebSocket — wiki event dispatching (App.tsx onMessage)
// ============================================================================

describe('useWebSocket wiki event dispatching', () => {
    it('WIKI_RELOAD action updates wiki in state', () => {
        const state: AppContextState = {
            processes: [], selectedId: null, workspace: '__all', statusFilter: '__all',
            searchQuery: '', expandedGroups: {}, activeTab: 'repos', workspaces: [],
            selectedRepoId: null, activeRepoSubTab: 'info',
            selectedWikiId: null, selectedWikiComponentId: null, wikiView: 'list',
            wikiDetailInitialTab: null,
            wikiDetailInitialAdminTab: null,
            wikis: [{ id: 'w1', name: 'Old', status: 'generating' }],
            conversationCache: {},
        };
        const result = appReducer(state, { type: 'WIKI_RELOAD', wiki: { id: 'w1', name: 'Updated', status: 'loaded' } });
        expect(result.wikis[0].status).toBe('loaded');
        expect(result.wikis[0].name).toBe('Updated');
    });

    it('WIKI_REBUILDING action sets status to generating', () => {
        const state: AppContextState = {
            processes: [], selectedId: null, workspace: '__all', statusFilter: '__all',
            searchQuery: '', expandedGroups: {}, activeTab: 'repos', workspaces: [],
            selectedRepoId: null, activeRepoSubTab: 'info',
            selectedWikiId: null, selectedWikiComponentId: null, wikiView: 'list',
            wikiDetailInitialTab: null,
            wikiDetailInitialAdminTab: null,
            wikis: [{ id: 'w1', status: 'loaded' }],
            conversationCache: {},
        };
        const result = appReducer(state, { type: 'WIKI_REBUILDING', wikiId: 'w1' });
        expect(result.wikis[0].status).toBe('generating');
    });

    it('WIKI_ERROR action sets status and error message', () => {
        const state: AppContextState = {
            processes: [], selectedId: null, workspace: '__all', statusFilter: '__all',
            searchQuery: '', expandedGroups: {}, activeTab: 'repos', workspaces: [],
            selectedRepoId: null, activeRepoSubTab: 'info',
            selectedWikiId: null, selectedWikiComponentId: null, wikiView: 'list',
            wikiDetailInitialTab: null,
            wikiDetailInitialAdminTab: null,
            wikis: [{ id: 'w1', status: 'generating' }],
            conversationCache: {},
        };
        const result = appReducer(state, { type: 'WIKI_ERROR', wikiId: 'w1', error: 'Phase 3 failed' });
        expect(result.wikis[0].status).toBe('error');
        expect(result.wikis[0].errorMessage).toBe('Phase 3 failed');
    });
});

// ============================================================================
// WikiGraph — D3 loading and rendering
// ============================================================================

describe('WikiGraph', () => {
    const mockGraph = {
        components: [
            { id: 'c1', name: 'Auth', path: '/auth', purpose: 'Auth module', category: 'core', complexity: 'medium' as const, dependencies: ['c2'] },
            { id: 'c2', name: 'DB', path: '/db', purpose: 'Database layer', category: 'data', complexity: 'high' as const, dependencies: [] },
            { id: 'c3', name: 'UI', path: '/ui', purpose: 'User interface', category: 'frontend', complexity: 'low' as const, dependencies: ['c1'] },
        ],
        categories: [{ id: 'core', name: 'Core' }, { id: 'data', name: 'Data' }, { id: 'frontend', name: 'Frontend' }],
        project: { name: 'Test', description: 'A test project' },
    };

    beforeEach(() => {
        // Stub d3 on window so ensureD3() resolves immediately without loading CDN
        const mockD3Selection = {
            selectAll: vi.fn().mockReturnThis(),
            remove: vi.fn().mockReturnThis(),
            attr: vi.fn().mockReturnThis(),
            append: vi.fn().mockReturnThis(),
            data: vi.fn().mockReturnThis(),
            join: vi.fn().mockReturnThis(),
            style: vi.fn().mockReturnThis(),
            call: vi.fn().mockReturnThis(),
            on: vi.fn().mockReturnThis(),
            text: vi.fn().mockReturnThis(),
        };
        const mockSimulation = {
            force: vi.fn().mockReturnThis(),
            on: vi.fn().mockReturnThis(),
            stop: vi.fn(),
        };
        (window as any).d3 = {
            select: vi.fn().mockReturnValue(mockD3Selection),
            drag: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis() }),
            forceSimulation: vi.fn().mockReturnValue(mockSimulation),
            forceLink: vi.fn().mockReturnValue({ id: vi.fn().mockReturnThis(), distance: vi.fn().mockReturnThis() }),
            forceManyBody: vi.fn().mockReturnValue({ strength: vi.fn().mockReturnThis() }),
            forceCenter: vi.fn().mockReturnValue({}),
            forceCollide: vi.fn().mockReturnValue({ radius: vi.fn().mockReturnThis() }),
            zoom: vi.fn().mockReturnValue({ scaleExtent: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis() }) }),
        };
    });

    it('renders SVG and legend after D3 loads', async () => {
        const onSelect = vi.fn();
        const { container } = render(
            <WikiGraph wikiId="w1" graph={mockGraph} onSelectComponent={onSelect} />
        );
        // After D3 loads (window.d3 is stubbed), loading should be false and SVG should render
        await waitFor(() => {
            expect(container.querySelector('#wiki-graph-container')).toBeTruthy();
            expect(container.querySelector('svg')).toBeTruthy();
        });
    });

    it('renders category legend with all categories', async () => {
        const onSelect = vi.fn();
        render(
            <WikiGraph wikiId="w1" graph={mockGraph} onSelectComponent={onSelect} />
        );
        await waitFor(() => {
            expect(screen.getByText('Categories')).toBeTruthy();
        });
        expect(screen.getByText('core')).toBeTruthy();
        expect(screen.getByText('data')).toBeTruthy();
        expect(screen.getByText('frontend')).toBeTruthy();
    });

    it('calls d3.select and forceSimulation when rendering graph', async () => {
        const onSelect = vi.fn();
        render(
            <WikiGraph wikiId="w1" graph={mockGraph} onSelectComponent={onSelect} />
        );
        await waitFor(() => {
            expect((window as any).d3.select).toHaveBeenCalled();
            expect((window as any).d3.forceSimulation).toHaveBeenCalled();
        });
    });

    it('toggles category disabled state when legend item clicked', async () => {
        const onSelect = vi.fn();
        render(
            <WikiGraph wikiId="w1" graph={mockGraph} onSelectComponent={onSelect} />
        );
        await waitFor(() => {
            expect(screen.getByText('core')).toBeTruthy();
        });
        const coreLegendItem = screen.getByText('core').closest('.wiki-graph-legend-item')!;
        expect(coreLegendItem.className).not.toContain('line-through');

        fireEvent.click(coreLegendItem);
        expect(coreLegendItem.className).toContain('line-through');

        // Toggle back
        fireEvent.click(coreLegendItem);
        expect(coreLegendItem.className).not.toContain('line-through');
    });

    it('renders legend swatches with correct category colors', async () => {
        const onSelect = vi.fn();
        render(
            <WikiGraph wikiId="w1" graph={mockGraph} onSelectComponent={onSelect} />
        );
        await waitFor(() => {
            expect(screen.getByText('core')).toBeTruthy();
        });
        const swatches = document.querySelectorAll('.wiki-graph-legend-swatch');
        expect(swatches.length).toBe(3);
    });
});

// ============================================================================
// WikiDetail — height class consistency
// ============================================================================

describe('WikiDetail height class', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/graph')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        components: [{ id: 'c1', name: 'A', path: '/a', purpose: 'p', category: 'ui' }],
                        categories: [{ id: 'ui', name: 'UI' }],
                        project: { name: 'T', description: 'd' },
                    }),
                });
            }
            if (url.includes('/admin/cache')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }));
        location.hash = '';
    });

    it('uses viewport-relative height instead of h-full', async () => {
        render(
            <Wrap>
                <SeededWikiDetail wiki={{ id: 'w1', name: 'Test', status: 'loaded' }} />
            </Wrap>
        );
        await waitFor(() => {
            const el = document.getElementById('view-wiki');
            expect(el).toBeTruthy();
            expect(el!.className).toContain('h-[calc(100vh-48px)]');
            expect(el!.className).toContain('overflow-hidden');
            expect(el!.className).not.toContain(' h-full');
        });
    });
});

// ============================================================================
// WikiGraph — effect separation (regression test for React 18 batching bug)
// ============================================================================

describe('WikiGraph effect separation', () => {
    it('WikiGraph source uses separate effects for D3 loading and rendering', () => {
        // Regression test: ensure the component has two separate useEffect calls
        // to avoid React 18 batching issue where renderGraph runs before SVG is in DOM.
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../../src/server/spa/client/react/wiki/WikiGraph.tsx'),
            'utf8'
        );

        // Effect 1: loads D3 with empty deps
        expect(source).toContain('ensureD3()');
        expect(source).toContain('.then(() => setLoading(false))');

        // Effect 2: renders graph after loading
        expect(source).toContain('if (!loading && !error)');
        expect(source).toContain('[loading, error, renderGraph]');

        // Should NOT have the old combined pattern
        expect(source).not.toContain('setLoading(false); renderGraph()');
    });
});

// ============================================================================
// Wiki React source files exist
// ============================================================================

describe('wiki React source files exist', () => {
    const fs = require('fs');
    const path = require('path');
    const WIKI_DIR = path.resolve(__dirname, '../../../../src/server/spa/client/react/wiki');

    const expectedFiles = [
        'WikiView.tsx', 'WikiList.tsx', 'WikiDetail.tsx',
        'WikiComponentTree.tsx', 'WikiComponent.tsx',
        'WikiGraph.tsx', 'WikiAsk.tsx', 'WikiAdmin.tsx',
        'AddWikiDialog.tsx', 'EditWikiDialog.tsx',
    ];

    for (const file of expectedFiles) {
        it(`should have wiki/${file}`, () => {
            expect(fs.existsSync(path.join(WIKI_DIR, file))).toBe(true);
        });
    }

    it('should have hooks/useWiki.ts', () => {
        const hooksDir = path.resolve(__dirname, '../../../../src/server/spa/client/react/hooks');
        expect(fs.existsSync(path.join(hooksDir, 'useWiki.ts'))).toBe(true);
    });
});

// ============================================================================
// Vanilla wiki files deleted
// ============================================================================

describe('vanilla wiki files removed', () => {
    const fs = require('fs');
    const path = require('path');
    const CLIENT_DIR = path.resolve(__dirname, '../../../../src/server/spa/client');

    const deletedFiles = [
        'wiki.ts', 'wiki-admin.ts', 'wiki-ask.ts', 'wiki-graph.ts',
        'wiki-content.ts', 'wiki-components.ts', 'wiki-markdown.ts',
        'wiki-toc.ts', 'wiki-mermaid-zoom.ts', 'wiki-types.ts',
        'wiki-styles.css', 'wiki-ask.css',
    ];

    for (const file of deletedFiles) {
        it(`${file} should be deleted`, () => {
            expect(fs.existsSync(path.join(CLIENT_DIR, file))).toBe(false);
        });
    }
});
