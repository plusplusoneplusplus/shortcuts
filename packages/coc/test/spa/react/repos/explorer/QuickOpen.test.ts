/**
 * Tests for QuickOpen component — command-palette-style file finder.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const QUICK_OPEN_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'explorer', 'QuickOpen.tsx'
);

describe('QuickOpen component', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(QUICK_OPEN_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports QuickOpen component', () => {
            expect(source).toContain('export function QuickOpen');
        });

        it('does not redefine a local fuzzy scorer', () => {
            // Scoring is shared with the server via shared/fuzzy-file-score.
            expect(source).not.toContain('export function fuzzyMatch');
        });

        it('exports the index-driven highlight helpers', () => {
            expect(source).toContain('export function highlightMatches');
            expect(source).toContain('export function splitIndices');
        });

        it('exports QuickOpenProps interface', () => {
            expect(source).toContain('export interface QuickOpenProps');
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
        it('uses explorerApi for data loading', () => {
            expect(source).toContain("import { explorerApi } from './explorerApi'");
        });

        it('manages loading state', () => {
            expect(source).toContain('loading');
            expect(source).toContain('setLoading');
        });

        it('does not fetch the whole path list', () => {
            // Multi-megabyte payloads on every open are the bottleneck this
            // dialog exists to avoid.
            expect(source).not.toContain('explorerApi.listFiles(');
        });

        it('searches on the server per keystroke', () => {
            expect(source).toContain('explorerApi.searchFiles(workspaceId, trimmed');
        });

        it('legacy: kept for the removed local-matching mode', () => {
            // Matching happens in the browser; /search stays for other callers.
            expect(source).toContain('explorerApi.searchFiles(');
        });

        it('caps rendered results', () => {
            expect(source).toContain('RESULT_LIMIT = 50');
        });
    });

    describe('search and filtering', () => {
        it('manages query state', () => {
            expect(source).toContain("const [query, setQuery] = useState('')");
        });

        it('holds the server results in state', () => {
            expect(source).toContain('const [results, setResults] = useState<ExplorerSearchResult[]>([])');
        });

        it('renders the server ranking as-is', () => {
            // No client-side re-ranking: the server already applied the shared
            // scorer, so re-scoring here could only disagree with it.
            expect(source).not.toContain('rankFuzzyMatches');
            expect(source).toContain('setResults(data.results);');
        });

        it('re-searches when the query or workspace changes', () => {
            expect(source).toContain('}, [query, open, workspaceId]);');
        });

        it('shows an empty list, and issues no request, when the query is empty', () => {
            expect(source).toContain('if (!trimmed) {');
            expect(source).toContain('setResults([]);');
        });
    });

    describe('debounced, cancellable search', () => {
        it('debounces keystrokes before hitting the server', () => {
            expect(source).toContain('debounceRef');
            expect(source).toContain('SEARCH_DEBOUNCE_MS');
        });

        it('uses AbortController to cancel the in-flight search', () => {
            expect(source).toContain('AbortController');
            expect(source).toContain('abortRef.current?.abort();');
        });

        it('checks abort.signal.aborted before updating state', () => {
            expect(source).toContain('abort.signal.aborted');
        });

        it('clears the pending timer on cleanup', () => {
            expect(source).toContain('if (debounceRef.current) clearTimeout(debounceRef.current);');
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

        it('renders overlay with correct z-index', () => {
            expect(source).toContain('z-[10002]');
        });

        it('renders search input', () => {
            expect(source).toContain('data-testid="quick-open-input"');
        });

        it('renders results list', () => {
            expect(source).toContain('data-testid="quick-open-results"');
        });

        it('shows no-results message', () => {
            expect(source).toContain('No matching files');
            expect(source).toContain('data-testid="quick-open-no-results"');
        });

        it('shows the loading state only before the first results arrive', () => {
            expect(source).toContain('Searching files');
            expect(source).toContain('loading && results.length === 0');
        });

        it('shows result count in footer', () => {
            expect(source).toContain('results.length');
        });

        it('shows keyboard hints in footer', () => {
            expect(source).toContain('navigate');
            expect(source).toContain('open');
            expect(source).toContain('esc close');
        });

        it('highlights highlighted item differently', () => {
            expect(source).toContain('idx === highlightIndex');
        });

        it('closes when clicking overlay', () => {
            expect(source).toContain('onClick={onClose}');
        });

        it('stops propagation on dialog click', () => {
            expect(source).toContain('e.stopPropagation()');
        });
    });

    describe('result display', () => {
        it('shows file name prominently', () => {
            expect(source).toContain('fileName(result.path)');
        });

        it('shows directory path in subdued style', () => {
            expect(source).toContain('dirName(result.path)');
        });

        it('highlights the positions the server scored, in both segments', () => {
            expect(source).toContain('splitIndices(result.path, result.indices');
            expect(source).toContain('highlightMatches(fileName(result.path), matched.name)');
            expect(source).toContain('highlightMatches(dirName(result.path), matched.dir)');
        });

        it('has file icon for each result', () => {
            expect(source).toContain('📄');
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

// The scoring algorithm itself is covered in test/server/fuzzy-file-score.test.ts,
// which exercises the module shared by this dialog and the /search endpoint.
