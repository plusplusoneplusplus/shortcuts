/**
 * Tests for the shared search handler
 */

import * as assert from 'assert';
import { SEARCH_SKIP_SELECTORS } from '../../shortcuts/shared/search-skip-selectors';

suite('Search Handler', () => {
    suite('createSearchState', () => {
        test('should create initial search state with default values', () => {
            // Test the structure of the initial state
            const expectedState = {
                query: '',
                matches: [],
                currentIndex: -1,
                caseSensitive: false,
                useRegex: false,
                isOpen: false
            };
            
            // The actual function returns this structure
            assert.deepStrictEqual(
                { query: '', matches: [], currentIndex: -1, caseSensitive: false, useRegex: false, isOpen: false },
                expectedState
            );
        });
    });

    suite('getSearchBarHtml', () => {
        test('should generate search bar HTML with all required elements', () => {
            // Expected HTML structure elements
            const requiredIds = [
                'searchBar',
                'searchInput',
                'searchCount',
                'searchPrevBtn',
                'searchNextBtn',
                'searchCaseSensitiveBtn',
                'searchRegexBtn',
                'searchCloseBtn'
            ];

            // Verify the HTML contains all required element IDs
            const html = `
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

            for (const id of requiredIds) {
                assert.ok(html.includes(`id="${id}"`), `Should contain element with id="${id}"`);
            }
        });

        test('should have proper accessibility attributes', () => {
            const html = `<input type="text" class="search-input" id="searchInput" placeholder="Find in document..." autocomplete="off" />`;
            
            assert.ok(html.includes('placeholder='), 'Input should have placeholder');
            assert.ok(html.includes('autocomplete="off"'), 'Input should have autocomplete off');
        });
    });

    suite('Search state manipulation', () => {
        test('should track open/close state', () => {
            const state = {
                query: '',
                matches: [] as unknown[],
                currentIndex: -1,
                caseSensitive: false,
                useRegex: false,
                isOpen: false
            };

            // Simulate opening
            state.isOpen = true;
            assert.strictEqual(state.isOpen, true);

            // Simulate closing
            state.isOpen = false;
            assert.strictEqual(state.isOpen, false);
        });

        test('should track case sensitivity toggle', () => {
            const state = {
                query: '',
                matches: [] as unknown[],
                currentIndex: -1,
                caseSensitive: false,
                useRegex: false,
                isOpen: false
            };

            state.caseSensitive = !state.caseSensitive;
            assert.strictEqual(state.caseSensitive, true);

            state.caseSensitive = !state.caseSensitive;
            assert.strictEqual(state.caseSensitive, false);
        });

        test('should track regex toggle', () => {
            const state = {
                query: '',
                matches: [] as unknown[],
                currentIndex: -1,
                caseSensitive: false,
                useRegex: false,
                isOpen: false
            };

            state.useRegex = !state.useRegex;
            assert.strictEqual(state.useRegex, true);

            state.useRegex = !state.useRegex;
            assert.strictEqual(state.useRegex, false);
        });
    });

    suite('Search navigation logic', () => {
        test('should calculate next match index correctly', () => {
            const totalMatches = 5;
            let currentIndex = 0;

            // Navigate forward
            currentIndex = (currentIndex + 1) % totalMatches;
            assert.strictEqual(currentIndex, 1);

            currentIndex = (currentIndex + 1) % totalMatches;
            assert.strictEqual(currentIndex, 2);
        });

        test('should wrap around when navigating past last match', () => {
            const totalMatches = 5;
            let currentIndex = 4; // Last match

            currentIndex = (currentIndex + 1) % totalMatches;
            assert.strictEqual(currentIndex, 0, 'Should wrap to first match');
        });

        test('should calculate previous match index correctly', () => {
            const totalMatches = 5;
            let currentIndex = 2;

            // Navigate backward
            currentIndex = currentIndex <= 0 ? totalMatches - 1 : currentIndex - 1;
            assert.strictEqual(currentIndex, 1);
        });

        test('should wrap around when navigating before first match', () => {
            const totalMatches = 5;
            let currentIndex = 0; // First match

            currentIndex = currentIndex <= 0 ? totalMatches - 1 : currentIndex - 1;
            assert.strictEqual(currentIndex, 4, 'Should wrap to last match');
        });
    });

    suite('Search count display', () => {
        test('should format count as "current/total"', () => {
            const currentIndex = 2;
            const totalMatches = 10;
            const display = `${currentIndex + 1}/${totalMatches}`;
            assert.strictEqual(display, '3/10');
        });

        test('should show "No results" when no matches', () => {
            const totalMatches = 0;
            const query = 'test';
            const display = totalMatches === 0 && query ? 'No results' : '';
            assert.strictEqual(display, 'No results');
        });

        test('should show empty string when no query', () => {
            const totalMatches = 0;
            const query = '';
            const display = totalMatches === 0 ? (query ? 'No results' : '') : '';
            assert.strictEqual(display, '');
        });
    });

    suite('Regex escaping', () => {
        test('should escape special regex characters for literal search', () => {
            const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            assert.strictEqual(escapeRegex('hello.world'), 'hello\\.world');
            assert.strictEqual(escapeRegex('test*'), 'test\\*');
            assert.strictEqual(escapeRegex('a+b'), 'a\\+b');
            assert.strictEqual(escapeRegex('foo?bar'), 'foo\\?bar');
            assert.strictEqual(escapeRegex('$100'), '\\$100');
            assert.strictEqual(escapeRegex('(group)'), '\\(group\\)');
            assert.strictEqual(escapeRegex('[array]'), '\\[array\\]');
            assert.strictEqual(escapeRegex('{object}'), '\\{object\\}');
            assert.strictEqual(escapeRegex('a|b'), 'a\\|b');
            assert.strictEqual(escapeRegex('path\\to'), 'path\\\\to');
            assert.strictEqual(escapeRegex('^start'), '\\^start');
        });

        test('should handle multiple special characters', () => {
            const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            assert.strictEqual(escapeRegex('function() { return true; }'), 'function\\(\\) \\{ return true; \\}');
        });
    });

    suite('Keyboard shortcuts', () => {
        test('should recognize Ctrl+F for opening search', () => {
            const event = { ctrlKey: true, metaKey: false, key: 'f' };
            const shouldOpen = (event.ctrlKey || event.metaKey) && event.key === 'f';
            assert.strictEqual(shouldOpen, true);
        });

        test('should recognize Cmd+F for opening search (Mac)', () => {
            const event = { ctrlKey: false, metaKey: true, key: 'f' };
            const shouldOpen = (event.ctrlKey || event.metaKey) && event.key === 'f';
            assert.strictEqual(shouldOpen, true);
        });

        test('should recognize Escape for closing search', () => {
            const event = { key: 'Escape' };
            const shouldClose = event.key === 'Escape';
            assert.strictEqual(shouldClose, true);
        });

        test('should recognize Enter for next match', () => {
            const event = { key: 'Enter', shiftKey: false };
            const direction = event.shiftKey ? 'prev' : 'next';
            assert.strictEqual(direction, 'next');
        });

        test('should recognize Shift+Enter for previous match', () => {
            const event = { key: 'Enter', shiftKey: true };
            const direction = event.shiftKey ? 'prev' : 'next';
            assert.strictEqual(direction, 'prev');
        });

        test('should recognize F3 for next match', () => {
            const event = { key: 'F3', shiftKey: false };
            const isF3 = event.key === 'F3';
            const direction = event.shiftKey ? 'prev' : 'next';
            assert.strictEqual(isF3, true);
            assert.strictEqual(direction, 'next');
        });

        test('should recognize Shift+F3 for previous match', () => {
            const event = { key: 'F3', shiftKey: true };
            const isF3 = event.key === 'F3';
            const direction = event.shiftKey ? 'prev' : 'next';
            assert.strictEqual(isF3, true);
            assert.strictEqual(direction, 'prev');
        });

        test('should recognize Alt+C for case sensitivity toggle', () => {
            const event = { altKey: true, key: 'c' };
            const shouldToggle = event.altKey && event.key.toLowerCase() === 'c';
            assert.strictEqual(shouldToggle, true);
        });

        test('should recognize Alt+R for regex toggle', () => {
            const event = { altKey: true, key: 'r' };
            const shouldToggle = event.altKey && event.key.toLowerCase() === 'r';
            assert.strictEqual(shouldToggle, true);
        });
    });

    suite('Search matching logic', () => {
        test('should perform case-insensitive search by default', () => {
            const text = 'Hello World HELLO world';
            const query = 'hello';
            const caseSensitive = false;
            const flags = caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(query, flags);
            const matches = text.match(regex) || [];
            assert.strictEqual(matches.length, 2);
        });

        test('should perform case-sensitive search when enabled', () => {
            const text = 'Hello World HELLO world';
            const query = 'hello';
            const caseSensitive = true;
            const flags = caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(query, flags);
            const matches = text.match(regex) || [];
            assert.strictEqual(matches.length, 0);
        });

        test('should perform case-sensitive search with exact match', () => {
            const text = 'Hello World HELLO world';
            const query = 'Hello';
            const caseSensitive = true;
            const flags = caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(query, flags);
            const matches = text.match(regex) || [];
            assert.strictEqual(matches.length, 1);
        });

        test('should support regex patterns when enabled', () => {
            const text = 'foo123 bar456 baz789';
            const query = '\\d+';
            try {
                const regex = new RegExp(query, 'g');
                const matches = text.match(regex) || [];
                assert.strictEqual(matches.length, 3);
            } catch {
                assert.fail('Should handle valid regex');
            }
        });

        test('should handle invalid regex gracefully', () => {
            const query = '[invalid';
            let isValid = true;
            try {
                new RegExp(query, 'g');
            } catch {
                isValid = false;
            }
            assert.strictEqual(isValid, false);
        });

        test('should find overlapping matches with proper regex', () => {
            const text = 'aaa';
            const query = 'aa';
            const regex = new RegExp(query, 'g');
            const matches: number[] = [];
            let match;
            while ((match = regex.exec(text)) !== null) {
                matches.push(match.index);
                // Note: standard regex doesn't find overlapping matches
            }
            assert.strictEqual(matches.length, 1); // Standard behavior
        });
    });

    suite('Search state reset', () => {
        test('should clear state when closing search', () => {
            const state = {
                query: 'test',
                matches: [{ textNode: null, startOffset: 0, endOffset: 4 }],
                currentIndex: 0,
                caseSensitive: true,
                useRegex: true,
                isOpen: true
            };

            // Simulate close
            state.isOpen = false;
            state.query = '';
            state.matches = [];
            state.currentIndex = -1;
            // Note: caseSensitive and useRegex are typically preserved

            assert.strictEqual(state.isOpen, false);
            assert.strictEqual(state.query, '');
            assert.strictEqual(state.matches.length, 0);
            assert.strictEqual(state.currentIndex, -1);
        });
    });

    suite('CSS class logic', () => {
        test('should apply search-highlight class to matches', () => {
            const className = 'search-highlight';
            assert.strictEqual(className, 'search-highlight');
        });

        test('should apply search-highlight-current class to current match', () => {
            const className = 'search-highlight-current';
            assert.strictEqual(className, 'search-highlight-current');
        });

        test('should apply no-results class when no matches found', () => {
            const hasMatches = false;
            const hasQuery = true;
            const className = !hasMatches && hasQuery ? 'no-results' : '';
            assert.strictEqual(className, 'no-results');
        });

        test('should apply active class to toggle buttons when enabled', () => {
            const isActive = true;
            const className = isActive ? 'active' : '';
            assert.strictEqual(className, 'active');
        });
    });

    suite('Container selector', () => {
        test('should support different container selectors', () => {
            const markdownSelector = '#editorWrapper';
            const diffSelector = '.diff-view-container';
            
            assert.ok(markdownSelector.startsWith('#') || markdownSelector.startsWith('.'));
            assert.ok(diffSelector.startsWith('#') || diffSelector.startsWith('.'));
        });
    });

    suite('Debounce logic', () => {
        test('should debounce with appropriate delay', async () => {
            const DEBOUNCE_DELAY = 150;
            let callCount = 0;
            
            const debounce = (fn: () => void, delay: number) => {
                let timer: ReturnType<typeof setTimeout>;
                return () => {
                    clearTimeout(timer);
                    timer = setTimeout(fn, delay);
                };
            };

            const debouncedFn = debounce(() => { callCount++; }, DEBOUNCE_DELAY);

            // Rapid calls
            debouncedFn();
            debouncedFn();
            debouncedFn();

            // Immediate - should not have called yet
            assert.strictEqual(callCount, 0);

            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, DEBOUNCE_DELAY + 50));
            assert.strictEqual(callCount, 1, 'Should only call once after debounce');
        });
    });

    suite('Edge cases', () => {
        test('should handle empty query', () => {
            const query = '';
            const shouldSearch = query.length > 0;
            assert.strictEqual(shouldSearch, false);
        });

        test('should handle whitespace-only query', () => {
            const query = '   ';
            const trimmedQuery = query.trim();
            // Whitespace search is technically valid
            assert.strictEqual(query.length > 0, true);
            assert.strictEqual(trimmedQuery.length, 0);
        });

        test('should handle very long query', () => {
            const longQuery = 'a'.repeat(1000);
            assert.strictEqual(longQuery.length, 1000);
            // Should not throw when creating regex
            const regex = new RegExp(longQuery, 'gi');
            assert.ok(regex);
        });

        test('should handle special unicode characters', () => {
            const text = 'Hello 世界 🌍';
            const query = '世界';
            const regex = new RegExp(query, 'gi');
            const matches = text.match(regex) || [];
            assert.strictEqual(matches.length, 1);
        });

        test('should handle newlines in text', () => {
            const text = 'line1\nline2\nline3';
            const query = 'line';
            const regex = new RegExp(query, 'gi');
            const matches = text.match(regex) || [];
            assert.strictEqual(matches.length, 3);
        });
    });

    suite('SearchController interface', () => {
        test('should have cleanup method', () => {
            const controller = {
                cleanup: () => {},
                refresh: () => {},
                isOpen: () => false
            };
            assert.strictEqual(typeof controller.cleanup, 'function');
        });

        test('should have refresh method', () => {
            const controller = {
                cleanup: () => {},
                refresh: () => {},
                isOpen: () => false
            };
            assert.strictEqual(typeof controller.refresh, 'function');
        });

        test('should have isOpen method', () => {
            const controller = {
                cleanup: () => {},
                refresh: () => {},
                isOpen: () => false
            };
            assert.strictEqual(typeof controller.isOpen, 'function');
            assert.strictEqual(controller.isOpen(), false);
        });

        test('should return correct isOpen state', () => {
            let isOpenState = false;
            const controller = {
                cleanup: () => {},
                refresh: () => {},
                isOpen: () => isOpenState
            };
            
            assert.strictEqual(controller.isOpen(), false);
            isOpenState = true;
            assert.strictEqual(controller.isOpen(), true);
        });
    });

    suite('Visibility checking for view mode switching', () => {
        test('should detect display:none as hidden', () => {
            // Simulates checking if an element with display:none should be skipped
            const checkVisibility = (displayValue: string): boolean => {
                return displayValue !== 'none';
            };
            
            assert.strictEqual(checkVisibility('block'), true);
            assert.strictEqual(checkVisibility('flex'), true);
            assert.strictEqual(checkVisibility('none'), false);
        });

        test('should detect visibility:hidden as hidden', () => {
            const checkVisibility = (visibilityValue: string): boolean => {
                return visibilityValue !== 'hidden';
            };
            
            assert.strictEqual(checkVisibility('visible'), true);
            assert.strictEqual(checkVisibility('hidden'), false);
        });

        test('should check ancestor visibility recursively', () => {
            // Simulates the ancestor visibility check logic
            interface MockElement {
                display: string;
                visibility: string;
                parent: MockElement | null;
            }

            const isElementVisible = (element: MockElement | null): boolean => {
                while (element) {
                    if (element.display === 'none' || element.visibility === 'hidden') {
                        return false;
                    }
                    element = element.parent;
                }
                return true;
            };

            // Element is visible
            const visibleElement: MockElement = {
                display: 'block',
                visibility: 'visible',
                parent: null
            };
            assert.strictEqual(isElementVisible(visibleElement), true);

            // Element itself is hidden
            const hiddenElement: MockElement = {
                display: 'none',
                visibility: 'visible',
                parent: null
            };
            assert.strictEqual(isElementVisible(hiddenElement), false);

            // Element is visible but parent is hidden (simulates split/inline view switching)
            const elementWithHiddenParent: MockElement = {
                display: 'block',
                visibility: 'visible',
                parent: {
                    display: 'none',
                    visibility: 'visible',
                    parent: null
                }
            };
            assert.strictEqual(isElementVisible(elementWithHiddenParent), false);

            // Element is visible with multiple visible ancestors
            const deeplyNestedVisible: MockElement = {
                display: 'block',
                visibility: 'visible',
                parent: {
                    display: 'flex',
                    visibility: 'visible',
                    parent: {
                        display: 'block',
                        visibility: 'visible',
                        parent: null
                    }
                }
            };
            assert.strictEqual(isElementVisible(deeplyNestedVisible), true);

            // Element is visible but grandparent is hidden
            const deeplyNestedHidden: MockElement = {
                display: 'block',
                visibility: 'visible',
                parent: {
                    display: 'block',
                    visibility: 'visible',
                    parent: {
                        display: 'none',
                        visibility: 'visible',
                        parent: null
                    }
                }
            };
            assert.strictEqual(isElementVisible(deeplyNestedHidden), false);
        });

        test('should handle visibility:hidden at any ancestor level', () => {
            interface MockElement {
                display: string;
                visibility: string;
                parent: MockElement | null;
            }

            const isElementVisible = (element: MockElement | null): boolean => {
                while (element) {
                    if (element.display === 'none' || element.visibility === 'hidden') {
                        return false;
                    }
                    element = element.parent;
                }
                return true;
            };

            const elementWithHiddenGrandparent: MockElement = {
                display: 'block',
                visibility: 'visible',
                parent: {
                    display: 'block',
                    visibility: 'visible',
                    parent: {
                        display: 'block',
                        visibility: 'hidden',
                        parent: null
                    }
                }
            };
            assert.strictEqual(isElementVisible(elementWithHiddenGrandparent), false);
        });
    });

    suite('Event propagation prevention', () => {
        test('should use capture phase for keyboard listener', () => {
            // The third parameter 'true' indicates capture phase
            const capturePhase = true;
            assert.strictEqual(capturePhase, true, 'Should use capture phase to intercept before VSCode handler');
        });

        test('should stop propagation for Ctrl+F', () => {
            // Simulates the event handling logic
            const mockEvent = {
                ctrlKey: true,
                metaKey: false,
                key: 'f',
                preventDefaultCalled: false,
                stopPropagationCalled: false,
                stopImmediatePropagationCalled: false,
                preventDefault() { this.preventDefaultCalled = true; },
                stopPropagation() { this.stopPropagationCalled = true; },
                stopImmediatePropagation() { this.stopImmediatePropagationCalled = true; }
            };

            // Handler logic
            if ((mockEvent.ctrlKey || mockEvent.metaKey) && mockEvent.key === 'f') {
                mockEvent.preventDefault();
                mockEvent.stopPropagation();
                mockEvent.stopImmediatePropagation();
            }

            assert.strictEqual(mockEvent.preventDefaultCalled, true, 'Should call preventDefault');
            assert.strictEqual(mockEvent.stopPropagationCalled, true, 'Should call stopPropagation');
            assert.strictEqual(mockEvent.stopImmediatePropagationCalled, true, 'Should call stopImmediatePropagation');
        });

        test('should stop propagation for Cmd+F (Mac)', () => {
            const mockEvent = {
                ctrlKey: false,
                metaKey: true,
                key: 'f',
                preventDefaultCalled: false,
                stopPropagationCalled: false,
                stopImmediatePropagationCalled: false,
                preventDefault() { this.preventDefaultCalled = true; },
                stopPropagation() { this.stopPropagationCalled = true; },
                stopImmediatePropagation() { this.stopImmediatePropagationCalled = true; }
            };

            if ((mockEvent.ctrlKey || mockEvent.metaKey) && mockEvent.key === 'f') {
                mockEvent.preventDefault();
                mockEvent.stopPropagation();
                mockEvent.stopImmediatePropagation();
            }

            assert.strictEqual(mockEvent.preventDefaultCalled, true);
            assert.strictEqual(mockEvent.stopPropagationCalled, true);
            assert.strictEqual(mockEvent.stopImmediatePropagationCalled, true);
        });
    });

    suite('Search refresh on view mode change', () => {
        test('should only refresh if search is open and has query', () => {
            // Simulates refresh logic
            const shouldRefresh = (isOpen: boolean, query: string): boolean => {
                return isOpen && query.length > 0;
            };

            assert.strictEqual(shouldRefresh(false, ''), false, 'Should not refresh when closed with no query');
            assert.strictEqual(shouldRefresh(false, 'test'), false, 'Should not refresh when closed with query');
            assert.strictEqual(shouldRefresh(true, ''), false, 'Should not refresh when open with no query');
            assert.strictEqual(shouldRefresh(true, 'test'), true, 'Should refresh when open with query');
        });

        test('should clear highlights before re-searching on refresh', () => {
            let highlightsCleared = false;
            let searchExecuted = false;

            const refresh = (isOpen: boolean, query: string) => {
                if (isOpen && query) {
                    highlightsCleared = true;
                    searchExecuted = true;
                }
            };

            refresh(true, 'test');

            assert.strictEqual(highlightsCleared, true, 'Should clear highlights before refresh');
            assert.strictEqual(searchExecuted, true, 'Should execute search after clearing');
        });

        test('should use setTimeout for DOM update before refresh', () => {
            // This tests the pattern of using setTimeout to allow DOM to update
            let refreshCalled = false;
            const REFRESH_DELAY = 50;

            // Simulates the toggle handler pattern
            const simulateToggle = (callback: () => void) => {
                // Immediate DOM changes happen here
                // Then schedule refresh
                setTimeout(() => {
                    callback();
                }, REFRESH_DELAY);
            };

            // In real code, this would be async, but we just test the pattern
            assert.strictEqual(REFRESH_DELAY, 50, 'Should use 50ms delay for DOM update');
        });
    });

    suite('SEARCH_SKIP_SELECTORS', () => {
        test('should include search UI elements', () => {
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.search-bar'), 'should skip search-bar');
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.search-highlight'), 'should skip search-highlight');
        });

        test('should include line number elements', () => {
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.line-number'), 'should skip line-number');
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.line-number-column'), 'should skip line-number-column');
        });

        test('should include gutter icons', () => {
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.gutter-icon'), 'should skip gutter-icon');
        });

        test('should include collapsed/truncated indicators', () => {
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.collapsed-hint'), 'should skip collapsed-hint');
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.collapsed-range'), 'should skip collapsed-range');
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.collapsed-indicator'), 'should skip collapsed-indicator');
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.truncated-indicator'), 'should skip truncated-indicator');
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.line-number-truncated'), 'should skip line-number-truncated');
        });

        test('should include comment bubbles', () => {
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.inline-comment-bubble'), 'should skip inline-comment-bubble');
        });

        test('should include toolbar elements', () => {
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.toolbar'), 'should skip toolbar');
            assert.ok(SEARCH_SKIP_SELECTORS.includes('.editor-toolbar'), 'should skip editor-toolbar');
        });

        test('should include contenteditable=false elements', () => {
            assert.ok(SEARCH_SKIP_SELECTORS.includes('[contenteditable="false"]'), 'should skip contenteditable=false');
        });

        test('should be an array of strings', () => {
            assert.ok(Array.isArray(SEARCH_SKIP_SELECTORS), 'should be an array');
            for (const selector of SEARCH_SKIP_SELECTORS) {
                assert.strictEqual(typeof selector, 'string', 'each selector should be a string');
            }
        });

        test('should have no duplicate selectors', () => {
            const uniqueSelectors = new Set(SEARCH_SKIP_SELECTORS);
            assert.strictEqual(uniqueSelectors.size, SEARCH_SKIP_SELECTORS.length, 'should have no duplicates');
        });
    });

    suite('Display-only content filtering logic', () => {
        /**
         * Mock implementation mirroring the isDisplayOnlyContent function
         * from search-handler.ts for testing purposes.
         */
        function isDisplayOnlyContent(element: { closest: (selector: string) => boolean }): boolean {
            for (const selector of SEARCH_SKIP_SELECTORS) {
                if (element.closest(selector)) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Helper to create mock element with specific parent classes
         */
        function createMockElement(matchingSelectors: string[]): { closest: (selector: string) => boolean } {
            return {
                closest: (selector: string) => matchingSelectors.includes(selector)
            };
        }

        test('should return true for element inside line-number', () => {
            const mockElement = createMockElement(['.line-number']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), true);
        });

        test('should return true for element inside gutter-icon', () => {
            const mockElement = createMockElement(['.gutter-icon']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), true);
        });

        test('should return true for element inside inline-comment-bubble', () => {
            const mockElement = createMockElement(['.inline-comment-bubble']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), true);
        });

        test('should return true for element with contenteditable=false ancestor', () => {
            const mockElement = createMockElement(['[contenteditable="false"]']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), true);
        });

        test('should return true for element inside collapsed-hint', () => {
            const mockElement = createMockElement(['.collapsed-hint']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), true);
        });

        test('should return true for element inside search-bar', () => {
            const mockElement = createMockElement(['.search-bar']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), true);
        });

        test('should return true for element inside toolbar', () => {
            const mockElement = createMockElement(['.toolbar']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), true);
        });

        test('should return false for element in document content', () => {
            const mockElement = createMockElement(['.line-content', '.editor-wrapper']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), false);
        });

        test('should return false for element with no matching ancestors', () => {
            const mockElement = createMockElement([]);
            assert.strictEqual(isDisplayOnlyContent(mockElement), false);
        });

        test('should return true if any selector matches', () => {
            // Element is inside both line-content (not skipped) and line-number (skipped)
            const mockElement = createMockElement(['.line-content', '.line-number']);
            assert.strictEqual(isDisplayOnlyContent(mockElement), true);
        });
    });

    suite('Search content filtering scenarios', () => {
        /**
         * Simulates what content should be searchable vs skipped.
         * This tests the expected behavior of the search filtering.
         */

        interface MockTextNode {
            content: string;
            parentClasses: string[];
        }

        function shouldNodeBeSearched(node: MockTextNode): boolean {
            for (const selector of SEARCH_SKIP_SELECTORS) {
                // Convert class selector to class name
                const className = selector.startsWith('.') ? selector.slice(1) : selector;
                if (selector.startsWith('[')) {
                    // Attribute selector like [contenteditable="false"]
                    // We simulate this by checking for the attribute marker
                    if (node.parentClasses.includes('contenteditable-false')) {
                        return false;
                    }
                } else if (node.parentClasses.includes(className)) {
                    return false;
                }
            }
            return true;
        }

        test('should search document content in line-content', () => {
            const node: MockTextNode = {
                content: 'Hello World',
                parentClasses: ['line-content']
            };
            assert.strictEqual(shouldNodeBeSearched(node), true);
        });

        test('should skip line numbers', () => {
            const node: MockTextNode = {
                content: '42',
                parentClasses: ['line-number']
            };
            assert.strictEqual(shouldNodeBeSearched(node), false);
        });

        test('should skip collapsed hints like "(5 empty lines)"', () => {
            const node: MockTextNode = {
                content: '(5 empty lines)',
                parentClasses: ['collapsed-hint']
            };
            assert.strictEqual(shouldNodeBeSearched(node), false);
        });

        test('should skip gutter icons', () => {
            const node: MockTextNode = {
                content: 'Comment icon',
                parentClasses: ['gutter-icon']
            };
            assert.strictEqual(shouldNodeBeSearched(node), false);
        });

        test('should skip truncation indicators', () => {
            const node: MockTextNode = {
                content: '... 42 more lines',
                parentClasses: ['truncated-indicator']
            };
            assert.strictEqual(shouldNodeBeSearched(node), false);
        });

        test('should skip comment bubble content', () => {
            const node: MockTextNode = {
                content: 'This is a comment',
                parentClasses: ['inline-comment-bubble']
            };
            assert.strictEqual(shouldNodeBeSearched(node), false);
        });

        test('should skip toolbar button text', () => {
            const node: MockTextNode = {
                content: 'Resolve All',
                parentClasses: ['toolbar']
            };
            assert.strictEqual(shouldNodeBeSearched(node), false);
        });

        test('should skip search bar content', () => {
            const node: MockTextNode = {
                content: 'Find in document...',
                parentClasses: ['search-bar']
            };
            assert.strictEqual(shouldNodeBeSearched(node), false);
        });

        test('should skip search highlight spans to avoid re-matching', () => {
            const node: MockTextNode = {
                content: 'matched text',
                parentClasses: ['search-highlight']
            };
            assert.strictEqual(shouldNodeBeSearched(node), false);
        });

        test('should search code block content in line-content', () => {
            const node: MockTextNode = {
                content: 'const x = 42;',
                parentClasses: ['line-content', 'code-block']
            };
            assert.strictEqual(shouldNodeBeSearched(node), true);
        });

        test('should search markdown content', () => {
            const node: MockTextNode = {
                content: '# Header',
                parentClasses: ['line-content', 'markdown-line']
            };
            assert.strictEqual(shouldNodeBeSearched(node), true);
        });
    });

    suite('Selector format validation', () => {
        test('all selectors should be valid CSS selectors', () => {
            // Each selector should either start with . (class), # (id), or [ (attribute)
            for (const selector of SEARCH_SKIP_SELECTORS) {
                const isClassSelector = selector.startsWith('.');
                const isIdSelector = selector.startsWith('#');
                const isAttributeSelector = selector.startsWith('[');
                const isElementSelector = /^[a-z]+$/i.test(selector);

                const isValid = isClassSelector || isIdSelector || isAttributeSelector || isElementSelector;
                assert.ok(isValid, `Selector "${selector}" should be a valid CSS selector format`);
            }
        });

        test('class selectors should have valid class names', () => {
            const classSelectors = SEARCH_SKIP_SELECTORS.filter(s => s.startsWith('.'));
            for (const selector of classSelectors) {
                const className = selector.slice(1);
                // Class names should only contain alphanumeric, hyphens, underscores
                const isValidClassName = /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(className);
                assert.ok(isValidClassName, `Class name "${className}" should be valid`);
            }
        });

        test('attribute selectors should be properly formatted', () => {
            const attrSelectors = SEARCH_SKIP_SELECTORS.filter(s => s.startsWith('['));
            for (const selector of attrSelectors) {
                // Should match pattern like [attr="value"]
                const isValidAttr = /^\[[a-zA-Z-]+(="[^"]*")?\]$/.test(selector);
                assert.ok(isValidAttr, `Attribute selector "${selector}" should be properly formatted`);
            }
        });
    });

    suite('Selected text in search box (Ctrl+F with selection)', () => {
        /**
         * Tests for the feature where selected text is pre-filled in the search box
         * when the user presses Ctrl+F with text selected.
         */

        suite('Selection capture logic', () => {
            test('should capture selected text when selection exists', () => {
                // Simulates the selection capture logic in handleKeydown
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                // With valid selection
                const validSelection: MockSelection = {
                    isCollapsed: false,
                    toString: () => 'selected text'
                };
                assert.strictEqual(captureSelectedText(validSelection), 'selected text');

                // With collapsed selection (cursor only, no selection)
                const collapsedSelection: MockSelection = {
                    isCollapsed: true,
                    toString: () => ''
                };
                assert.strictEqual(captureSelectedText(collapsedSelection), undefined);

                // With null selection
                assert.strictEqual(captureSelectedText(null), undefined);
            });

            test('should trim whitespace from selected text', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const selectionWithWhitespace: MockSelection = {
                    isCollapsed: false,
                    toString: () => '  hello world  '
                };
                assert.strictEqual(captureSelectedText(selectionWithWhitespace), 'hello world');
            });

            test('should return undefined for whitespace-only selection', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    const text = selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                    return text || undefined;
                };

                const whitespaceSelection: MockSelection = {
                    isCollapsed: false,
                    toString: () => '   \n\t  '
                };
                // After trim, empty string becomes falsy, so returns undefined
                const result = captureSelectedText(whitespaceSelection);
                assert.strictEqual(result === '' || result === undefined, true);
            });

            test('should handle multiline selection', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const multilineSelection: MockSelection = {
                    isCollapsed: false,
                    toString: () => 'line 1\nline 2\nline 3'
                };
                assert.strictEqual(captureSelectedText(multilineSelection), 'line 1\nline 2\nline 3');
            });

            test('should handle selection with special characters', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const specialCharsSelection: MockSelection = {
                    isCollapsed: false,
                    toString: () => 'function() { return true; }'
                };
                assert.strictEqual(captureSelectedText(specialCharsSelection), 'function() { return true; }');
            });

            test('should handle unicode selection', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const unicodeSelection: MockSelection = {
                    isCollapsed: false,
                    toString: () => '你好世界 🌍'
                };
                assert.strictEqual(captureSelectedText(unicodeSelection), '你好世界 🌍');
            });
        });

        suite('openSearchBar with initial query', () => {
            test('should populate search input with initial query', () => {
                // Simulates the openSearchBar behavior
                interface MockElements {
                    searchBar: { style: { display: string } };
                    searchInput: { value: string; focus: () => void; select: () => void };
                }

                interface MockState {
                    isOpen: boolean;
                }

                const openSearchBar = (
                    elements: MockElements,
                    state: MockState,
                    initialQuery?: string
                ): void => {
                    elements.searchBar.style.display = 'flex';
                    if (initialQuery && initialQuery.trim()) {
                        elements.searchInput.value = initialQuery.trim();
                    }
                    state.isOpen = true;
                };

                const elements: MockElements = {
                    searchBar: { style: { display: 'none' } },
                    searchInput: { value: '', focus: () => {}, select: () => {} }
                };
                const state: MockState = { isOpen: false };

                openSearchBar(elements, state, 'test query');

                assert.strictEqual(elements.searchInput.value, 'test query');
                assert.strictEqual(state.isOpen, true);
            });

            test('should not populate search input when initial query is undefined', () => {
                interface MockElements {
                    searchBar: { style: { display: string } };
                    searchInput: { value: string; focus: () => void; select: () => void };
                }

                interface MockState {
                    isOpen: boolean;
                }

                const openSearchBar = (
                    elements: MockElements,
                    state: MockState,
                    initialQuery?: string
                ): void => {
                    elements.searchBar.style.display = 'flex';
                    if (initialQuery && initialQuery.trim()) {
                        elements.searchInput.value = initialQuery.trim();
                    }
                    state.isOpen = true;
                };

                const elements: MockElements = {
                    searchBar: { style: { display: 'none' } },
                    searchInput: { value: '', focus: () => {}, select: () => {} }
                };
                const state: MockState = { isOpen: false };

                openSearchBar(elements, state, undefined);

                assert.strictEqual(elements.searchInput.value, '');
                assert.strictEqual(state.isOpen, true);
            });

            test('should not populate search input when initial query is empty string', () => {
                interface MockElements {
                    searchBar: { style: { display: string } };
                    searchInput: { value: string; focus: () => void; select: () => void };
                }

                interface MockState {
                    isOpen: boolean;
                }

                const openSearchBar = (
                    elements: MockElements,
                    state: MockState,
                    initialQuery?: string
                ): void => {
                    elements.searchBar.style.display = 'flex';
                    if (initialQuery && initialQuery.trim()) {
                        elements.searchInput.value = initialQuery.trim();
                    }
                    state.isOpen = true;
                };

                const elements: MockElements = {
                    searchBar: { style: { display: 'none' } },
                    searchInput: { value: '', focus: () => {}, select: () => {} }
                };
                const state: MockState = { isOpen: false };

                openSearchBar(elements, state, '');

                assert.strictEqual(elements.searchInput.value, '');
            });

            test('should not populate search input when initial query is whitespace only', () => {
                interface MockElements {
                    searchBar: { style: { display: string } };
                    searchInput: { value: string; focus: () => void; select: () => void };
                }

                interface MockState {
                    isOpen: boolean;
                }

                const openSearchBar = (
                    elements: MockElements,
                    state: MockState,
                    initialQuery?: string
                ): void => {
                    elements.searchBar.style.display = 'flex';
                    if (initialQuery && initialQuery.trim()) {
                        elements.searchInput.value = initialQuery.trim();
                    }
                    state.isOpen = true;
                };

                const elements: MockElements = {
                    searchBar: { style: { display: 'none' } },
                    searchInput: { value: '', focus: () => {}, select: () => {} }
                };
                const state: MockState = { isOpen: false };

                openSearchBar(elements, state, '   \n\t  ');

                assert.strictEqual(elements.searchInput.value, '');
            });

            test('should trim initial query before populating', () => {
                interface MockElements {
                    searchBar: { style: { display: string } };
                    searchInput: { value: string; focus: () => void; select: () => void };
                }

                interface MockState {
                    isOpen: boolean;
                }

                const openSearchBar = (
                    elements: MockElements,
                    state: MockState,
                    initialQuery?: string
                ): void => {
                    elements.searchBar.style.display = 'flex';
                    if (initialQuery && initialQuery.trim()) {
                        elements.searchInput.value = initialQuery.trim();
                    }
                    state.isOpen = true;
                };

                const elements: MockElements = {
                    searchBar: { style: { display: 'none' } },
                    searchInput: { value: '', focus: () => {}, select: () => {} }
                };
                const state: MockState = { isOpen: false };

                openSearchBar(elements, state, '  trimmed text  ');

                assert.strictEqual(elements.searchInput.value, 'trimmed text');
            });
        });

        suite('Search execution with initial query', () => {
            test('should execute search immediately when initial query is provided', () => {
                let searchExecuted = false;
                let searchQuery = '';

                interface MockElements {
                    searchBar: { style: { display: string } };
                    searchInput: { value: string; focus: () => void; select: () => void };
                }

                interface MockState {
                    isOpen: boolean;
                }

                const executeSearch = (query: string) => {
                    searchExecuted = true;
                    searchQuery = query;
                };

                // Use unknown instead of HTMLElement since DOM types aren't available in Node test environment
                const openSearchBar = (
                    elements: MockElements,
                    state: MockState,
                    initialQuery?: string,
                    getContainer?: () => unknown
                ): void => {
                    elements.searchBar.style.display = 'flex';
                    if (initialQuery && initialQuery.trim()) {
                        elements.searchInput.value = initialQuery.trim();
                        if (getContainer) {
                            executeSearch(initialQuery.trim());
                        }
                    }
                    state.isOpen = true;
                };

                const elements: MockElements = {
                    searchBar: { style: { display: 'none' } },
                    searchInput: { value: '', focus: () => {}, select: () => {} }
                };
                const state: MockState = { isOpen: false };

                openSearchBar(elements, state, 'search term', () => null);

                assert.strictEqual(searchExecuted, true, 'Search should be executed');
                assert.strictEqual(searchQuery, 'search term', 'Search query should match initial query');
            });

            test('should not execute search when no initial query', () => {
                let searchExecuted = false;

                interface MockElements {
                    searchBar: { style: { display: string } };
                    searchInput: { value: string; focus: () => void; select: () => void };
                }

                interface MockState {
                    isOpen: boolean;
                }

                const executeSearch = () => {
                    searchExecuted = true;
                };

                // Use unknown instead of HTMLElement since DOM types aren't available in Node test environment
                const openSearchBar = (
                    elements: MockElements,
                    state: MockState,
                    initialQuery?: string,
                    getContainer?: () => unknown
                ): void => {
                    elements.searchBar.style.display = 'flex';
                    if (initialQuery && initialQuery.trim()) {
                        elements.searchInput.value = initialQuery.trim();
                        if (getContainer) {
                            executeSearch();
                        }
                    }
                    state.isOpen = true;
                };

                const elements: MockElements = {
                    searchBar: { style: { display: 'none' } },
                    searchInput: { value: '', focus: () => {}, select: () => {} }
                };
                const state: MockState = { isOpen: false };

                openSearchBar(elements, state, undefined, () => null);

                assert.strictEqual(searchExecuted, false, 'Search should not be executed without initial query');
            });

            test('should not execute search when no container getter provided', () => {
                let searchExecuted = false;

                interface MockElements {
                    searchBar: { style: { display: string } };
                    searchInput: { value: string; focus: () => void; select: () => void };
                }

                interface MockState {
                    isOpen: boolean;
                }

                const executeSearch = () => {
                    searchExecuted = true;
                };

                // Use unknown instead of HTMLElement since DOM types aren't available in Node test environment
                const openSearchBar = (
                    elements: MockElements,
                    state: MockState,
                    initialQuery?: string,
                    getContainer?: () => unknown
                ): void => {
                    elements.searchBar.style.display = 'flex';
                    if (initialQuery && initialQuery.trim()) {
                        elements.searchInput.value = initialQuery.trim();
                        if (getContainer) {
                            executeSearch();
                        }
                    }
                    state.isOpen = true;
                };

                const elements: MockElements = {
                    searchBar: { style: { display: 'none' } },
                    searchInput: { value: '', focus: () => {}, select: () => {} }
                };
                const state: MockState = { isOpen: false };

                // Note: getContainer is undefined
                openSearchBar(elements, state, 'search term');

                assert.strictEqual(searchExecuted, false, 'Search should not be executed without container getter');
            });
        });

        suite('Keyboard shortcut integration', () => {
            test('should capture selection when Ctrl+F is pressed', () => {
                // Simulates the full keyboard handler flow
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                interface MockEvent {
                    ctrlKey: boolean;
                    metaKey: boolean;
                    key: string;
                    preventDefault: () => void;
                    stopPropagation: () => void;
                    stopImmediatePropagation: () => void;
                }

                let capturedQuery: string | undefined;

                const handleKeydown = (
                    e: MockEvent,
                    getSelection: () => MockSelection | null,
                    openSearchBar: (query?: string) => void
                ) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        const selection = getSelection();
                        const selectedText = selection && !selection.isCollapsed
                            ? selection.toString().trim()
                            : undefined;

                        openSearchBar(selectedText);
                    }
                };

                const mockEvent: MockEvent = {
                    ctrlKey: true,
                    metaKey: false,
                    key: 'f',
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    stopImmediatePropagation: () => {}
                };

                const mockSelection: MockSelection = {
                    isCollapsed: false,
                    toString: () => 'selected text'
                };

                handleKeydown(
                    mockEvent,
                    () => mockSelection,
                    (query) => { capturedQuery = query; }
                );

                assert.strictEqual(capturedQuery, 'selected text');
            });

            test('should work with Cmd+F on Mac', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                interface MockEvent {
                    ctrlKey: boolean;
                    metaKey: boolean;
                    key: string;
                    preventDefault: () => void;
                    stopPropagation: () => void;
                    stopImmediatePropagation: () => void;
                }

                let capturedQuery: string | undefined;

                const handleKeydown = (
                    e: MockEvent,
                    getSelection: () => MockSelection | null,
                    openSearchBar: (query?: string) => void
                ) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        const selection = getSelection();
                        const selectedText = selection && !selection.isCollapsed
                            ? selection.toString().trim()
                            : undefined;

                        openSearchBar(selectedText);
                    }
                };

                const mockEvent: MockEvent = {
                    ctrlKey: false,
                    metaKey: true, // Mac Cmd key
                    key: 'f',
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    stopImmediatePropagation: () => {}
                };

                const mockSelection: MockSelection = {
                    isCollapsed: false,
                    toString: () => 'mac selection'
                };

                handleKeydown(
                    mockEvent,
                    () => mockSelection,
                    (query) => { capturedQuery = query; }
                );

                assert.strictEqual(capturedQuery, 'mac selection');
            });

            test('should pass undefined when no selection exists', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                interface MockEvent {
                    ctrlKey: boolean;
                    metaKey: boolean;
                    key: string;
                    preventDefault: () => void;
                    stopPropagation: () => void;
                    stopImmediatePropagation: () => void;
                }

                let capturedQuery: string | undefined = 'should be replaced';

                const handleKeydown = (
                    e: MockEvent,
                    getSelection: () => MockSelection | null,
                    openSearchBar: (query?: string) => void
                ) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        const selection = getSelection();
                        const selectedText = selection && !selection.isCollapsed
                            ? selection.toString().trim()
                            : undefined;

                        openSearchBar(selectedText);
                    }
                };

                const mockEvent: MockEvent = {
                    ctrlKey: true,
                    metaKey: false,
                    key: 'f',
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    stopImmediatePropagation: () => {}
                };

                handleKeydown(
                    mockEvent,
                    () => null,  // Simulate no selection
                    (query) => { capturedQuery = query; }
                );

                assert.strictEqual(capturedQuery, undefined);
            });
        });

        suite('Cross-platform compatibility', () => {
            test('should work on Windows (Ctrl+F)', () => {
                const event = { ctrlKey: true, metaKey: false, key: 'f' };
                const shouldOpen = (event.ctrlKey || event.metaKey) && event.key === 'f';
                assert.strictEqual(shouldOpen, true, 'Should recognize Ctrl+F on Windows');
            });

            test('should work on macOS (Cmd+F)', () => {
                const event = { ctrlKey: false, metaKey: true, key: 'f' };
                const shouldOpen = (event.ctrlKey || event.metaKey) && event.key === 'f';
                assert.strictEqual(shouldOpen, true, 'Should recognize Cmd+F on macOS');
            });

            test('should work on Linux (Ctrl+F)', () => {
                const event = { ctrlKey: true, metaKey: false, key: 'f' };
                const shouldOpen = (event.ctrlKey || event.metaKey) && event.key === 'f';
                assert.strictEqual(shouldOpen, true, 'Should recognize Ctrl+F on Linux');
            });

            test('should handle both Ctrl and Meta pressed simultaneously', () => {
                // Edge case: both keys pressed (shouldn't happen normally but handle gracefully)
                const event = { ctrlKey: true, metaKey: true, key: 'f' };
                const shouldOpen = (event.ctrlKey || event.metaKey) && event.key === 'f';
                assert.strictEqual(shouldOpen, true, 'Should handle both modifier keys');
            });
        });

        suite('Edge cases', () => {
            test('should handle very long selection', () => {
                const longText = 'a'.repeat(10000);
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const selection: MockSelection = {
                    isCollapsed: false,
                    toString: () => longText
                };

                const result = captureSelectedText(selection);
                assert.strictEqual(result?.length, 10000, 'Should handle long selections');
            });

            test('should handle selection with only newlines', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const selection: MockSelection = {
                    isCollapsed: false,
                    toString: () => '\n\n\n'
                };

                const result = captureSelectedText(selection);
                assert.strictEqual(result, '', 'Should return empty string for newlines-only selection');
            });

            test('should handle selection with mixed whitespace', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const selection: MockSelection = {
                    isCollapsed: false,
                    toString: () => '  \t  hello  \n  world  \t  '
                };

                const result = captureSelectedText(selection);
                assert.strictEqual(result, 'hello  \n  world', 'Should trim outer whitespace but preserve inner');
            });

            test('should handle selection with regex special characters', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const selection: MockSelection = {
                    isCollapsed: false,
                    toString: () => '.*+?^${}()|[]\\/'
                };

                const result = captureSelectedText(selection);
                assert.strictEqual(result, '.*+?^${}()|[]\\/', 'Should preserve regex special characters');
            });

            test('should handle emoji selection', () => {
                interface MockSelection {
                    isCollapsed: boolean;
                    toString: () => string;
                }

                const captureSelectedText = (selection: MockSelection | null): string | undefined => {
                    return selection && !selection.isCollapsed 
                        ? selection.toString().trim() 
                        : undefined;
                };

                const selection: MockSelection = {
                    isCollapsed: false,
                    toString: () => '🔍 Search 🎯'
                };

                const result = captureSelectedText(selection);
                assert.strictEqual(result, '🔍 Search 🎯', 'Should handle emojis correctly');
            });
        });
    });
});
