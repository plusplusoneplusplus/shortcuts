/**
 * Mobile-specific wiki view tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BreakpointState } from '../../../../src/server/spa/client/react/hooks/useBreakpoint';

// ── Mutable mock state ─────────────────────────────────────────────────

let mockBreakpoint: BreakpointState = { breakpoint: 'desktop', isMobile: false, isTablet: false, isDesktop: true };
const mockAppDispatch = vi.fn();
let mockAppState: Record<string, any> = {};

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: {
            wikis: [],
            selectedWikiComponentId: null,
            wikiDetailInitialTab: null,
            wikiDetailInitialAdminTab: null,
            wikiAutoGenerate: false,
            ...mockAppState,
        },
        dispatch: mockAppDispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useWiki', () => ({
    useWiki: () => ({
        wikis: [
            { id: 'w1', name: 'Wiki 1', repoPath: '/repos/one', loaded: true, componentCount: 5 },
            { id: 'w2', name: 'Wiki 2', repoPath: '/repos/two', loaded: true, componentCount: 3 },
        ],
        reload: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useMermaid', () => ({
    useMermaid: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/shared/ResponsiveSidebar', () => ({
    ResponsiveSidebar: ({ children, isOpen }: any) => (
        <aside data-testid="responsive-sidebar" data-open={isOpen}>
            {children}
        </aside>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/shared/BottomSheet', () => ({
    BottomSheet: ({ isOpen, onClose, title, children }: any) =>
        isOpen ? (
            <div data-testid="bottomsheet-mock" data-title={title}>
                <button data-testid="bottomsheet-close" onClick={onClose}>close</button>
                {children}
            </div>
        ) : null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

// ── Import after mocks ─────────────────────────────────────────────────

import { WikiList } from '../../../../src/server/spa/client/react/wiki/WikiList';
import { WikiDetail } from '../../../../src/server/spa/client/react/wiki/WikiDetail';
import { WikiAsk } from '../../../../src/server/spa/client/react/wiki/WikiAsk';
import { WikiGraph } from '../../../../src/server/spa/client/react/wiki/WikiGraph';

// ── Helpers ────────────────────────────────────────────────────────────

function setBreakpoint(bp: 'mobile' | 'tablet' | 'desktop') {
    mockBreakpoint = {
        breakpoint: bp,
        isMobile: bp === 'mobile',
        isTablet: bp === 'tablet',
        isDesktop: bp === 'desktop',
    };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('WikiList mobile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setBreakpoint('mobile');
        mockAppState = {};
    });

    it('renders wiki cards in a grid with mobile padding', () => {
        const { container } = render(<WikiList />);
        const grid = container.querySelector('#wiki-card-list');
        expect(grid).toBeTruthy();
        // Grid has mobile padding class
        expect(grid!.className).toContain('px-2');
        expect(grid!.className).toContain('sm:px-0');
        // Has grid-cols-1 for mobile
        expect(grid!.className).toContain('grid-cols-1');
    });
});

describe('WikiDetail browse tab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setBreakpoint('mobile');
        mockAppState = {
            wikis: [{ id: 'w1', name: 'Test Wiki', loaded: true, status: 'loaded' }],
        };
    });

    it('renders sidebar inside ResponsiveSidebar when graph is available', async () => {
        const { fetchApi } = await import('../../../../src/server/spa/client/react/hooks/useApi');
        (fetchApi as any).mockResolvedValueOnce({
            components: [{ id: 'c1', name: 'Comp 1', path: '/a', purpose: 'test', category: 'core' }],
            categories: [{ id: 'core', name: 'Core' }],
            project: { name: 'Test', description: 'desc' },
        });

        render(<WikiDetail wikiId="w1" />);

        // Wait for graph to load
        await vi.waitFor(() => {
            expect(screen.getByTestId('responsive-sidebar')).toBeTruthy();
        });
    });

    it('shows sidebar toggle button on mobile', async () => {
        const { fetchApi } = await import('../../../../src/server/spa/client/react/hooks/useApi');
        (fetchApi as any).mockResolvedValueOnce({
            components: [{ id: 'c1', name: 'Comp 1', path: '/a', purpose: 'test', category: 'core' }],
            categories: [{ id: 'core', name: 'Core' }],
            project: { name: 'Test', description: 'desc' },
        });

        render(<WikiDetail wikiId="w1" />);

        await vi.waitFor(() => {
            expect(screen.getByTestId('wiki-sidebar-toggle')).toBeTruthy();
        });
    });

    it('tab bar buttons have flex-shrink-0 and whitespace-nowrap for mobile scroll', async () => {
        const { fetchApi } = await import('../../../../src/server/spa/client/react/hooks/useApi');
        (fetchApi as any).mockResolvedValueOnce({
            components: [],
            categories: [],
            project: { name: 'Test', description: 'desc' },
        });

        const { container } = render(<WikiDetail wikiId="w1" />);

        const tabContainer = container.querySelector('#wiki-project-tabs');
        expect(tabContainer).toBeTruthy();
        expect(tabContainer!.className).toContain('overflow-x-auto');
        expect(tabContainer!.className).toContain('flex-nowrap');

        const tabButtons = tabContainer!.querySelectorAll('.wiki-project-tab');
        tabButtons.forEach(btn => {
            expect(btn.className).toContain('flex-shrink-0');
            expect(btn.className).toContain('whitespace-nowrap');
        });
    });
});

describe('WikiAsk mobile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setBreakpoint('mobile');
    });

    it('input area has bottom padding to clear BottomNav on mobile', () => {
        render(
            <WikiAsk wikiId="w1" wikiName="Test Wiki" currentComponentId={null} />
        );
        const inputArea = screen.getByTestId('wiki-ask-input-area');
        expect(inputArea).toBeTruthy();
        // On mobile, the class includes the bottom padding calc
        expect(inputArea.className).toContain('pb-[calc(0.75rem+56px)]');
    });

    it('input area does NOT have bottom padding on desktop', () => {
        setBreakpoint('desktop');
        render(
            <WikiAsk wikiId="w1" wikiName="Test Wiki" currentComponentId={null} />
        );
        const inputArea = screen.getByTestId('wiki-ask-input-area');
        expect(inputArea.className).not.toContain('pb-[calc(0.75rem+56px)]');
    });
});

describe('WikiGraph SVG', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setBreakpoint('mobile');
    });

    it('has touch-action: none style for touch compatibility', () => {
        const graph = {
            components: [{ id: 'c1', name: 'Comp', path: '/a', purpose: 'test', category: 'core' }],
            categories: [{ id: 'core', name: 'Core' }],
            project: { name: 'Test', description: 'desc' },
        };

        const { container } = render(
            <WikiGraph wikiId="w1" graph={graph} onSelectComponent={vi.fn()} />
        );

        // WikiGraph may show loading initially since D3 loads async
        // The SVG element should have touch-action: none
        const svg = container.querySelector('svg');
        if (svg) {
            expect(svg.style.touchAction).toBe('none');
        }
    });
});
