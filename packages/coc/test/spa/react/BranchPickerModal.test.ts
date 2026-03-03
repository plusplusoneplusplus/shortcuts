/**
 * Tests for BranchPickerModal component source structure.
 *
 * Validates rendering, search debounce, pagination, switch flow,
 * error handling, keyboard navigation, and data-testid attributes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'BranchPickerModal.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('BranchPickerModal', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { BranchPickerModal }");
            expect(indexSource).toContain("from './BranchPickerModal'");
        });

        it('exports BranchPickerModal as a named export', () => {
            expect(source).toContain('export function BranchPickerModal');
        });
    });

    describe('component signature', () => {
        it('defines BranchPickerModalProps interface', () => {
            expect(source).toContain('interface BranchPickerModalProps');
        });

        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });

        it('accepts currentBranch prop', () => {
            expect(source).toContain('currentBranch: string');
        });

        it('accepts isOpen prop', () => {
            expect(source).toContain('isOpen: boolean');
        });

        it('accepts onClose prop', () => {
            expect(source).toContain('onClose: () => void');
        });

        it('accepts onSwitched prop', () => {
            expect(source).toContain('onSwitched: (newBranch: string) => void');
        });
    });

    describe('rendering', () => {
        it('returns null when not open', () => {
            expect(source).toContain('if (!isOpen) return null');
        });

        it('has modal overlay data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-overlay"');
        });

        it('has modal dialog data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-modal"');
        });

        it('has role=dialog on dialog element', () => {
            expect(source).toContain('role="dialog"');
        });

        it('has search input data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-search"');
        });

        it('has close button data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-close"');
        });

        it('has branch list data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-list"');
        });

        it('has branch list role=listbox', () => {
            expect(source).toContain('role="listbox"');
        });

        it('has loading state data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-loading"');
        });

        it('has empty state data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-empty"');
        });

        it('has error state data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-error"');
        });

        it('has load more button data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-load-more"');
        });

        it('has switching state data-testid', () => {
            expect(source).toContain('data-testid="branch-picker-switching"');
        });

        it('has current branch badge data-testid', () => {
            expect(source).toContain('data-testid="branch-current-badge"');
        });

        it('closes on backdrop click', () => {
            expect(source).toContain('e.target === e.currentTarget');
            expect(source).toContain('onClose()');
        });
    });

    describe('search debounce', () => {
        it('uses 300ms debounce for search', () => {
            expect(source).toContain('300');
            expect(source).toContain('debounceRef');
        });

        it('tracks query state', () => {
            expect(source).toContain('const [query, setQuery]');
        });

        it('resets offset on new search', () => {
            expect(source).toContain('setOffset(0)');
        });

        it('uses useEffect for debounced search', () => {
            expect(source).toContain('useEffect');
            expect(source).toContain('debounceRef.current = setTimeout');
        });

        it('clears debounce timer on cleanup', () => {
            expect(source).toContain('clearTimeout');
        });
    });

    describe('pagination', () => {
        it('defines PAGE_SIZE constant', () => {
            expect(source).toContain('PAGE_SIZE');
        });

        it('uses limit=50 per page', () => {
            expect(source).toContain('50');
            expect(source).toContain('PAGE_SIZE');
        });

        it('tracks hasMore state', () => {
            expect(source).toContain('const [hasMore, setHasMore]');
        });

        it('tracks offset state', () => {
            expect(source).toContain('const [offset, setOffset]');
        });

        it('shows load more button when hasMore is true', () => {
            expect(source).toContain('hasMore && !isLoading');
        });

        it('handleLoadMore appends next page', () => {
            expect(source).toContain('handleLoadMore');
            expect(source).toContain('append');
        });

        it('tracks isLoadingMore state for load more button', () => {
            expect(source).toContain('isLoadingMore');
            expect(source).toContain('setIsLoadingMore');
        });

        it('fetches from /git/branches endpoint', () => {
            expect(source).toContain('/git/branches');
        });

        it('uses type=local query parameter', () => {
            expect(source).toContain("'local'");
            expect(source).toContain('type');
        });
    });

    describe('switch flow', () => {
        it('calls /git/branches/switch endpoint with POST', () => {
            expect(source).toContain('/git/branches/switch');
            expect(source).toContain("method: 'POST'");
        });

        it('sends branch name in request body', () => {
            expect(source).toContain("name: branchName");
        });

        it('sends force: false by default', () => {
            expect(source).toContain('force: false');
        });

        it('calls onSwitched on success', () => {
            expect(source).toContain('onSwitched(branchName)');
        });

        it('calls onClose after successful switch', () => {
            expect(source).toContain('onClose()');
        });

        it('checks result.success === false for error', () => {
            expect(source).toContain('result.success === false');
        });

        it('shows error message on switch failure', () => {
            expect(source).toContain('setError');
            expect(source).toContain("'Failed to switch branch'");
        });

        it('tracks isSwitching state', () => {
            expect(source).toContain('const [isSwitching, setIsSwitching]');
        });

        it('guards against switching to current branch', () => {
            expect(source).toContain('branchName === currentBranch');
        });

        it('sends Content-Type header', () => {
            expect(source).toContain("'Content-Type': 'application/json'");
        });
    });

    describe('current branch indicator', () => {
        it('highlights current branch with check mark', () => {
            expect(source).toContain("isCurrent ? '✓' : ''");
        });

        it('shows current badge label', () => {
            expect(source).toContain('current');
            expect(source).toContain('isCurrent');
        });

        it('uses green color for current branch', () => {
            expect(source).toContain('text-[#16825d]');
        });
    });

    describe('keyboard navigation', () => {
        it('handles Escape key to close', () => {
            expect(source).toContain("e.key === 'Escape'");
        });

        it('handles ArrowDown to move focus down', () => {
            expect(source).toContain("e.key === 'ArrowDown'");
        });

        it('handles ArrowUp to move focus up', () => {
            expect(source).toContain("e.key === 'ArrowUp'");
        });

        it('handles Enter key to select branch', () => {
            expect(source).toContain("e.key === 'Enter'");
        });

        it('tracks focusedIndex state for keyboard navigation', () => {
            expect(source).toContain('focusedIndex');
            expect(source).toContain('setFocusedIndex');
        });

        it('attaches onKeyDown handler to dialog', () => {
            expect(source).toContain('onKeyDown={handleKeyDown}');
        });

        it('scrolls focused item into view', () => {
            expect(source).toContain("scrollIntoView");
        });

        it('focuses search input on open', () => {
            expect(source).toContain('searchInputRef.current?.focus()');
        });
    });

    describe('API integration', () => {
        it('imports fetchApi from hooks', () => {
            expect(source).toContain("import { fetchApi } from '../hooks/useApi'");
        });

        it('uses encodeURIComponent for workspaceId', () => {
            expect(source).toContain('encodeURIComponent(workspaceId)');
        });

        it('tracks isLoading state', () => {
            expect(source).toContain('const [isLoading, setIsLoading]');
        });

        it('tracks error state', () => {
            expect(source).toContain('const [error, setError]');
        });

        it('resets state on open', () => {
            expect(source).toContain('setBranches([])');
            expect(source).toContain('setQuery(\'\')');
        });
    });
});
