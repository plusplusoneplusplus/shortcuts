/**
 * Tests for ChatListPane pinned chats feature.
 *
 * Validates that:
 * - pinnedChatIds/onPinChat/onUnpinChat props are accepted
 * - The pinned section renders separately from completed tasks
 * - Context menu includes Pin/Unpin items for completed tasks
 * - Pinned tasks are excluded from the completed tasks section
 * - isChatTask correctly classifies resolve tasks with workItemId
 * - Session category badges are rendered
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ACTIVITY_LIST_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'ChatListPane.tsx'
);

describe('ChatListPane pinned chats', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
    });

    describe('props interface', () => {
        it('obtains pinnedChatIds from useChatPrefs', () => {
            expect(source).toContain('useChatPrefs()');
            expect(source).toContain('pinnedChatIds');
        });

        it('obtains onPinChat from useChatPrefs', () => {
            expect(source).toContain('pinChat');
        });

        it('obtains onUnpinChat from useChatPrefs', () => {
            expect(source).toContain('unpinChat');
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
            expect(source).toContain("title={task.displayName || task.title || task.type || 'Task'}");
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
            it('obtains archivedChatIds from useChatPrefs', () => {
                expect(source).toContain('useChatPrefs()');
                expect(source).toContain('archivedChatIds');
            });

            it('obtains onArchiveChat from useChatPrefs', () => {
                expect(source).toContain('archiveChat');
            });

            it('obtains onUnarchiveChat from useChatPrefs', () => {
                expect(source).toContain('unarchiveChat');
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

        it('handleTaskContextMenu detects bulk mode when >= 1 item selected and right-clicked item is in selection', () => {
            const handler = source.substring(
                source.indexOf('handleTaskContextMenu'),
                source.indexOf('handleTaskContextMenu') + 500,
            );
            expect(handler).toContain('selectedHistoryIds.size >= 1');
            expect(handler).toContain('selectedHistoryIds.has(taskId)');
            expect(handler).toContain('bulkIds');
        });

        it('handleTaskContextMenu falls back to [taskId] for a single completed chat', () => {
            const handler = source.substring(
                source.indexOf('handleTaskContextMenu'),
                source.indexOf('handleTaskContextMenu') + 600,
            );
            expect(handler).toContain('[taskId]');
        });

        it('bulk context menu uses singular label for single chat', () => {
            const bulkBlock = source.substring(
                source.indexOf('contextMenu.bulkIds'),
                source.indexOf('contextMenu.bulkIds') + 3000,
            );
            expect(bulkBlock).toContain("ids.length === 1 ? 'Summarize chat'");
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

        describe('summarize chats bulk action', () => {
            it('bulk context menu shows Summarize N chats item', () => {
                const bulkBlock = source.substring(
                    source.indexOf('contextMenu.bulkIds'),
                    source.indexOf('contextMenu.bulkIds') + 3000,
                );
                expect(bulkBlock).toContain('Summarize');
                expect(bulkBlock).toContain("'Summarize chat'");
                expect(bulkBlock).toContain('`Summarize ${ids.length} chats`');
            });

            it('summarize calls POST /queue/summarize', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain("'/queue/summarize'");
            });

            it('summarize sends processIds and workspaceId in body', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('processIds: summarizeDialogIds');
                expect(block).toContain('workspaceId');
            });

            it('summarize is capped at 20 items', () => {
                const bulkBlock = source.substring(
                    source.indexOf('contextMenu.bulkIds'),
                    source.indexOf('contextMenu.bulkIds') + 3000,
                );
                expect(bulkBlock).toContain('ids.length <= 20');
            });

            it('summarize uses 📝 icon', () => {
                const bulkBlock = source.substring(
                    source.indexOf('contextMenu.bulkIds'),
                    source.indexOf('contextMenu.bulkIds') + 3000,
                );
                expect(bulkBlock).toContain('📝');
            });

            it('summarize navigates to new task via onSelectTask', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('onSelectTask(data.task.id)');
            });

            it('useMemo deps include workspaceId, onSelectTask, fetchQueue', () => {
                // Find the contextMenuItems useMemo dependency array
                const depsIdx = source.indexOf('closeContextMenu, deleteChatDirect');
                expect(depsIdx).toBeGreaterThan(-1);
                const depsBlock = source.substring(depsIdx, depsIdx + 200);
                expect(depsBlock).toContain('workspaceId');
                expect(depsBlock).toContain('onSelectTask');
                expect(depsBlock).toContain('fetchQueue');
            });

            it('summarize uses POST method in fetch call', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain("method: 'POST'");
            });

            it('summarize calls closeContextMenu before fetch', () => {
                const summarizeIdx = source.indexOf("Summarize ${ids.length} chats");
                expect(summarizeIdx).toBeGreaterThan(-1);
                const block = source.substring(summarizeIdx, summarizeIdx + 600);
                expect(block).toContain('closeContextMenu()');
            });

            it('summarize calls fetchQueue after successful response', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('fetchQueue()');
            });

            it('summarize sends Content-Type application/json header', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain("'Content-Type': 'application/json'");
            });

            it('summarize uses JSON.stringify for request body', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('JSON.stringify');
            });

            it('summarize checks res.ok before navigating', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('res.ok');
            });
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
            expect(source).toContain("const [searchQuery, setSearchQueryRaw] = useState('')");
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
            expect(workspaceEffect).toContain("setSearchQueryRaw('')");
            expect(workspaceEffect).toContain('setSearchVisible(false)');
        });

        it('adds Ctrl+F / Cmd+F keydown listener on document', () => {
            expect(source).toContain("(e.ctrlKey || e.metaKey) && e.key === 'f'");
        });

        it('prevents default browser find on Ctrl+F', () => {
            const handler = source.substring(
                source.indexOf("e.key === 'f'"),
                source.indexOf("e.key === 'f'") + 300,
            );
            expect(handler).toContain('e.preventDefault()');
        });

        it('sets searchVisible to true on Ctrl+F', () => {
            const handler = source.substring(
                source.indexOf("e.key === 'f'"),
                source.indexOf("e.key === 'f'") + 300,
            );
            expect(handler).toContain('setSearchVisible(true)');
        });

        it('skips interception when last click was inside detail pane', () => {
            // Tracks last-clicked pane via mousedown listener
            expect(source).toContain('detailPaneFocusedRef = useRef(false)');
            expect(source).toContain("document.querySelector('[data-pane=\"detail\"]')");
            expect(source).toContain('detailPane?.contains(e.target as Node)');
            // mousedown listener uses capture phase
            expect(source).toContain("document.addEventListener('mousedown', handler, true)");
        });

        it('checks detailPaneFocusedRef before intercepting Ctrl+F', () => {
            const handler = source.substring(
                source.indexOf("e.key === 'f'"),
                source.indexOf("e.key === 'f'") + 300,
            );
            expect(handler).toContain('if (detailPaneFocusedRef.current) return');
            // The ref check must come before preventDefault
            const refIdx = handler.indexOf('detailPaneFocusedRef.current');
            const preventIdx = handler.indexOf('e.preventDefault()');
            expect(refIdx).toBeLessThan(preventIdx);
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
            expect(source).toContain('{searchQuery && !searchLoading && (');
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

    describe('status icon cleanup — no ✅/🚫 for completed/cancelled', () => {
        it('does not render ✅ emoji anywhere in the file', () => {
            expect(source).not.toContain("'✅'");
        });

        it('does not render 🚫 emoji as a status icon in chat list items', () => {
            // 🚫 may still exist in context menus, but should not appear in status ternaries
            expect(source).not.toContain("'cancelled' ? '🚫'");
        });

        it('still renders ❌ for failed status', () => {
            expect(source).toContain("'failed'");
            expect(source).toContain('❌');
        });
    });

    describe('thinking indicator for running chats', () => {
        it('renders a thinking-indicator element with data-testid', () => {
            expect(source).toContain('data-testid="thinking-indicator"');
        });

        it('uses animate-pulse on the thinking dot', () => {
            const thinkingIdx = source.indexOf('thinking-indicator');
            const block = source.substring(thinkingIdx, thinkingIdx + 300);
            expect(block).toContain('animate-pulse');
        });

        it('shows status label text via statusLabel helper in the indicator', () => {
            const thinkingIdx = source.indexOf('thinking-indicator');
            const block = source.substring(thinkingIdx, thinkingIdx + 300);
            expect(block).toContain('statusLabel');
        });

        it('thinking indicator is in the timestamp area via isRunning ternary', () => {
            // The thinking indicator is now rendered in the timestamp span as a ternary: isRunning ? <indicator> : timestamp
            expect(source).toContain('{isRunning ? <span className="inline-flex items-center gap-1" data-testid="thinking-indicator">');
        });

        it('thinking indicator is NOT rendered as a separate element before the title', () => {
            // Should not have the old pattern: {isRunning && <span ... data-testid="thinking-indicator">
            expect(source).not.toContain('{isRunning && <span');
        });

        it('failed icon is hidden when running', () => {
            expect(source).toContain("{!isRunning && task.status === 'failed'");
        });

        it('renders thinking indicator in both pinned and unpinned chat sections', () => {
            const matches = source.match(/data-testid="thinking-indicator"/g);
            expect(matches).not.toBeNull();
            expect(matches!.length).toBe(2);
        });
    });
});

// ── Filter dropdown rework ─────────────────────────────────────────────

describe('ChatListPane: filter dropdown rework', () => {
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
        it('reads excludedTypes from AppContext myWorkExcludedTypes', () => {
            expect(source).toContain('useApp()');
            expect(source).toContain('appState.myWorkExcludedTypes');
        });

        it('does not reset excludedTypes on workspaceId change', () => {
            const workspaceEffect = source.substring(
                source.indexOf("}, [workspaceId])") - 200,
                source.indexOf("}, [workspaceId])") + 1,
            );
            expect(workspaceEffect).not.toContain('setExcludedTypes');
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
                source.indexOf('export function taskMatchesFilter') + 700,
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
            expect(source).toContain("from '../../shared'");
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

import { taskMatchesFilter } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

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

describe('ChatListPane mobile long-press context menu', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
    });

    describe('useLongPress import', () => {
        it('imports useLongPress hook', () => {
            expect(source).toContain("from '../../hooks/ui/useLongPress'");
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
        it('uses historyLongPress hook from useLongPress', () => {
            expect(source).toContain('historyLongPress = useLongPress');
        });

        it('defines historyLongPressTaskRef for tracking task id', () => {
            expect(source).toContain('historyLongPressTaskRef');
        });

        it('delegates touch move to historyLongPress hook', () => {
            expect(source).toContain('historyLongPress.onTouchMove');
        });

        it('wires onTouchStart to pinned history cards', () => {
            const occurrences = source.split('historyLongPress.onTouchStart(e)').length - 1;
            expect(occurrences).toBeGreaterThanOrEqual(3);
        });

        it('wires onTouchEnd (cancel) to history cards', () => {
            const occurrences = source.split('onTouchEnd={historyLongPress.onTouchEnd}').length - 1;
            expect(occurrences).toBeGreaterThanOrEqual(3);
        });

        it('wires onTouchMove to history cards', () => {
            const occurrences = source.split('onTouchMove={historyLongPress.onTouchMove}').length - 1;
            expect(occurrences).toBeGreaterThanOrEqual(3);
        });

        it('suppresses onClick when long press fired for pinned history', () => {
            expect(source).toContain('historyLongPress.didLongPress()');
        });
    });

    describe('refreshing indicator in empty state', () => {
        it('renders refreshing indicator with data-testid when empty and isRefreshing', () => {
            expect(source).toContain('data-testid="queue-refreshing-indicator"');
        });

        it('shows refreshing indicator only when isRefreshing is true', () => {
            expect(source).toContain('{isRefreshing && (');
        });

        it('applies animate-pulse class to the refreshing indicator', () => {
            expect(source).toContain('animate-pulse');
        });

        it('displays Refreshing text in the indicator', () => {
            expect(source).toContain('Refreshing\u2026');
        });
    });
});

// ── New Chat button uses onNewChat (regression: must not open EnqueueDialog) ──

describe('ChatListPane: New Chat button uses onNewChat', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
    });

    it('accepts onNewChat optional prop', () => {
        expect(source).toContain('onNewChat');
    });

    it('new-chat-btn uses onNewChat callback (not onOpenDialog)', () => {
        // The New Chat button should prefer onNewChat over onOpenDialog
        expect(source).toContain('onNewChat ?? onOpenDialog');
    });

    it('new-chat-btn has data-testid', () => {
        expect(source).toContain('data-testid="new-chat-btn"');
    });

    it('empty-state Queue Task button was removed', () => {
        // The empty-state "Queue Task" button has been removed — no task queueing from empty state
        expect(source).not.toContain('data-testid="repo-queue-task-btn-empty"');
    });

    it('chats empty-state shows "No chats yet" without a button', () => {
        expect(source).toContain('No chats yet');
        expect(source).not.toContain('data-testid="new-chat-btn-empty"');
    });

    it('empty-state uses tab-filtered arrays instead of raw arrays', () => {
        // tabFiltered arrays are computed for tab-aware empty states within the main content
        expect(source).toContain('tabFilteredRunning');
        expect(source).toContain('tabFilteredQueued');
        expect(source).toContain('tabFilteredHistory');
    });
});

// ── isChatTask: tab routing logic ─────────────────────────────────────────────

import { isChatTask } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

describe('isChatTask: tab routing', () => {
    it('returns true for a chat task with ask mode', () => {
        expect(isChatTask({ type: 'chat', payload: { mode: 'ask' } })).toBe(true);
    });

    it('returns true for a chat task with plan mode', () => {
        expect(isChatTask({ type: 'chat', payload: { mode: 'plan' } })).toBe(true);
    });

    it('returns true for a chat task with autopilot mode (belongs in chats tab)', () => {
        expect(isChatTask({ type: 'chat', payload: { mode: 'autopilot' } })).toBe(true);
    });

    it('returns false for a work-item execution chat task (payload.workItemId)', () => {
        expect(isChatTask({ type: 'chat', payload: { mode: 'ask', workItemId: 'wi-123' } })).toBe(false);
    });

    it('returns false for a work-item history item (top-level workItemId)', () => {
        expect(isChatTask({ type: 'chat', workItemId: 'wi-456' })).toBe(false);
    });

    it('returns false for non-chat task types', () => {
        expect(isChatTask({ type: 'run-workflow', payload: {} })).toBe(false);
        expect(isChatTask({ type: 'run-script', payload: {} })).toBe(false);
    });

    it('returns true for a chat task without a mode (legacy, defaults to chats tab)', () => {
        expect(isChatTask({ type: 'chat', payload: {} })).toBe(true);
    });
});

// ── NewChatArea: simplified chat-only UI ──────────────────────────────────────

const NEW_CHAT_AREA_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'NewChatArea.tsx'
);

describe('NewChatArea: chat-only UI', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(NEW_CHAT_AREA_PATH, 'utf-8');
    });

    it('does not render the quick-ask button', () => {
        expect(source).not.toContain('data-testid="quick-ask-btn"');
    });

    it('does not render the quick-create-work-item button', () => {
        expect(source).not.toContain('data-testid="quick-create-work-item-btn"');
    });

    it('does not import CreateWorkItemDialog', () => {
        expect(source).not.toContain('CreateWorkItemDialog');
    });

    it('renders a mode selector with cycle button and dropdown', () => {
        expect(source).toContain('data-testid="mode-cycle-btn"');
        expect(source).toContain('data-testid="new-chat-mode-dropdown"');
    });

    it('defaults mode to autopilot and sends selectedMode in the task payload', () => {
        expect(source).toContain("'autopilot'");
        expect(source).toContain('mode: selectedMode');
    });

    it('still renders Start a new conversation hero text', () => {
        expect(source).toContain('Start a new conversation');
    });

    it('still renders the send input', () => {
        expect(source).toContain('data-testid="new-chat-input"');
        expect(source).toContain('data-testid="new-chat-send-btn"');
    });
});

// ── Session category helpers ──────────────────────────────────────────────────

import {
    getSessionCategory,
    SESSION_CATEGORY_LABELS,
} from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

describe('getSessionCategory', () => {
    it('returns undefined for tasks without sessionCategory', () => {
        expect(getSessionCategory({ payload: {} })).toBeUndefined();
        expect(getSessionCategory({ payload: { mode: 'ask' } })).toBeUndefined();
        expect(getSessionCategory({})).toBeUndefined();
    });

    it('returns the category from payload', () => {
        expect(getSessionCategory({ payload: { sessionCategory: 'generating-code' } })).toBe('generating-code');
        expect(getSessionCategory({ payload: { sessionCategory: 'resolve-plan-comments' } })).toBe('resolve-plan-comments');
        expect(getSessionCategory({ payload: { sessionCategory: 'resolve-commit-comments' } })).toBe('resolve-commit-comments');
    });
});

describe('SESSION_CATEGORY_LABELS', () => {
    it('has entries for all three categories', () => {
        expect(SESSION_CATEGORY_LABELS['generating-code']).toBeDefined();
        expect(SESSION_CATEGORY_LABELS['resolve-plan-comments']).toBeDefined();
        expect(SESSION_CATEGORY_LABELS['resolve-commit-comments']).toBeDefined();
    });

    it('each entry has label, icon, and color', () => {
        for (const key of ['generating-code', 'resolve-plan-comments', 'resolve-commit-comments']) {
            const entry = SESSION_CATEGORY_LABELS[key];
            expect(entry.label).toBeTruthy();
            expect(entry.icon).toBeTruthy();
            expect(entry.color).toBeTruthy();
        }
    });
});

describe('taskMatchesFilter: session category exclusion', () => {
    it('excludes tasks when their cat:<category> is in excludedTypes', () => {
        const task = { type: 'chat', payload: { mode: 'autopilot', sessionCategory: 'generating-code' } };
        const excluded = new Set(['cat:generating-code']);
        expect(taskMatchesFilter(task, excluded)).toBe(false);
    });

    it('includes tasks when cat:<category> is not in excludedTypes', () => {
        const task = { type: 'chat', payload: { mode: 'autopilot', sessionCategory: 'generating-code' } };
        const excluded = new Set(['cat:resolve-plan-comments']);
        expect(taskMatchesFilter(task, excluded)).toBe(true);
    });

    it('excludes resolve-plan-comments category', () => {
        const task = { type: 'chat', payload: { mode: 'autopilot', sessionCategory: 'resolve-plan-comments' } };
        const excluded = new Set(['cat:resolve-plan-comments']);
        expect(taskMatchesFilter(task, excluded)).toBe(false);
    });

    it('excludes resolve-commit-comments category', () => {
        const task = { type: 'chat', payload: { mode: 'autopilot', sessionCategory: 'resolve-commit-comments' } };
        const excluded = new Set(['cat:resolve-commit-comments']);
        expect(taskMatchesFilter(task, excluded)).toBe(false);
    });

    it('tasks without sessionCategory are not affected by cat: exclusion', () => {
        const task = { type: 'chat', payload: { mode: 'autopilot' } };
        const excluded = new Set(['cat:generating-code']);
        expect(taskMatchesFilter(task, excluded)).toBe(true);
    });
});

describe('isChatTask: resolve tasks with workItemId', () => {
    it('returns true for a plain chat task without workItemId', () => {
        const task = { type: 'chat', payload: { kind: 'chat', mode: 'autopilot' } };
        expect(isChatTask(task)).toBe(true);
    });

    it('returns false when payload.workItemId is set', () => {
        const task = { type: 'chat', payload: { kind: 'chat', mode: 'autopilot', workItemId: 'wi-123' } };
        expect(isChatTask(task)).toBe(false);
    });

    it('returns false for resolve-commit-comments task with workItemId', () => {
        const task = {
            type: 'chat',
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                sessionCategory: 'resolve-commit-comments',
                workItemId: 'wi-456',
                workItemResolveContext: { workItemId: 'wi-456', wsId: 'ws-1', autoReExecute: false },
            },
        };
        expect(isChatTask(task)).toBe(false);
    });

    it('returns false for resolve-plan-comments task with workItemId', () => {
        const task = {
            type: 'chat',
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                sessionCategory: 'resolve-plan-comments',
                workItemId: 'wi-789',
                workItemResolveContext: { workItemId: 'wi-789', wsId: 'ws-1', autoReExecute: false },
            },
        };
        expect(isChatTask(task)).toBe(false);
    });

    it('returns true for resolve task without workItemId (standalone resolve)', () => {
        const task = {
            type: 'chat',
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                sessionCategory: 'resolve-commit-comments',
            },
        };
        expect(isChatTask(task)).toBe(true);
    });

    it('returns false for non-chat task types', () => {
        const task = { type: 'run-workflow', payload: { kind: 'run-workflow' } };
        expect(isChatTask(task)).toBe(false);
    });
});

describe('session category badge rendering', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
    });

    it('renders session-category-badge data-testid in task cards', () => {
        expect(source).toContain('data-testid="session-category-badge"');
    });

    it('looks up SESSION_CATEGORY_LABELS for badge rendering', () => {
        const badgeInstances = source.match(/SESSION_CATEGORY_LABELS\[cat\]/g);
        expect(badgeInstances).not.toBeNull();
        expect(badgeInstances!.length).toBeGreaterThanOrEqual(1);
    });
});

// ── Chat search ───────────────────────────────────────────────────────────────

import { taskMatchesSearch } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

describe('ChatListPane: chat search', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
    });

    describe('search bar renders on chats tab', () => {
        it('search bar is not gated behind activeTab === tasks', () => {
            expect(source).not.toContain("activeTab === 'tasks' && searchVisible && (");
        });

        it('search bar uses a ternary to decide visibility per tab', () => {
            expect(source).toContain("activeTab === 'tasks') ? searchVisible : true");
        });

        it('search bar is always visible on chats tab (no searchVisible gate)', () => {
            // On chats tab the ternary evaluates to `true`, so the search bar always shows
            const startIdx = source.indexOf("activeTab === 'tasks') ? searchVisible : true");
            const searchBarBlock = source.substring(startIdx, startIdx + 1200);
            expect(searchBarBlock).toContain('queue-search-input');
        });
    });

    describe('chatAllItems respects searchQuery', () => {
        it('chatAllItems uses filteredRunning instead of raw running', () => {
            const memo = source.substring(
                source.indexOf('chatAllItems = useMemo'),
                source.indexOf('chatAllItems = useMemo') + 400,
            );
            expect(memo).toContain('filteredRunning.filter(isChat)');
            expect(memo).not.toContain('running.filter(isChat)');
        });

        it('chatAllItems uses filteredHistory instead of raw history', () => {
            const memo = source.substring(
                source.indexOf('chatAllItems = useMemo'),
                source.indexOf('chatAllItems = useMemo') + 400,
            );
            expect(memo).toContain('filteredHistory.filter(isChat)');
            expect(memo).not.toContain('history.filter(isChat)');
        });

        it('chatAllItems useMemo dependencies include filteredRunning', () => {
            const depsLine = source.substring(
                source.indexOf('chatAllItems = useMemo'),
                source.indexOf('chatAllItems = useMemo') + 1500,
            );
            // Find the closing dependency array
            const closingIdx = depsLine.lastIndexOf('], [');
            const deps = depsLine.substring(closingIdx);
            expect(deps).toContain('filteredRunning');
        });

        it('chatAllItems useMemo dependencies include filteredHistory', () => {
            const depsLine = source.substring(
                source.indexOf('chatAllItems = useMemo'),
                source.indexOf('chatAllItems = useMemo') + 1500,
            );
            const closingIdx = depsLine.lastIndexOf('], [');
            const deps = depsLine.substring(closingIdx);
            expect(deps).toContain('filteredHistory');
        });
    });

    describe('search match count on chats tab', () => {
        it('shows chat-specific match count when on chats tab', () => {
            expect(source).toContain("activeTab === 'chats'");
            expect(source).toContain('chatAllItems.pinned.length + chatAllItems.unpinned.length + chatAllItems.archived.length');
        });

        it('renders search-match-count data-testid', () => {
            expect(source).toContain('data-testid="search-match-count"');
        });
    });

    describe('search-aware empty state', () => {
        it('renders chat-search-empty-state when search yields no results', () => {
            expect(source).toContain('data-testid="chat-search-empty-state"');
        });

        it('shows "No chats matching" message with query text', () => {
            expect(source).toContain("No chats matching");
            expect(source).toContain('{searchQuery}');
        });

        it('empty state checks all three sections are empty when search is active', () => {
            const emptyBlock = source.substring(
                source.indexOf('chat-search-empty-state') - 300,
                source.indexOf('chat-search-empty-state') + 50,
            );
            expect(emptyBlock).toContain('chatAllItems.unpinned.length === 0');
            expect(emptyBlock).toContain('chatAllItems.pinned.length === 0');
            expect(emptyBlock).toContain('chatAllItems.archived.length === 0');
            expect(emptyBlock).toContain('searchQuery');
        });

        it('generic empty state only shows when searchQuery is empty', () => {
            const genericEmpty = source.substring(
                source.indexOf('No chat sessions yet') - 200,
                source.indexOf('No chat sessions yet') + 30,
            );
            expect(genericEmpty).toContain('!searchQuery');
        });
    });

    describe('Ctrl+F activates search on chats tab', () => {
        it('Ctrl+F handler does not gate on activeTab', () => {
            const ctrlFBlock = source.substring(
                source.indexOf("e.key === 'f'") - 100,
                source.indexOf("e.key === 'f'") + 300,
            );
            // The Ctrl+F handler should set searchVisible and focus — no activeTab check
            expect(ctrlFBlock).toContain('setSearchVisible(true)');
            expect(ctrlFBlock).not.toContain("activeTab === 'tasks'");
        });
    });

    describe('close button behavior per tab', () => {
        it('close button only hides search bar on tasks tab', () => {
            const closeBlock = source.substring(
                source.indexOf('queue-search-close') - 200,
                source.indexOf('queue-search-close'),
            );
            expect(closeBlock).toContain("activeTab === 'tasks') setSearchVisible(false)");
        });
    });
});

describe('taskMatchesSearch unit tests', () => {
    it('returns true when query is empty', () => {
        expect(taskMatchesSearch({ displayName: 'Test' }, '')).toBe(true);
    });

    it('matches on displayName', () => {
        expect(taskMatchesSearch({ displayName: 'Fix login bug' }, 'login')).toBe(true);
        expect(taskMatchesSearch({ displayName: 'Fix login bug' }, 'signup')).toBe(false);
    });

    it('matches on title fallback', () => {
        expect(taskMatchesSearch({ title: 'Refactor auth' }, 'auth')).toBe(true);
    });

    it('matches on prompt field', () => {
        expect(taskMatchesSearch({ prompt: 'Explain the cache layer' }, 'cache')).toBe(true);
    });

    it('matches on payload.promptContent', () => {
        expect(taskMatchesSearch({ payload: { promptContent: 'Deploy to staging' } }, 'staging')).toBe(true);
    });

    it('matches on payload.prompt', () => {
        expect(taskMatchesSearch({ payload: { prompt: 'Run migrations' } }, 'migration')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(taskMatchesSearch({ displayName: 'Fix Login Bug' }, 'fix login')).toBe(true);
        expect(taskMatchesSearch({ displayName: 'FIX LOGIN BUG' }, 'fix login')).toBe(true);
    });

    it('returns false when neither title nor prompt match', () => {
        expect(taskMatchesSearch({ displayName: 'Deploy', prompt: 'Ship it' }, 'refactor')).toBe(false);
    });
});
