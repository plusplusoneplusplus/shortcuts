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

        it('exports highlightFuzzy function', () => {
            expect(source).toContain('export function highlightFuzzy');
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

        it('fetches the path list once per open', () => {
            expect(source).toContain('explorerApi.listFiles(workspaceId');
        });

        it('does not call the per-keystroke search endpoint', () => {
            // Matching happens in the browser; /search stays for other callers.
            expect(source).not.toContain('explorerApi.searchFiles(');
        });

        it('caps rendered results', () => {
            expect(source).toContain('RESULT_LIMIT = 50');
        });
    });

    describe('search and filtering', () => {
        it('manages query state', () => {
            expect(source).toContain("const [query, setQuery] = useState('')");
        });

        it('holds the fetched path list in state', () => {
            expect(source).toContain("const [allFiles, setAllFiles] = useState<string[]>([])");
        });

        it('derives results with the shared scorer', () => {
            expect(source).toContain("from '../../../../../../shared/fuzzy-file-score'");
            expect(source).toContain('rankFuzzyMatches(trimmed, allFiles, RESULT_LIMIT)');
        });

        it('memoizes results so matching reruns only on query or file-list change', () => {
            expect(source).toContain('useMemo(');
            expect(source).toContain('}, [query, allFiles]);');
        });

        it('shows an empty list when the query is empty', () => {
            expect(source).toContain('if (!trimmed) return [];');
        });
    });

    describe('no debounce, cancellable fetch', () => {
        it('has no debounce timer — matching is local and synchronous', () => {
            expect(source).not.toContain('debounceRef');
            expect(source).not.toContain(', 200)');
        });

        it('uses AbortController to cancel the in-flight list fetch', () => {
            expect(source).toContain('AbortController');
        });

        it('checks abort.signal.aborted before updating state', () => {
            expect(source).toContain('abort.signal.aborted');
        });

        it('aborts the fetch when the dialog closes', () => {
            expect(source).toContain('return () => abort.abort();');
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

        it('shows the loading state only before the first list arrives', () => {
            expect(source).toContain('Loading files');
            expect(source).toContain('loading && results.length === 0 && allFiles.length === 0');
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
            expect(source).toContain('fileName(filePath)');
        });

        it('shows directory path in subdued style', () => {
            expect(source).toContain('dirName(filePath)');
        });

        it('uses highlightFuzzy for match highlighting', () => {
            expect(source).toContain('highlightFuzzy(query, fileName(filePath))');
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
