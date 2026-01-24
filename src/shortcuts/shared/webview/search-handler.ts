/**
 * Shared search handler for webview editors
 * Provides Ctrl+F search functionality with match highlighting and navigation
 */

export interface SearchMatch {
    /** The text node containing the match */
    textNode: Text;
    /** Start offset within the text node */
    startOffset: number;
    /** End offset within the text node */
    endOffset: number;
    /** The wrapper element created for highlighting */
    highlightElement?: HTMLElement;
}

export interface SearchState {
    query: string;
    matches: SearchMatch[];
    currentIndex: number;
    caseSensitive: boolean;
    useRegex: boolean;
    isOpen: boolean;
}

export interface SearchElements {
    searchBar: HTMLElement;
    searchInput: HTMLInputElement;
    searchCount: HTMLElement;
    prevButton: HTMLElement;
    nextButton: HTMLElement;
    closeButton: HTMLElement;
    caseSensitiveButton: HTMLElement;
    regexButton: HTMLElement;
}

/**
 * Create initial search state
 */
export function createSearchState(): SearchState {
    return {
        query: '',
        matches: [],
        currentIndex: -1,
        caseSensitive: false,
        useRegex: false,
        isOpen: false
    };
}

/**
 * Generate search bar HTML
 */
export function getSearchBarHtml(): string {
    return `
    <div class="search-bar" id="searchBar" style="display: none;">
        <div class="search-bar-inner">
            <span class="search-icon">🔍</span>
            <input type="text" class="search-input" id="searchInput" placeholder="Find in document..." autocomplete="off" />
            <span class="search-count" id="searchCount"></span>
            <button class="search-btn" id="searchPrevBtn" title="Previous match (Shift+Enter)">
                <span class="search-btn-icon">◀</span>
            </button>
            <button class="search-btn" id="searchNextBtn" title="Next match (Enter)">
                <span class="search-btn-icon">▶</span>
            </button>
            <button class="search-btn search-toggle-btn" id="searchCaseSensitiveBtn" title="Match case (Alt+C)">
                <span class="search-btn-text">Aa</span>
            </button>
            <button class="search-btn search-toggle-btn" id="searchRegexBtn" title="Use regular expression (Alt+R)">
                <span class="search-btn-text">.*</span>
            </button>
            <button class="search-btn search-close-btn" id="searchCloseBtn" title="Close (Escape)">
                <span class="search-btn-icon">✕</span>
            </button>
        </div>
    </div>`;
}

/**
 * Initialize search elements from DOM
 */
export function initSearchElements(): SearchElements | null {
    const searchBar = document.getElementById('searchBar');
    const searchInput = document.getElementById('searchInput') as HTMLInputElement;
    const searchCount = document.getElementById('searchCount');
    const prevButton = document.getElementById('searchPrevBtn');
    const nextButton = document.getElementById('searchNextBtn');
    const closeButton = document.getElementById('searchCloseBtn');
    const caseSensitiveButton = document.getElementById('searchCaseSensitiveBtn');
    const regexButton = document.getElementById('searchRegexBtn');

    if (!searchBar || !searchInput || !searchCount || !prevButton || 
        !nextButton || !closeButton || !caseSensitiveButton || !regexButton) {
        return null;
    }

    return {
        searchBar,
        searchInput,
        searchCount,
        prevButton,
        nextButton,
        closeButton,
        caseSensitiveButton,
        regexButton
    };
}

/**
 * Open search bar
 * @param elements - Search UI elements
 * @param state - Search state
 * @param initialQuery - Optional initial query to populate the search box (e.g., selected text)
 * @param getContainer - Optional function to get the search container for immediate search execution
 */
export function openSearchBar(
    elements: SearchElements, 
    state: SearchState, 
    initialQuery?: string,
    getContainer?: () => HTMLElement | null
): void {
    elements.searchBar.style.display = 'flex';
    
    // If there's an initial query (e.g., selected text), populate the search box
    if (initialQuery && initialQuery.trim()) {
        elements.searchInput.value = initialQuery.trim();
        // Execute search immediately if we have a container getter
        if (getContainer) {
            executeSearch(elements, state, getContainer());
        }
    }
    
    elements.searchInput.focus();
    elements.searchInput.select();
    state.isOpen = true;
}

/**
 * Close search bar
 */
export function closeSearchBar(elements: SearchElements, state: SearchState): void {
    elements.searchBar.style.display = 'none';
    state.isOpen = false;
    clearHighlights(state);
    elements.searchInput.value = '';
    state.query = '';
    state.matches = [];
    state.currentIndex = -1;
    updateSearchCount(elements, state);
}

/**
 * Toggle case sensitivity
 */
export function toggleCaseSensitive(elements: SearchElements, state: SearchState): void {
    state.caseSensitive = !state.caseSensitive;
    elements.caseSensitiveButton.classList.toggle('active', state.caseSensitive);
    if (state.query) {
        executeSearch(elements, state, getSearchContainer());
    }
}

/**
 * Toggle regex mode
 */
export function toggleRegex(elements: SearchElements, state: SearchState): void {
    state.useRegex = !state.useRegex;
    elements.regexButton.classList.toggle('active', state.useRegex);
    if (state.query) {
        executeSearch(elements, state, getSearchContainer());
    }
}

/**
 * Get the container element to search within
 * This can be overridden for different editor types
 */
let searchContainerSelector = '.editor-wrapper';

export function setSearchContainerSelector(selector: string): void {
    searchContainerSelector = selector;
}

export function getSearchContainer(): HTMLElement | null {
    return document.querySelector(searchContainerSelector);
}

/**
 * Execute search and highlight matches
 */
export function executeSearch(
    elements: SearchElements, 
    state: SearchState, 
    container: HTMLElement | null
): void {
    // Clear previous highlights
    clearHighlights(state);
    
    state.query = elements.searchInput.value;
    state.matches = [];
    state.currentIndex = -1;

    if (!state.query || !container) {
        updateSearchCount(elements, state);
        return;
    }

    // Find all text matches
    const matches = findTextMatches(container, state.query, state.caseSensitive, state.useRegex);
    state.matches = matches;

    // Highlight all matches
    highlightMatches(state);

    // Navigate to first match if any
    if (state.matches.length > 0) {
        state.currentIndex = 0;
        scrollToCurrentMatch(state);
    }

    updateSearchCount(elements, state);
}

// Import the search skip selectors from the shared module (no DOM dependencies)
import { SEARCH_SKIP_SELECTORS } from '../search-skip-selectors';

// Re-export for convenience
export { SEARCH_SKIP_SELECTORS };

/**
 * Find all text matches in container
 */
export function findTextMatches(
    container: HTMLElement,
    query: string,
    caseSensitive: boolean,
    useRegex: boolean
): SearchMatch[] {
    const matches: SearchMatch[] = [];

    // Create regex for matching
    let regex: RegExp;
    try {
        if (useRegex) {
            regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
        } else {
            // Escape special regex characters for literal search
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
        }
    } catch {
        // Invalid regex, return empty matches
        return matches;
    }

    // Helper function to check if an element or any ancestor is hidden
    const isElementVisible = (element: Element | null): boolean => {
        while (element) {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
            element = element.parentElement;
        }
        return true;
    };

    // Helper function to check if element is inside display-only UI
    const isDisplayOnlyContent = (element: Element | null): boolean => {
        if (!element) return false;
        for (const selector of SEARCH_SKIP_SELECTORS) {
            if (element.closest(selector)) {
                return true;
            }
        }
        return false;
    };

    // Walk through all text nodes
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;

                // Skip display-only UI elements (line numbers, comments, etc.)
                if (isDisplayOnlyContent(parent)) {
                    return NodeFilter.FILTER_REJECT;
                }

                // Check if this element or any ancestor is hidden
                if (!isElementVisible(parent)) {
                    return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        const text = node.textContent || '';
        let match: RegExpExecArray | null;
        
        // Reset regex lastIndex for each node
        regex.lastIndex = 0;
        
        while ((match = regex.exec(text)) !== null) {
            matches.push({
                textNode: node,
                startOffset: match.index,
                endOffset: match.index + match[0].length
            });
            
            // Prevent infinite loop for zero-width matches
            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }
    }

    return matches;
}

/**
 * Highlight all matches
 */
export function highlightMatches(state: SearchState): void {
    // Process matches in reverse order to avoid offset issues
    const matchesByNode = new Map<Text, SearchMatch[]>();
    
    for (const match of state.matches) {
        const existing = matchesByNode.get(match.textNode) || [];
        existing.push(match);
        matchesByNode.set(match.textNode, existing);
    }

    for (const [textNode, nodeMatches] of matchesByNode) {
        // Sort by offset descending to process from end to start
        nodeMatches.sort((a, b) => b.startOffset - a.startOffset);
        
        for (const match of nodeMatches) {
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'search-highlight';
            
            // Split text node and wrap match
            const parent = textNode.parentNode;
            if (!parent) continue;

            const beforeText = textNode.textContent?.substring(0, match.startOffset) || '';
            const matchText = textNode.textContent?.substring(match.startOffset, match.endOffset) || '';
            const afterText = textNode.textContent?.substring(match.endOffset) || '';

            // Create new nodes
            const beforeNode = document.createTextNode(beforeText);
            highlightSpan.textContent = matchText;
            const afterNode = document.createTextNode(afterText);

            // Replace original node
            parent.insertBefore(beforeNode, textNode);
            parent.insertBefore(highlightSpan, textNode);
            parent.insertBefore(afterNode, textNode);
            parent.removeChild(textNode);

            // Update match reference
            match.highlightElement = highlightSpan;
            match.textNode = highlightSpan.firstChild as Text;
            match.startOffset = 0;
            match.endOffset = matchText.length;
        }
    }
}

/**
 * Clear all highlights
 */
export function clearHighlights(state: SearchState): void {
    // Remove all highlight spans
    const highlights = document.querySelectorAll('.search-highlight');
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        if (parent) {
            // Get the text content and replace the span with a text node
            const text = highlight.textContent || '';
            const textNode = document.createTextNode(text);
            parent.replaceChild(textNode, highlight);
            
            // Normalize to merge adjacent text nodes
            parent.normalize();
        }
    });

    state.matches = [];
    state.currentIndex = -1;
}

/**
 * Navigate to match by direction
 */
export function navigateToMatch(
    elements: SearchElements,
    state: SearchState, 
    direction: 'next' | 'prev'
): void {
    if (state.matches.length === 0) return;

    // Remove current highlight
    if (state.currentIndex >= 0 && state.currentIndex < state.matches.length) {
        const current = state.matches[state.currentIndex];
        current.highlightElement?.classList.remove('search-highlight-current');
    }

    // Calculate new index
    if (direction === 'next') {
        state.currentIndex = (state.currentIndex + 1) % state.matches.length;
    } else {
        state.currentIndex = state.currentIndex <= 0 
            ? state.matches.length - 1 
            : state.currentIndex - 1;
    }

    scrollToCurrentMatch(state);
    updateSearchCount(elements, state);
}

/**
 * Scroll to current match
 */
export function scrollToCurrentMatch(state: SearchState): void {
    if (state.currentIndex < 0 || state.currentIndex >= state.matches.length) return;

    const match = state.matches[state.currentIndex];
    if (match.highlightElement) {
        match.highlightElement.classList.add('search-highlight-current');
        match.highlightElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });
    }
}

/**
 * Update search count display
 */
export function updateSearchCount(elements: SearchElements, state: SearchState): void {
    if (state.matches.length === 0) {
        elements.searchCount.textContent = state.query ? 'No results' : '';
        elements.searchCount.classList.toggle('no-results', state.query.length > 0);
    } else {
        elements.searchCount.textContent = `${state.currentIndex + 1}/${state.matches.length}`;
        elements.searchCount.classList.remove('no-results');
    }
}

/**
 * Setup search keyboard shortcuts
 * Returns cleanup function
 */
export function setupSearchKeyboardShortcuts(
    elements: SearchElements,
    state: SearchState,
    getContainer: () => HTMLElement | null
): () => void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleKeydown = (e: KeyboardEvent) => {
        // Ctrl/Cmd + F to open search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // Capture selected text before opening search bar
            const selection = window.getSelection();
            const selectedText = selection && !selection.isCollapsed 
                ? selection.toString().trim() 
                : undefined;
            
            openSearchBar(elements, state, selectedText, getContainer);
            return;
        }

        // Only handle other shortcuts if search is open
        if (!state.isOpen) return;

        // Escape to close
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeSearchBar(elements, state);
            return;
        }

        // Enter for next, Shift+Enter for prev (only when input focused)
        if (e.key === 'Enter' && document.activeElement === elements.searchInput) {
            e.preventDefault();
            if (e.shiftKey) {
                navigateToMatch(elements, state, 'prev');
            } else {
                navigateToMatch(elements, state, 'next');
            }
            return;
        }

        // Alt+C for case sensitive toggle
        if (e.altKey && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            toggleCaseSensitive(elements, state);
            return;
        }

        // Alt+R for regex toggle
        if (e.altKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            toggleRegex(elements, state);
            return;
        }

        // F3 / Shift+F3 for next/prev
        if (e.key === 'F3') {
            e.preventDefault();
            navigateToMatch(elements, state, e.shiftKey ? 'prev' : 'next');
            return;
        }
    };

    const handleInput = () => {
        // Debounce search execution
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            executeSearch(elements, state, getContainer());
        }, 150);
    };

    // Click handlers
    const handlePrevClick = () => navigateToMatch(elements, state, 'prev');
    const handleNextClick = () => navigateToMatch(elements, state, 'next');
    const handleCloseClick = () => closeSearchBar(elements, state);
    const handleCaseSensitiveClick = () => toggleCaseSensitive(elements, state);
    const handleRegexClick = () => toggleRegex(elements, state);

    // Attach event listeners
    // Use capture phase to intercept before VSCode's default webview search handler
    document.addEventListener('keydown', handleKeydown, true);
    elements.searchInput.addEventListener('input', handleInput);
    elements.prevButton.addEventListener('click', handlePrevClick);
    elements.nextButton.addEventListener('click', handleNextClick);
    elements.closeButton.addEventListener('click', handleCloseClick);
    elements.caseSensitiveButton.addEventListener('click', handleCaseSensitiveClick);
    elements.regexButton.addEventListener('click', handleRegexClick);

    // Return cleanup function
    return () => {
        document.removeEventListener('keydown', handleKeydown, true);
        elements.searchInput.removeEventListener('input', handleInput);
        elements.prevButton.removeEventListener('click', handlePrevClick);
        elements.nextButton.removeEventListener('click', handleNextClick);
        elements.closeButton.removeEventListener('click', handleCloseClick);
        elements.caseSensitiveButton.removeEventListener('click', handleCaseSensitiveClick);
        elements.regexButton.removeEventListener('click', handleRegexClick);
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
    };
}

/**
 * Search controller interface returned by initSearch
 */
export interface SearchController {
    /** Cleanup function to remove event listeners */
    cleanup: () => void;
    /** Refresh search results (call when content or view changes) */
    refresh: () => void;
    /** Check if search is currently open */
    isOpen: () => boolean;
}

/**
 * Initialize search functionality
 * Returns a SearchController or null if initialization failed
 */
export function initSearch(containerSelector: string): SearchController | null {
    setSearchContainerSelector(containerSelector);
    
    const elements = initSearchElements();
    if (!elements) {
        console.warn('[Search] Could not initialize search elements');
        return null;
    }

    const state = createSearchState();
    const cleanup = setupSearchKeyboardShortcuts(elements, state, getSearchContainer);

    // Refresh function to re-execute search (e.g., when view mode changes)
    const refresh = () => {
        if (state.isOpen && state.query) {
            // Clear existing highlights and re-search
            clearHighlights(state);
            executeSearch(elements, state, getSearchContainer());
        }
    };

    return {
        cleanup,
        refresh,
        isOpen: () => state.isOpen
    };
}
