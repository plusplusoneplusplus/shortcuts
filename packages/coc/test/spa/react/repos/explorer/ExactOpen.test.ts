/**
 * Tests for ExactOpen component — Ctrl+O exact filename matcher.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const EXACT_OPEN_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'ExactOpen.tsx'
);

describe('ExactOpen component', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(EXACT_OPEN_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports ExactOpen component', () => {
            expect(source).toContain('export function ExactOpen');
        });

        it('exports exactMatchScore function', () => {
            expect(source).toContain('export function exactMatchScore');
        });

        it('exports ExactOpenProps interface', () => {
            expect(source).toContain('export interface ExactOpenProps');
        });

        it('exports fileName helper', () => {
            expect(source).toContain('export function fileName');
        });
    });

    describe('props', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts open prop', () => {
            expect(source).toContain('open: boolean');
        });

        it('accepts onClose callback', () => {
            expect(source).toContain('onClose: () => void');
        });

        it('accepts onFileSelect callback', () => {
            expect(source).toContain('onFileSelect: (filePath: string) => void');
        });
    });

    describe('file fetching', () => {
        it('does not fetch /files endpoint on open', () => {
            expect(source).not.toMatch(/fetchApi\([^)]*\/files[^)]*\)/);
        });

        it('uses fetchApi for data loading', () => {
            expect(source).toContain("import { fetchApi } from '../../hooks/useApi'");
        });

        it('manages loading state', () => {
            expect(source).toContain('loading');
            expect(source).toContain('setLoading');
        });

        it('calls server-side search endpoint with query and limit', () => {
            expect(source).toContain('/search?q=');
            expect(source).toContain('limit=50');
        });
    });

    describe('search and filtering', () => {
        it('manages query state', () => {
            expect(source).toContain("const [query, setQuery] = useState('')");
        });

        it('manages results state (server-populated)', () => {
            expect(source).toContain("useState<string[]>([])");
        });

        it('does not use exactMatchScore for in-component filtering', () => {
            expect(source).not.toContain('exactMatchScore(query, f)');
        });

        it('maps server response paths from results array', () => {
            expect(source).toContain('data.results.map(r => r.path)');
        });

        it('shows empty list when query is empty (no fetch)', () => {
            expect(source).toContain('!query.trim()');
            expect(source).toContain("setResults([])");
        });
    });

    describe('debounce and cancellation', () => {
        it('uses setTimeout for debounce', () => {
            expect(source).toContain('setTimeout(');
        });

        it('uses clearTimeout to cancel pending debounce', () => {
            expect(source).toContain('clearTimeout(');
        });

        it('uses debounceRef to hold the timeout handle', () => {
            expect(source).toContain('debounceRef');
        });

        it('uses AbortController to cancel in-flight requests', () => {
            expect(source).toContain('AbortController');
        });

        it('checks abort.signal.aborted before updating state', () => {
            expect(source).toContain('abort.signal.aborted');
        });

        it('debounce delay is 200ms', () => {
            expect(source).toContain(', 200)');
        });
    });

    describe('keyboard navigation', () => {
        it('handles ArrowDown to move highlight', () => {
            expect(source).toContain("e.key === 'ArrowDown'");
        });

        it('handles ArrowUp to move highlight', () => {
            expect(source).toContain("e.key === 'ArrowUp'");
        });

        it('handles Enter to select', () => {
            expect(source).toContain("e.key === 'Enter'");
        });

        it('handles Escape to close', () => {
            expect(source).toContain("e.key === 'Escape'");
            expect(source).toContain('onClose()');
        });

        it('scrolls highlighted item into view', () => {
            expect(source).toContain("scrollIntoView({ block: 'nearest' })");
        });
    });

    describe('rendering', () => {
        it('uses portal rendering to document.body', () => {
            expect(source).toContain('ReactDOM.createPortal');
            expect(source).toContain('document.body');
        });

        it('returns null when not open', () => {
            expect(source).toContain('if (!open) return null');
        });

        it('renders search input', () => {
            expect(source).toContain('data-testid="exact-open-input"');
        });

        it('renders results list', () => {
            expect(source).toContain('data-testid="exact-open-results"');
        });

        it('shows no exact match message', () => {
            expect(source).toContain('No exact match');
            expect(source).toContain('data-testid="exact-open-no-results"');
        });

        it('shows loading state', () => {
            expect(source).toContain('Loading files');
        });

        it('shows result count in footer', () => {
            expect(source).toContain('results.length');
        });

        it('shows keyboard hints in footer', () => {
            expect(source).toContain('navigate');
            expect(source).toContain('open');
            expect(source).toContain('esc close');
        });

        it('highlights active item', () => {
            expect(source).toContain('idx === highlightIndex');
        });

        it('closes when clicking overlay', () => {
            expect(source).toContain('onClick={onClose}');
        });

        it('stops propagation on dialog click', () => {
            expect(source).toContain('e.stopPropagation()');
        });

        it('shows "Open File (Exact Match)" label', () => {
            expect(source).toContain('Open File (Exact Match)');
        });

        it('shows exact badge when exact match found', () => {
            expect(source).toContain('exact-open-exact-badge');
        });
    });

    describe('auto-focus', () => {
        it('focuses input when opened', () => {
            expect(source).toContain('inputRef.current?.focus()');
        });

        it('resets query when opened', () => {
            expect(source).toContain("setQuery('')");
        });

        it('resets highlight index when opened', () => {
            expect(source).toContain('setHighlightIndex(0)');
        });
    });
});

describe('exactMatchScore algorithm', () => {
    let exactMatchScore: (query: string, filePath: string) => 0 | 1 | 2;
    let fileNameFn: (p: string) => string;

    beforeAll(async () => {
        const mod = await import(EXACT_OPEN_PATH.replace(/\.tsx$/, ''));
        exactMatchScore = mod.exactMatchScore;
        fileNameFn = mod.fileName;
    });

    describe('fileName helper', () => {
        it('returns filename from path', () => {
            expect(fileNameFn('src/index.ts')).toBe('index.ts');
        });

        it('returns full string when no slash', () => {
            expect(fileNameFn('index.ts')).toBe('index.ts');
        });

        it('handles nested paths', () => {
            expect(fileNameFn('a/b/c/file.ts')).toBe('file.ts');
        });
    });

    describe('exact match (score 2)', () => {
        it('returns 2 for exact basename match', () => {
            expect(exactMatchScore('index.ts', 'src/index.ts')).toBe(2);
        });

        it('is case-insensitive for exact match', () => {
            expect(exactMatchScore('Index.TS', 'src/index.ts')).toBe(2);
        });

        it('returns 2 for file at root', () => {
            expect(exactMatchScore('index.ts', 'index.ts')).toBe(2);
        });
    });

    describe('prefix match (score 1)', () => {
        it('returns 1 for prefix match', () => {
            expect(exactMatchScore('ind', 'src/index.ts')).toBe(1);
        });

        it('returns 1 for case-insensitive prefix', () => {
            expect(exactMatchScore('IND', 'src/index.ts')).toBe(1);
        });

        it('returns 1 for empty query (show all)', () => {
            expect(exactMatchScore('', 'src/index.ts')).toBe(1);
        });
    });

    describe('no match (score 0)', () => {
        it('returns 0 when basename does not start with query', () => {
            expect(exactMatchScore('xyz', 'src/index.ts')).toBe(0);
        });

        it('returns 0 when query matches directory but not basename', () => {
            expect(exactMatchScore('src', 'src/index.ts')).toBe(0);
        });

        it('returns 0 when query is longer than basename', () => {
            expect(exactMatchScore('index.ts.extra', 'src/index.ts')).toBe(0);
        });
    });

    describe('ranking', () => {
        it('exact match scores higher than prefix match', () => {
            const exact = exactMatchScore('index.ts', 'src/index.ts');
            const prefix = exactMatchScore('index', 'src/index.ts');
            expect(exact).toBeGreaterThan(prefix);
        });

        it('prefix match scores higher than no match', () => {
            const prefix = exactMatchScore('ind', 'src/index.ts');
            const none = exactMatchScore('xyz', 'src/index.ts');
            expect(prefix).toBeGreaterThan(none);
        });
    });
});
