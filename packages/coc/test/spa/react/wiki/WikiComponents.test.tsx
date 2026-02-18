/**
 * Tests for Wiki React components.
 * Covers WikiList, AddWikiDialog, WikiComponentTree, WikiAsk, WikiAdmin, useWiki hook,
 * and WebSocket wiki event dispatching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, useApp, appReducer, type AppContextState } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/context/QueueContext';
import { WikiComponentTree } from '../../../../src/server/spa/client/react/wiki/WikiComponentTree';
import { WikiList } from '../../../../src/server/spa/client/react/wiki/WikiList';
import { AddWikiDialog } from '../../../../src/server/spa/client/react/wiki/AddWikiDialog';
import { WikiAsk } from '../../../../src/server/spa/client/react/wiki/WikiAsk';
import { WikiAdmin } from '../../../../src/server/spa/client/react/wiki/WikiAdmin';

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
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
    });

    it('SELECT_WIKI clears wikiDetailInitialTab', () => {
        const withTab = { ...baseState, wikiDetailInitialTab: 'admin' };
        const result = appReducer(withTab, { type: 'SELECT_WIKI', wikiId: 'w1' });
        expect(result.wikiDetailInitialTab).toBeNull();
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

    it('shows Danger Zone with Delete Wiki button', async () => {
        render(<WikiAdmin wikiId="w1" />);
        await waitFor(() => {
            expect(screen.getByText('Danger Zone')).toBeTruthy();
            expect(screen.getByText('Delete Wiki')).toBeTruthy();
        });
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
            wikis: [{ id: 'w1', status: 'generating' }],
            conversationCache: {},
        };
        const result = appReducer(state, { type: 'WIKI_ERROR', wikiId: 'w1', error: 'Phase 3 failed' });
        expect(result.wikis[0].status).toBe('error');
        expect(result.wikis[0].errorMessage).toBe('Phase 3 failed');
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
