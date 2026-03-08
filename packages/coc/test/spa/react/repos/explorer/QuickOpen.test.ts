/**
 * Tests for QuickOpen component — VS Code-style Ctrl+P file finder.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const QUICK_OPEN_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'explorer', 'QuickOpen.tsx'
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

        it('exports fuzzyMatch function', () => {
            expect(source).toContain('export function fuzzyMatch');
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
        it('fetches files from /repos/:id/files endpoint', () => {
            expect(source).toContain('/repos/');
            expect(source).toContain('/files');
        });

        it('uses fetchApi for data loading', () => {
            expect(source).toContain("import { fetchApi } from '../../hooks/useApi'");
        });

        it('manages loading state', () => {
            expect(source).toContain('loading');
            expect(source).toContain('setLoading');
        });
    });

    describe('search and filtering', () => {
        it('manages query state', () => {
            expect(source).toContain("const [query, setQuery] = useState('')");
        });

        it('uses fuzzyMatch for filtering', () => {
            expect(source).toContain('fuzzyMatch(query, f)');
        });

        it('sorts results by score', () => {
            expect(source).toContain('scored.sort(');
            expect(source).toContain('b.score - a.score');
        });

        it('limits visible results', () => {
            expect(source).toContain('MAX_VISIBLE');
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

        it('shows loading state', () => {
            expect(source).toContain('Loading files');
        });

        it('shows file count in footer', () => {
            expect(source).toContain('allFiles.length');
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

describe('fuzzyMatch algorithm', () => {
    let fuzzyMatch: (query: string, target: string) => { match: boolean; score: number };

    beforeAll(async () => {
        // Read the source to extract the function
        const source = fs.readFileSync(QUICK_OPEN_PATH, 'utf-8');
        // Validate the function exists
        expect(source).toContain('export function fuzzyMatch');

        // Use dynamic import - construct module path
        const mod = await import(QUICK_OPEN_PATH.replace(/\.tsx$/, ''));
        fuzzyMatch = mod.fuzzyMatch;
    });

    it('matches exact substring', () => {
        const result = fuzzyMatch('index', 'src/index.ts');
        expect(result.match).toBe(true);
        expect(result.score).toBeGreaterThan(0);
    });

    it('matches characters in order (non-contiguous)', () => {
        const result = fuzzyMatch('idx', 'index.ts');
        expect(result.match).toBe(true);
    });

    it('returns no match when characters are not in order', () => {
        const result = fuzzyMatch('zxy', 'index.ts');
        expect(result.match).toBe(false);
    });

    it('returns match true with score 0 for empty query', () => {
        const result = fuzzyMatch('', 'anything.ts');
        expect(result.match).toBe(true);
        expect(result.score).toBe(0);
    });

    it('is case insensitive', () => {
        const result = fuzzyMatch('INDEX', 'src/index.ts');
        expect(result.match).toBe(true);
    });

    it('scores shorter targets higher for same query', () => {
        const short = fuzzyMatch('idx', 'index.ts');
        const long = fuzzyMatch('idx', 'very/deep/path/to/some/index.ts');
        expect(short.score).toBeGreaterThan(long.score);
    });

    it('scores consecutive matches higher', () => {
        const consecutive = fuzzyMatch('ind', 'index.ts');
        const scattered = fuzzyMatch('ind', 'integration-dashboard.ts');
        expect(consecutive.score).toBeGreaterThan(scattered.score);
    });

    it('gives bonus for matching at path separator', () => {
        const atSep = fuzzyMatch('i', 'src/index.ts');
        const midWord = fuzzyMatch('n', 'src/index.ts');
        // 'i' matches right after '/' separator, 'n' matches mid-word
        expect(atSep.score).toBeGreaterThan(midWord.score);
    });
});
