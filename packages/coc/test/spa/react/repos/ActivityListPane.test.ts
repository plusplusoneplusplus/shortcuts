/**
 * Tests for ActivityListPane pinned chats feature.
 *
 * Validates that:
 * - pinnedChatIds/onPinChat/onUnpinChat props are accepted
 * - The pinned section renders separately from completed tasks
 * - Context menu includes Pin/Unpin items for completed tasks
 * - Pinned tasks are excluded from the completed tasks section
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ACTIVITY_LIST_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'ActivityListPane.tsx'
);

describe('ActivityListPane pinned chats', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
    });

    describe('props interface', () => {
        it('declares pinnedChatIds prop', () => {
            expect(source).toContain('pinnedChatIds?: Set<string>');
        });

        it('declares onPinChat prop', () => {
            expect(source).toContain('onPinChat?: (taskId: string) => void');
        });

        it('declares onUnpinChat prop', () => {
            expect(source).toContain('onUnpinChat?: (taskId: string) => void');
        });
    });

    describe('pinned section rendering', () => {
        it('renders a pinned section with data-testid', () => {
            expect(source).toContain('data-testid="pinned-chats-section-toggle"');
        });

        it('renders pinned cards with data-pinned attribute', () => {
            expect(source).toContain('data-pinned="true"');
        });

        it('uses showPinned state for collapsing', () => {
            expect(source).toContain('showPinned');
            expect(source).toContain('setShowPinned');
        });

        it('shows pin icon in pinned section header', () => {
            expect(source).toContain('📌 Pinned');
        });
    });

    describe('filtered split of history', () => {
        it('computes filteredPinned from history', () => {
            expect(source).toContain('filteredPinned');
        });

        it('computes filteredUnpinned from history', () => {
            expect(source).toContain('filteredUnpinned');
        });

        it('uses filteredUnpinned for the completed tasks section', () => {
            const historySection = source.substring(
                source.indexOf('Completed Tasks'),
                source.indexOf('Completed Tasks') + 200,
            );
            expect(historySection).toContain('filteredUnpinned');
        });
    });

    describe('context menu pin/unpin', () => {
        it('includes Pin to top menu item', () => {
            expect(source).toContain("'Pin to top'");
        });

        it('includes Unpin menu item', () => {
            expect(source).toContain("'Unpin'");
        });

        it('calls onPinChat when pin is clicked', () => {
            expect(source).toContain('onPinChat(taskId)');
        });

        it('calls onUnpinChat when unpin is clicked', () => {
            expect(source).toContain('onUnpinChat(taskId)');
        });

        it('includes pinnedChatIds in contextMenuItems dependencies', () => {
            const depsLine = source.substring(
                source.indexOf('}, [contextMenu, queued'),
                source.indexOf('}, [contextMenu, queued') + 200,
            );
            expect(depsLine).toContain('pinnedChatIds');
        });
    });

    describe('shift+right-click bypasses custom context menu', () => {
        it('checks shiftKey before preventing default', () => {
            expect(source).toContain('if (e.shiftKey) return');
        });

        it('places the shiftKey guard before preventDefault', () => {
            const handler = source.substring(
                source.indexOf('handleTaskContextMenu'),
                source.indexOf('handleTaskContextMenu') + 300,
            );
            const shiftIdx = handler.indexOf('e.shiftKey');
            const preventIdx = handler.indexOf('e.preventDefault');
            expect(shiftIdx).toBeGreaterThan(-1);
            expect(preventIdx).toBeGreaterThan(-1);
            expect(shiftIdx).toBeLessThan(preventIdx);
        });
    });

    describe('pinned cards styling', () => {
        it('applies left border accent to pinned cards', () => {
            expect(source).toContain('border-l-2 border-l-amber-400');
        });
    });

    describe('title tooltip on truncated elements', () => {
        it('pinned section task name has title attribute', () => {
            expect(source).toContain("title={task.displayName || task.type || 'Task'}");
        });

        it('QueueTaskItem task name has title attribute', () => {
            expect(source).toContain('title={name}>{name}');
        });

        it('prompt preview lines have title={p} in IIFE renders', () => {
            const matches = source.match(/title=\{p\}/g);
            // 3 sections: pinned, unpinned, archived
            expect(matches).not.toBeNull();
            expect(matches!.length).toBeGreaterThanOrEqual(3);
        });

        it('QueueTaskItem prompt preview has title attribute', () => {
            expect(source).toContain('title={promptPreview}>{promptPreview}');
        });

        it('title attributes appear on truncate spans', () => {
            // Every title={task.displayName...} should be on a span with truncate class
            const titlePattern = /className=\{cn\("truncate".*?\}\s+title=\{task\.displayName/g;
            const matches = source.match(titlePattern);
            // 3 sections: pinned, unpinned, archived
            expect(matches).not.toBeNull();
            expect(matches!.length).toBe(3);
        });
    });

    describe('archive support', () => {
        describe('props interface', () => {
            it('declares archivedChatIds prop', () => {
                expect(source).toContain('archivedChatIds?: Set<string>');
            });

            it('declares onArchiveChat prop', () => {
                expect(source).toContain('onArchiveChat?: (taskId: string) => void');
            });

            it('declares onUnarchiveChat prop', () => {
                expect(source).toContain('onUnarchiveChat?: (taskId: string) => void');
            });
        });

        describe('archived section rendering', () => {
            it('renders an archived section with data-testid', () => {
                expect(source).toContain('data-testid="archived-chats-section-toggle"');
            });

            it('renders archived cards with data-archived attribute', () => {
                expect(source).toContain('data-archived="true"');
            });

            it('uses showArchived state for collapsing', () => {
                expect(source).toContain('showArchived');
                expect(source).toContain('setShowArchived');
            });

            it('shows box icon in archived section header', () => {
                expect(source).toContain('📦 Archived');
            });
        });

        describe('history filtering', () => {
            it('computes filteredArchived from history', () => {
                expect(source).toContain('filteredArchived');
            });

            it('computes activeHistory excluding archived tasks', () => {
                expect(source).toContain('activeHistory');
            });
        });

        describe('context menu archive/unarchive', () => {
            it('includes Archive menu item', () => {
                expect(source).toContain("'Archive'");
            });

            it('includes Unarchive menu item', () => {
                expect(source).toContain("'Unarchive'");
            });

            it('calls onArchiveChat when archive is clicked', () => {
                expect(source).toContain('onArchiveChat(taskId)');
            });

            it('calls onUnarchiveChat when unarchive is clicked', () => {
                expect(source).toContain('onUnarchiveChat(taskId)');
            });

            it('includes archivedChatIds in contextMenuItems dependencies', () => {
                const depsLine = source.substring(
                    source.indexOf('}, [contextMenu, queued'),
                    source.indexOf('}, [contextMenu, queued') + 300,
                );
                expect(depsLine).toContain('archivedChatIds');
            });
        });
    });

    describe('delete chat', () => {
        it('includes Delete chat menu item in completed context menu', () => {
            expect(source).toContain("'Delete chat'");
        });

        it('defines handleDeleteChat handler', () => {
            expect(source).toContain('handleDeleteChat');
        });

        it('calls DELETE /queue/history/:taskId endpoint', () => {
            expect(source).toContain("'/queue/history/' + encodeURIComponent(taskId)");
            expect(source).toContain("method: 'DELETE'");
        });

        it('shows a confirmation before deleting', () => {
            expect(source).toContain("confirm(");
        });

        it('calls fetchQueue after successful deletion', () => {
            const handler = source.substring(
                source.indexOf('handleDeleteChat'),
                source.indexOf('handleDeleteChat') + 400,
            );
            expect(handler).toContain('fetchQueue');
        });

        it('uses trash icon for delete menu item', () => {
            expect(source).toContain("icon: '🗑'");
        });
    });

    describe('pin running tasks', () => {
        it('running context menu includes Pin to top option', () => {
            // The running taskStatus branch must also check pinnedChatIds and offer Pin/Unpin
            const runningBlock = source.substring(
                source.indexOf("if (taskStatus === 'running')"),
                source.indexOf("if (taskStatus === 'completed')"),
            );
            expect(runningBlock).toContain("'Pin to top'");
        });

        it('running context menu includes Unpin option', () => {
            const runningBlock = source.substring(
                source.indexOf("if (taskStatus === 'running')"),
                source.indexOf("if (taskStatus === 'completed')"),
            );
            expect(runningBlock).toContain("'Unpin'");
        });

        it('running context menu calls onPinChat for running task', () => {
            const runningBlock = source.substring(
                source.indexOf("if (taskStatus === 'running')"),
                source.indexOf("if (taskStatus === 'completed')"),
            );
            expect(runningBlock).toContain('onPinChat(taskId)');
        });

        it('running context menu calls onUnpinChat for running task', () => {
            const runningBlock = source.substring(
                source.indexOf("if (taskStatus === 'running')"),
                source.indexOf("if (taskStatus === 'completed')"),
            );
            expect(runningBlock).toContain('onUnpinChat(taskId)');
        });

        it('passes isPinned to QueueTaskItem for running tasks', () => {
            expect(source).toContain('isPinned={pinnedChatIds?.has(task.id) ?? false}');
        });

        it('QueueTaskItem accepts isPinned prop', () => {
            expect(source).toContain('isPinned?: boolean');
        });

        it('QueueTaskItem applies amber left-border when isPinned', () => {
            expect(source).toContain("isPinned && \"border-l-2 border-l-amber-400 dark:border-l-amber-500\"");
        });

        it('QueueTaskItem renders a pin badge when isPinned', () => {
            expect(source).toContain('data-testid="running-pin-badge"');
        });

        it('computes pinnedRunningCount from filteredRunning', () => {
            expect(source).toContain('pinnedRunningCount');
        });

        it('pinned section visible when only running tasks are pinned', () => {
            expect(source).toContain('filteredPinned.length > 0 || pinnedRunningCount > 0');
        });

        it('pinned section count includes pinnedRunningCount', () => {
            expect(source).toContain('filteredPinned.length + pinnedRunningCount');
        });
    });

    describe('multi-select and bulk context menu', () => {
        it('declares selectedHistoryIds state', () => {
            expect(source).toContain('selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>');
        });

        it('declares anchorHistoryId state', () => {
            expect(source).toContain('anchorHistoryId, setAnchorHistoryId] = useState<string | null>(null)');
        });

        it('contextMenu state type includes bulkIds', () => {
            expect(source).toContain('bulkIds?: string[]');
        });

        it('defines handleHistoryItemClick callback', () => {
            expect(source).toContain('handleHistoryItemClick');
        });

        it('handleHistoryItemClick handles shift+click range select', () => {
            const handler = source.substring(
                source.indexOf('handleHistoryItemClick'),
                source.indexOf('handleHistoryItemClick') + 600,
            );
            expect(handler).toContain('e.shiftKey');
            expect(handler).toContain('anchorHistoryId');
        });

        it('handleHistoryItemClick handles ctrl/cmd+click toggle', () => {
            const handler = source.substring(
                source.indexOf('handleHistoryItemClick'),
                source.indexOf('handleHistoryItemClick') + 800,
            );
            expect(handler).toContain('e.ctrlKey || e.metaKey');
        });

        it('handleHistoryItemClick clears selection on plain click', () => {
            const handler = source.substring(
                source.indexOf('handleHistoryItemClick'),
                source.indexOf('handleHistoryItemClick') + 1200,
            );
            expect(handler).toContain('setSelectedHistoryIds(new Set())');
        });

        it('handleTaskContextMenu detects bulk mode when >= 2 items selected and right-clicked item is in selection', () => {
            const handler = source.substring(
                source.indexOf('handleTaskContextMenu'),
                source.indexOf('handleTaskContextMenu') + 500,
            );
            expect(handler).toContain('selectedHistoryIds.size >= 2');
            expect(handler).toContain('selectedHistoryIds.has(taskId)');
            expect(handler).toContain('bulkIds');
        });

        it('bulk context menu branch checks for bulkIds', () => {
            expect(source).toContain('contextMenu.bulkIds');
        });

        it('bulk context menu shows count header', () => {
            expect(source).toContain('`${ids.length} tasks selected`');
        });

        it('bulk context menu shows Mark as Read when any unseen', () => {
            const bulkBlock = source.substring(
                source.indexOf('contextMenu.bulkIds'),
                source.indexOf('contextMenu.bulkIds') + 1500,
            );
            expect(bulkBlock).toContain("'Mark as Read'");
            expect(bulkBlock).toContain('anyUnseen');
        });

        it('bulk context menu shows Mark as Unread when any seen', () => {
            const bulkBlock = source.substring(
                source.indexOf('contextMenu.bulkIds'),
                source.indexOf('contextMenu.bulkIds') + 2500,
            );
            expect(bulkBlock).toContain("'Mark as Unread'");
            expect(bulkBlock).toContain('anySeen');
        });

        it('bulk context menu shows Pin to top when any unpinned', () => {
            const bulkBlock = source.substring(
                source.indexOf('contextMenu.bulkIds'),
                source.indexOf('contextMenu.bulkIds') + 2500,
            );
            expect(bulkBlock).toContain("'Pin to top'");
            expect(bulkBlock).toContain('anyUnpinned');
        });

        it('bulk context menu shows Unpin when any pinned', () => {
            const bulkBlock = source.substring(
                source.indexOf('contextMenu.bulkIds'),
                source.indexOf('contextMenu.bulkIds') + 2500,
            );
            expect(bulkBlock).toContain("'Unpin'");
            expect(bulkBlock).toContain('anyPinned');
        });

        it('bulk context menu shows Archive when any unarchived', () => {
            const bulkBlock = source.substring(
                source.indexOf('contextMenu.bulkIds'),
                source.indexOf('contextMenu.bulkIds') + 2500,
            );
            expect(bulkBlock).toContain("'Archive'");
            expect(bulkBlock).toContain('anyUnarchived');
        });

        it('bulk context menu shows Unarchive when any archived', () => {
            const bulkBlock = source.substring(
                source.indexOf('contextMenu.bulkIds'),
                source.indexOf('contextMenu.bulkIds') + 2500,
            );
            expect(bulkBlock).toContain("'Unarchive'");
            expect(bulkBlock).toContain('anyArchived');
        });

        it('bulk delete shows count in label', () => {
            expect(source).toContain('`Delete ${ids.length} chats…`');
        });

        it('selection count pill appears when >= 2 items selected', () => {
            expect(source).toContain('data-testid="selection-count-pill"');
            expect(source).toContain('selectedHistoryIds.size >= 2');
        });

        it('selection clear button dismisses selection', () => {
            expect(source).toContain('data-testid="selection-clear-btn"');
        });

        it('selected cards show checkbox glyph', () => {
            expect(source).toContain('data-testid="selection-checkbox"');
            expect(source).toContain('isHistorySelected');
        });

        it('selected cards apply blue tint background', () => {
            expect(source).toContain('bg-[#0078d4]/10 dark:bg-[#3794ff]/10');
        });

        it('selected cards apply outline instead of ring', () => {
            expect(source).toContain('outline outline-1 outline-[#0078d4]/40');
        });

        it('Escape key clears selection', () => {
            const escBlock = source.substring(
                source.indexOf("e.key === 'Escape' && selectedHistoryIds"),
                source.indexOf("e.key === 'Escape' && selectedHistoryIds") + 200,
            );
            expect(escBlock).toContain('setSelectedHistoryIds(new Set())');
            expect(escBlock).toContain('setAnchorHistoryId(null)');
        });

        it('useEffect cleans stale selected ids when filtered list changes', () => {
            expect(source).toContain('Clean up stale selection');
        });

        it('data-selected attribute added to completed cards', () => {
            expect(source).toContain('data-selected={isHistorySelected || undefined}');
        });

        it('deleteChatDirect helper defined for bulk delete', () => {
            expect(source).toContain('deleteChatDirect');
        });
    });

    describe('mark-all-read button mobile visibility', () => {
        it('completed tasks header row uses flex-wrap so mark-all-read wraps on narrow screens', () => {
            // The header row div uses flex-wrap to prevent clipping the button on mobile viewports.
            expect(source).toContain('flex flex-wrap items-center gap-1.5');
        });

        it('toggle button has min-w-0 to allow shrinking on narrow screens', () => {
            // The toggle button needs min-w-0 so its text can truncate instead of pushing the action button off-screen.
            const idx = source.indexOf('Completed Tasks (');
            const completedSection = source.substring(idx - 600, idx + 300);
            expect(completedSection).toContain('min-w-0');
        });

        it('renders mark-all-read-btn when unseen completed tasks exist', () => {
            expect(source).toContain('data-testid="mark-all-read-btn"');
        });
    });

    describe('collapsible running tasks section', () => {
        it('renders a running tasks section toggle button with data-testid', () => {
            expect(source).toContain('data-testid="running-tasks-section-toggle"');
        });

        it('uses showRunning state for collapsing', () => {
            expect(source).toContain('showRunning');
            expect(source).toContain('setShowRunning');
        });

        it('initializes showRunning to true', () => {
            expect(source).toContain('const [showRunning, setShowRunning] = useState(true)');
        });

        it('renders chevron toggle in running tasks header', () => {
            const runningHeader = source.substring(
                source.indexOf('running-tasks-section-toggle'),
                source.indexOf('running-tasks-section-toggle') + 200,
            );
            expect(runningHeader).toContain('showRunning ? \'▼\' : \'▶\'');
        });

        it('wraps running task list in showRunning conditional', () => {
            expect(source).toContain('{showRunning && (');
        });
    });

    describe('collapsible queued tasks section', () => {
        it('renders a queued tasks section toggle button with data-testid', () => {
            expect(source).toContain('data-testid="queued-tasks-section-toggle"');
        });

        it('uses showQueued state for collapsing', () => {
            expect(source).toContain('showQueued');
            expect(source).toContain('setShowQueued');
        });

        it('initializes showQueued to true', () => {
            expect(source).toContain('const [showQueued, setShowQueued] = useState(true)');
        });

        it('renders chevron toggle in queued tasks header', () => {
            const queuedHeader = source.substring(
                source.indexOf('queued-tasks-section-toggle'),
                source.indexOf('queued-tasks-section-toggle') + 200,
            );
            expect(queuedHeader).toContain('showQueued ? \'▼\' : \'▶\'');
        });

        it('wraps queued task list in showQueued conditional', () => {
            expect(source).toContain('{showQueued && (');
        });
    });

    describe('keyword search (Ctrl+F)', () => {
        it('exports taskMatchesSearch helper', () => {
            expect(source).toContain('export function taskMatchesSearch(');
        });

        it('taskMatchesSearch returns true when query is empty', () => {
            // Verified by the `if (!query) return true` guard
            expect(source).toContain('if (!query) return true');
        });

        it('taskMatchesSearch matches on title field', () => {
            expect(source).toContain('title.includes(q)');
        });

        it('taskMatchesSearch matches on prompt/payload fields', () => {
            expect(source).toContain('prompt.includes(q)');
        });

        it('declares searchQuery state', () => {
            expect(source).toContain("const [searchQuery, setSearchQuery] = useState('')");
        });

        it('declares searchVisible state', () => {
            expect(source).toContain("const [searchVisible, setSearchVisible] = useState(false)");
        });

        it('declares searchInputRef', () => {
            expect(source).toContain('searchInputRef = useRef<HTMLInputElement>(null)');
        });

        it('resets searchQuery and searchVisible on workspaceId change', () => {
            const workspaceEffect = source.substring(
                source.indexOf("}, [workspaceId])") - 200,
                source.indexOf("}, [workspaceId])") + 1,
            );
            expect(workspaceEffect).toContain("setSearchQuery('')");
            expect(workspaceEffect).toContain('setSearchVisible(false)');
        });

        it('adds Ctrl+F / Cmd+F keydown listener on document', () => {
            expect(source).toContain("(e.ctrlKey || e.metaKey) && e.key === 'f'");
        });

        it('prevents default browser find on Ctrl+F', () => {
            const handler = source.substring(
                source.indexOf("e.key === 'f'"),
                source.indexOf("e.key === 'f'") + 100,
            );
            expect(handler).toContain('e.preventDefault()');
        });

        it('sets searchVisible to true on Ctrl+F', () => {
            const handler = source.substring(
                source.indexOf("e.key === 'f'"),
                source.indexOf("e.key === 'f'") + 200,
            );
            expect(handler).toContain('setSearchVisible(true)');
        });

        it('Escape key closes search when visible', () => {
            expect(source).toContain("e.key === 'Escape' && searchVisible");
        });

        it('Escape key clears searchQuery', () => {
            const escBlock = source.substring(
                source.indexOf("e.key === 'Escape'"),
                source.indexOf("e.key === 'Escape'") + 200,
            );
            expect(escBlock).toContain("setSearchQuery('')");
        });

        it('renders search input with data-testid', () => {
            expect(source).toContain('data-testid="queue-search-input"');
        });

        it('renders close button with data-testid', () => {
            expect(source).toContain('data-testid="queue-search-close"');
        });

        it('closes search on ✕ button click', () => {
            // onClick handler precedes data-testid in JSX, so look back from the testid
            const closeBtnIdx = source.indexOf('queue-search-close');
            const closeBtn = source.substring(closeBtnIdx - 200, closeBtnIdx + 50);
            expect(closeBtn).toContain("setSearchQuery('')");
            expect(closeBtn).toContain('setSearchVisible(false)');
        });

        it('shows match count when searchQuery is non-empty', () => {
            expect(source).toContain('{searchQuery && (');
        });

        it('includes searchQuery in filteredRunning dependencies', () => {
            const memo = source.substring(
                source.indexOf('filteredRunning = useMemo'),
                source.indexOf('filteredRunning = useMemo') + 150,
            );
            expect(memo).toContain('searchQuery');
        });

        it('includes searchQuery in filteredQueued dependencies', () => {
            const memo = source.substring(
                source.indexOf('filteredQueued = useMemo'),
                source.indexOf('filteredQueued = useMemo') + 200,
            );
            expect(memo).toContain('searchQuery');
        });

        it('includes searchQuery in filteredHistory dependencies', () => {
            const memo = source.substring(
                source.indexOf('filteredHistory = useMemo'),
                source.indexOf('filteredHistory = useMemo') + 150,
            );
            expect(memo).toContain('searchQuery');
        });

        it('calls taskMatchesSearch in filteredRunning filter', () => {
            const memo = source.substring(
                source.indexOf('filteredRunning = useMemo'),
                source.indexOf('filteredRunning = useMemo') + 200,
            );
            expect(memo).toContain('taskMatchesSearch(t, searchQuery)');
        });
    });
});

// ── Filter dropdown rework ─────────────────────────────────────────────

describe('ActivityListPane: filter dropdown rework', () => {
    let source: string;

    beforeAll(() => {
        source = require('fs').readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
    });

    describe('"Queue" label removed', () => {
        it('does not render a standalone Queue label span', () => {
            expect(source).not.toContain('<span className="text-sm font-medium">Queue</span>');
        });
    });

    describe('excludedTypes state', () => {
        it('uses excludedTypes state instead of filterType', () => {
            expect(source).toContain('excludedTypes, setExcludedTypes] = useState<Set<string>>(new Set())');
        });

        it('resets excludedTypes to empty set on workspaceId change', () => {
            const workspaceEffect = source.substring(
                source.indexOf("}, [workspaceId])") - 200,
                source.indexOf("}, [workspaceId])") + 1,
            );
            expect(workspaceEffect).toContain('setExcludedTypes(new Set())');
        });
    });

    describe('taskMatchesFilter exclusion signature', () => {
        it('accepts excludedTypes: Set<string> parameter', () => {
            expect(source).toContain('taskMatchesFilter(task: any, excludedTypes: Set<string>)');
        });

        it('returns true when excludedTypes is empty', () => {
            const fn = source.substring(
                source.indexOf('export function taskMatchesFilter'),
                source.indexOf('export function taskMatchesFilter') + 300,
            );
            expect(fn).toContain('excludedTypes.size === 0');
        });

        it('uses !excludedTypes.has to include/exclude', () => {
            const fn = source.substring(
                source.indexOf('export function taskMatchesFilter'),
                source.indexOf('export function taskMatchesFilter') + 500,
            );
            expect(fn).toContain('!excludedTypes.has');
        });
    });

    describe('filter dropdown UI', () => {
        it('renders filter dropdown instead of pill row', () => {
            expect(source).toContain('data-testid="queue-filter-dropdown"');
            expect(source).not.toContain('data-testid="queue-filter-pills"');
        });

        it('does not render legacy queue-filter-reset button', () => {
            expect(source).not.toContain('data-testid="queue-filter-reset"');
        });

        it('uses FilterDropdown component', () => {
            expect(source).toContain('<FilterDropdown');
        });

        it('imports FilterDropdown from shared', () => {
            expect(source).toContain('FilterDropdown');
            expect(source).toContain("from '../shared'");
        });

        it('passes availableFilters as items to FilterDropdown', () => {
            expect(source).toContain('items={availableFilters}');
        });

        it('passes excludedTypes as excludedValues to FilterDropdown', () => {
            expect(source).toContain('excludedValues={excludedTypes}');
        });

        it('passes setExcludedTypes as onChange to FilterDropdown', () => {
            expect(source).toContain('onChange={setExcludedTypes}');
        });

        it('availableFilters uses FilterItem type', () => {
            expect(source).toContain('FilterItem');
        });

        it('availableFilters nests chat mode children under chat parent', () => {
            const fn = source.substring(
                source.indexOf('availableFilters = useMemo'),
                source.indexOf('availableFilters = useMemo') + 600,
            );
            expect(fn).toContain('children');
            expect(fn).toContain("type === 'chat'");
            expect(fn).toContain('CHAT_MODE_LABELS');
        });
    });

    describe('filteredRunning/Queued/History use excludedTypes', () => {
        it('filteredRunning uses excludedTypes', () => {
            const memo = source.substring(
                source.indexOf('filteredRunning = useMemo'),
                source.indexOf('filteredRunning = useMemo') + 200,
            );
            expect(memo).toContain('taskMatchesFilter(t, excludedTypes)');
            expect(memo).toContain('excludedTypes');
        });

        it('filteredQueued uses excludedTypes', () => {
            const memo = source.substring(
                source.indexOf('filteredQueued = useMemo'),
                source.indexOf('filteredQueued = useMemo') + 250,
            );
            expect(memo).toContain('taskMatchesFilter(t, excludedTypes)');
            expect(memo).toContain('excludedTypes');
        });

        it('filteredHistory uses excludedTypes', () => {
            const memo = source.substring(
                source.indexOf('filteredHistory = useMemo'),
                source.indexOf('filteredHistory = useMemo') + 200,
            );
            expect(memo).toContain('taskMatchesFilter(t, excludedTypes)');
            expect(memo).toContain('excludedTypes');
        });
    });
});

// ── taskMatchesFilter unit tests (exclusion logic) ────────────────────

import { taskMatchesFilter } from '../../../../src/server/spa/client/react/repos/ActivityListPane';

describe('taskMatchesFilter: exclusion logic', () => {
    const chatAsk = { type: 'chat', payload: { mode: 'ask' } };
    const chatPlan = { type: 'chat', payload: { mode: 'plan' } };
    const chatAutopilot = { type: 'chat', payload: { mode: 'autopilot' } };
    const workflow = { type: 'run-workflow', payload: {} };
    const script = { type: 'run-script', payload: {} };

    it('returns true for any task when excludedTypes is empty', () => {
        const empty = new Set<string>();
        expect(taskMatchesFilter(chatAsk, empty)).toBe(true);
        expect(taskMatchesFilter(workflow, empty)).toBe(true);
        expect(taskMatchesFilter(script, empty)).toBe(true);
    });

    it('excludes a task type when its type key is in excludedTypes', () => {
        const excluded = new Set(['run-workflow']);
        expect(taskMatchesFilter(workflow, excluded)).toBe(false);
        expect(taskMatchesFilter(script, excluded)).toBe(true);
    });

    it('excludes chat tasks by mode key', () => {
        const excluded = new Set(['ask']);
        expect(taskMatchesFilter(chatAsk, excluded)).toBe(false);
        expect(taskMatchesFilter(chatPlan, excluded)).toBe(true);
    });

    it('excludes multiple types simultaneously', () => {
        const excluded = new Set(['run-workflow', 'run-script']);
        expect(taskMatchesFilter(workflow, excluded)).toBe(false);
        expect(taskMatchesFilter(script, excluded)).toBe(false);
        expect(taskMatchesFilter(chatAsk, excluded)).toBe(true);
    });

    it('excludes multiple chat modes simultaneously', () => {
        const excluded = new Set(['ask', 'plan']);
        expect(taskMatchesFilter(chatAsk, excluded)).toBe(false);
        expect(taskMatchesFilter(chatPlan, excluded)).toBe(false);
        expect(taskMatchesFilter(chatAutopilot, excluded)).toBe(true);
    });

    it('does not exclude a task whose type is not in excludedTypes', () => {
        const excluded = new Set(['ask']);
        expect(taskMatchesFilter(workflow, excluded)).toBe(true);
    });

    it('chat task without a mode falls back to type-based check', () => {
        const chatNoMode = { type: 'chat', payload: {} };
        const excluded = new Set(['chat']);
        expect(taskMatchesFilter(chatNoMode, excluded)).toBe(false);
    });

    it('excludes chat tasks with mode when parent chat type is excluded (regression: parent covers all)', () => {
        // When parent 'chat' is excluded via the dropdown, all chat tasks must be hidden
        // regardless of mode — this prevents tasks slipping through the parent filter.
        const excluded = new Set(['chat']);
        expect(taskMatchesFilter(chatAsk, excluded)).toBe(false);
        expect(taskMatchesFilter(chatPlan, excluded)).toBe(false);
        expect(taskMatchesFilter(chatAutopilot, excluded)).toBe(false);
    });
});

// ── Mobile long-press context menu (regression) ──────────────────────────────

describe('ActivityListPane mobile long-press context menu', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
    });

    describe('useLongPress import', () => {
        it('imports useLongPress hook', () => {
            expect(source).toContain("from '../hooks/useLongPress'");
        });
    });

    describe('QueueTaskItem — long-press wiring', () => {
        it('declares onLongPress prop', () => {
            expect(source).toContain('onLongPress?: (x: number, y: number) => void');
        });

        it('declares cancelLongPress prop', () => {
            expect(source).toContain('cancelLongPress?: boolean');
        });

        it('attaches onTouchStart handler to Card', () => {
            expect(source).toContain('onTouchStart={longPress.onTouchStart}');
        });

        it('attaches onTouchEnd handler to Card', () => {
            expect(source).toContain('onTouchEnd={longPress.onTouchEnd}');
        });

        it('attaches onTouchMove handler to Card', () => {
            expect(source).toContain('onTouchMove={longPress.onTouchMove}');
        });

        it('suppresses onClick when long press fired', () => {
            expect(source).toContain('longPress.didLongPress()');
        });
    });

    describe('running tasks — onLongPress wired', () => {
        it('passes onLongPress to running QueueTaskItem', () => {
            // The source should contain onLongPress wired for running tasks
            // (look for the pattern near 'running' status in JSX invocations)
            expect(source).toContain("task.id, 'running')}");
        });
    });

    describe('queued tasks — onLongPress wired with cancelLongPress', () => {
        it('passes onLongPress to queued QueueTaskItem', () => {
            // The source should contain onLongPress wired for queued tasks
            expect(source).toContain("item.id, 'queued')}");
        });

        it('passes cancelLongPress={!!activeDraggedTaskId} to queued QueueTaskItem', () => {
            expect(source).toContain('cancelLongPress={!!activeDraggedTaskId}');
        });
    });

    describe('history items — long-press handlers', () => {
        it('defines handleHistoryTouchStart callback', () => {
            expect(source).toContain('handleHistoryTouchStart');
        });

        it('defines cancelHistoryLongPress callback', () => {
            expect(source).toContain('cancelHistoryLongPress');
        });

        it('defines handleHistoryTouchMove callback', () => {
            expect(source).toContain('handleHistoryTouchMove');
        });

        it('wires onTouchStart to pinned history cards', () => {
            // There should be at least three occurrences of handleHistoryTouchStart in JSX
            const occurrences = source.split('onTouchStart={e => handleHistoryTouchStart(e, task.id)}').length - 1;
            expect(occurrences).toBeGreaterThanOrEqual(3);
        });

        it('wires onTouchEnd (cancel) to history cards', () => {
            const occurrences = source.split('onTouchEnd={cancelHistoryLongPress}').length - 1;
            expect(occurrences).toBeGreaterThanOrEqual(3);
        });

        it('wires onTouchMove to history cards', () => {
            const occurrences = source.split('onTouchMove={handleHistoryTouchMove}').length - 1;
            expect(occurrences).toBeGreaterThanOrEqual(3);
        });

        it('suppresses onClick when long press fired for pinned history', () => {
            expect(source).toContain('historyLongPressFired.current');
        });
    });
});
