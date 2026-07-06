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

    function getSourceBlock(startNeedle: string, endNeedle: string): string {
        const start = source.indexOf(startNeedle);
        expect(start).toBeGreaterThan(-1);
        const end = source.indexOf(endNeedle, start + startNeedle.length);
        expect(end).toBeGreaterThan(start);
        return source.substring(start, end);
    }

    function getBulkContextMenuBlock(): string {
        return getSourceBlock('if (contextMenu.bulkIds)', "if (taskStatus === 'running')");
    }

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

        it('marks pinned rows with the data-pinned attribute', () => {
            // The compact row computes the attribute conditionally; check the JSX expression.
            expect(source).toContain("data-pinned={isPinned ? 'true' : undefined}");
        });

        it('uses showPinned state for collapsing', () => {
            expect(source).toContain('showPinned');
            expect(source).toContain('setShowPinned');
        });

        it('renders the pinned section header with the label "Pinned"', () => {
            // The redesigned sticky header drops the 📌 emoji in favor of a small status dot.
            const pinnedSection = source.substring(
                source.indexOf('data-section="pinned"'),
                source.indexOf('data-section="pinned"') + 1500,
            );
            expect(pinnedSection).toContain('Pinned');
        });
    });

    describe('filtered split of history', () => {
        it('computes filteredPinned from history', () => {
            expect(source).toContain('filteredPinned');
        });

        it('computes filteredUnpinned from history', () => {
            expect(source).toContain('filteredUnpinned');
        });

        it('uses activityCompletedEntries for the completed tasks section', () => {
            const historySection = getSourceBlock('data-section="completed"', 'data-section={`completed-${section.id}`}');
            expect(historySection).toContain('activityCompletedEntries');
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
        it('compact row passes a row-level title attribute on the container', () => {
            // The unified row sets a `title` attribute on the container <div>; this
            // provides the native browser tooltip for truncated content across pinned /
            // unpinned / archived sections, and replaces the per-section title attributes
            // the old Card-based layout used. The tooltip text is derived inside the row
            // renderer (it may be augmented when the task is awaiting user input) so the
            // test asserts both the binding and the underlying source of the text.
            expect(source).toContain('title={sessionContextPayload ? `${rowTitle} — drag to attach as session context` : rowTitle}');
            expect(source).toContain('const rowTitle = ');
            expect(source).toContain('titleText');
        });

        it('compact row also sets title={titleText} on the truncated title span', () => {
            // The inner span carries the chat-title class and the truncate utility;
            // the title text is rendered inside it.
            expect(source).toContain("'chat-title truncate text-[#1e1e1e] dark:text-[#cccccc] cursor-text select-none'");
        });

        it('QueueTaskItem task name has title attribute', () => {
            expect(source).toContain('title={name}>{name}');
        });

        it('QueueTaskItem prompt preview has title attribute', () => {
            expect(source).toContain('title={promptPreview}>{promptPreview}');
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

            it('marks archived rows with the data-archived attribute', () => {
                expect(source).toContain("data-archived={isArchived ? 'true' : undefined}");
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

        it('deletes chat history through the typed client', () => {
            // AC-07: ChatListPane routes through the clone-aware client (useCocClient).
            expect(source).toContain('cloneClient.workspaces.deleteHistory');
            expect(source).toContain('cloneClient.queue.deleteHistoryEntry');
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

        it('passes pinnedChatIds membership through the unified row renderer', () => {
            // The redesigned compact row consumes pinnedChatIds inside renderChatListRow
            // (used for both pinned-row indicators and pinned/unpinned/running rows).
            expect(source).toContain('pinnedChatIds?.has(task.id)');
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
            expect(source).toContain('pinnedActivityEntries.length > 0 || pinnedRunningCount > 0');
        });

        it('pinned section count includes pinnedRunningCount', () => {
            expect(source).toContain('pinnedActivityEntries.length + pinnedRunningCount');
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
            const bulkBlock = getBulkContextMenuBlock();
            expect(bulkBlock).toContain("ids.length === 1 ? 'Summarize chat'");
        });

        it('bulk context menu branch checks for bulkIds', () => {
            expect(source).toContain('contextMenu.bulkIds');
        });

        it('bulk context menu shows count header', () => {
            expect(source).toContain('`${ids.length} tasks selected`');
        });

        it('bulk context menu shows Mark as Read when any unseen', () => {
            const bulkBlock = getBulkContextMenuBlock();
            expect(bulkBlock).toContain("'Mark as Read'");
            expect(bulkBlock).toContain('anyUnseen');
        });

        it('bulk context menu shows Mark as Unread when any seen', () => {
            const bulkBlock = getBulkContextMenuBlock();
            expect(bulkBlock).toContain("'Mark as Unread'");
            expect(bulkBlock).toContain('anySeen');
        });

        it('bulk context menu shows Pin to top when any unpinned', () => {
            const bulkBlock = getBulkContextMenuBlock();
            expect(bulkBlock).toContain("'Pin to top'");
            expect(bulkBlock).toContain('anyUnpinned');
        });

        it('bulk context menu shows Unpin when any pinned', () => {
            const bulkBlock = getBulkContextMenuBlock();
            expect(bulkBlock).toContain("'Unpin'");
            expect(bulkBlock).toContain('anyPinned');
        });

        it('bulk context menu shows Archive when any unarchived', () => {
            const bulkBlock = getBulkContextMenuBlock();
            expect(bulkBlock).toContain("'Archive'");
            expect(bulkBlock).toContain('anyUnarchived');
        });

        it('bulk context menu shows Unarchive when any archived', () => {
            const bulkBlock = getBulkContextMenuBlock();
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
                const bulkBlock = getBulkContextMenuBlock();
                expect(bulkBlock).toContain('Summarize');
                expect(bulkBlock).toContain("'Summarize chat'");
                expect(bulkBlock).toContain('`Summarize ${ids.length} chats`');
            });

            it('summarize uses the typed queue summarize client', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('cloneClient.queue.summarize');
            });

            it('summarize sends processIds and workspaceId in body', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('processIds: summarizeDialogIds');
                expect(block).toContain('workspaceId');
            });

            it('summarize inherits Lens Chat mode from the shared Lens flag', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('isCommitChatLensEnabled()');
                expect(block).toContain("lensChat: { inherited: true, source: 'features.commitChatLens' }");
                expect(source).not.toContain('notesLensChat');
            });

            it('summarize is capped at 20 items', () => {
                const bulkBlock = getBulkContextMenuBlock();
                expect(bulkBlock).toContain('ids.length <= 20');
            });

            it('summarize uses 📝 icon', () => {
                const bulkBlock = getBulkContextMenuBlock();
                expect(bulkBlock).toContain('📝');
            });

            it('summarize navigates to new task via onSelectTask', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('onSelectTask(data.taskId)');
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

            it('summarize delegates POST serialization to the typed client', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('cloneClient.queue.summarize');
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

            it('summarize passes request data to the typed client', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('processIds: summarizeDialogIds');
            });

            it('summarize sends optional user prompt through the typed client', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('userPrompt: userPrompt || undefined');
            });

            it('summarize relies on typed client errors before navigating', () => {
                const dialogIdx = source.indexOf('<SummarizeChatDialog');
                expect(dialogIdx).toBeGreaterThan(-1);
                const block = source.substring(dialogIdx, dialogIdx + 1500);
                expect(block).toContain('if (data.taskId)');
            });
        });
    });

    describe('mark-all-read button mobile visibility', () => {
        it('completed tasks header row uses flex-wrap so mark-all-read wraps on narrow screens', () => {
            // The header row div uses flex-wrap to prevent clipping the button on mobile viewports.
            expect(source).toContain('flex flex-wrap items-center gap-1.5');
        });

        it('completed tasks header uses single-line tracking and tabular-nums for the count', () => {
            // The redesigned sticky header replaces the min-w-0 truncation pattern with a
            // tracking-[0.1em] mono uppercase label on the left and a tabular-nums count
            // pill on the right. The label cannot push the count off-screen because the
            // count lives in a separate flex item.
            const idx = source.indexOf('data-section="completed"');
            expect(idx).toBeGreaterThan(-1);
            const completedSection = source.substring(idx, idx + 2000);
            expect(completedSection).toContain("tracking-[0.1em]");
            expect(completedSection).toContain('tabular-nums');
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
                source.indexOf('running-tasks-section-toggle') + 600,
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
                source.indexOf('queued-tasks-section-toggle') + 600,
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
                source.indexOf("e.key === 'f'") + 600,
            );
            expect(handler).toContain('e.preventDefault()');
        });

        it('sets searchVisible to true on Ctrl+F', () => {
            const handler = source.substring(
                source.indexOf("e.key === 'f'"),
                source.indexOf("e.key === 'f'") + 600,
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
                source.indexOf("e.key === 'f'") + 600,
            );
            expect(handler).toContain('if (detailPaneFocusedRef.current) return');
            // The ref check must come before preventDefault
            const refIdx = handler.indexOf('detailPaneFocusedRef.current');
            const preventIdx = handler.indexOf('e.preventDefault()');
            expect(refIdx).toBeLessThan(preventIdx);
        });

        it('bails out when container is hidden (offsetParent === null)', () => {
            const handler = source.substring(
                source.indexOf("e.key === 'f'"),
                source.indexOf("e.key === 'f'") + 600,
            );
            // Visibility guard must appear before preventDefault
            expect(handler).toContain('containerRef.current.offsetParent === null');
            const visIdx = handler.indexOf('offsetParent === null');
            const preventIdx = handler.indexOf('e.preventDefault()');
            expect(visIdx).toBeLessThan(preventIdx);
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

        it('clears the search query on ✕ button click', () => {
            // The redesigned activity-compact list keeps the search bar always
            // visible (matching the reference UI), so the close button only
            // clears the query — it no longer hides the bar.
            const closeBtnIdx = source.indexOf('queue-search-close');
            const closeBtn = source.substring(closeBtnIdx - 200, closeBtnIdx + 50);
            expect(closeBtn).toContain("setSearchQuery('')");
        });

        it('shows match count when searchQuery is non-empty', () => {
            // Activity branch uses a ternary to render either the kbd hint or
            // the count + close cluster, so this exact prefix no longer exists.
            // Instead assert that the count branch (`searchQuery`) renders the
            // tabular-nums match count span.
            expect(source).toContain('text-[#848484] tabular-nums text-[10px]');
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

        it('encodes failed status via the row dot (red) instead of an inline ❌ glyph', () => {
            // The redesigned compact list represents status entirely via the colored
            // status dot — failed rows use bg-red-500. The inline ❌ status emoji is
            // gone from the chat-list rows.
            expect(source).toContain("'failed'");
            expect(source).toContain('bg-red-500');
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
            // The thinking indicator is rendered inside an `isRunning ? … : timeText` ternary
            // in the timestamp span. The inner branch may further split between the
            // awaiting-input indicator and the default thinking indicator, so the test
            // only requires that the indicator follows an `isRunning ?` opening.
            const thinkingIdx = source.indexOf('data-testid="thinking-indicator"');
            expect(thinkingIdx).toBeGreaterThanOrEqual(0);
            const before = source.substring(Math.max(0, thinkingIdx - 800), thinkingIdx);
            expect(before).toMatch(/isRunning\s*\?/);
        });

        it('thinking indicator is NOT rendered as a separate element before the title', () => {
            // Should not have the old pattern: {isRunning && <span ... data-testid="thinking-indicator">
            expect(source).not.toContain('{isRunning && <span');
        });

        it('failed state is computed and reflected in row styling (not running)', () => {
            // The redesigned chats list collapses pinned/unpinned/today/etc. through
            // a single renderChatListRow callback, which derives an `isFailed` flag
            // from the running/failed status pair instead of inlining the JSX guard.
            expect(source).toContain("isFailed = !isRunning && task.status === 'failed'");
        });

        it('renders a single thinking-indicator template via the shared row renderer', () => {
            // Pinned, today, this-week, older, and search-result rows all flow through
            // renderChatListRow, so the source contains exactly one occurrence of the
            // indicator template that gets reused across sections.
            const matches = source.match(/data-testid="thinking-indicator"/g);
            expect(matches).not.toBeNull();
            // Allow for the queue-tab pinned section also rendering one copy in addition
            // to the chats-tab shared row renderer (>= 1 to be future-proof).
            expect(matches!.length).toBeGreaterThanOrEqual(1);
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

    describe('filter dropdown removed', () => {
        // The activity-compact action bar surfaces chats vs automations through
        // the scope segmented control instead of a type-filter dropdown. The
        // legacy `queue-filter-dropdown`, `availableFilters`, and the
        // `setExcludedTypes` dispatch path are gone.
        it('does not render the legacy queue-filter-dropdown', () => {
            expect(source).not.toContain('data-testid="queue-filter-dropdown"');
        });

        it('does not render the legacy queue-filter-pills row', () => {
            expect(source).not.toContain('data-testid="queue-filter-pills"');
        });

        it('does not render legacy queue-filter-reset button', () => {
            expect(source).not.toContain('data-testid="queue-filter-reset"');
        });

        it('no longer imports the FilterDropdown component', () => {
            expect(source).not.toContain('FilterDropdown,');
            expect(source).not.toContain('FilterDropdown }');
            expect(source).not.toContain('<FilterDropdown');
        });

        it('does not declare the unused availableFilters memo', () => {
            expect(source).not.toContain('availableFilters = useMemo');
        });

        it('does not dispatch SET_MY_WORK_EXCLUDED_TYPES from this pane', () => {
            // The dropdown was the sole writer of this action. Server-managed
            // filters (via SET_WELCOME_PREFERENCES) still apply read-only.
            expect(source).not.toContain('SET_MY_WORK_EXCLUDED_TYPES');
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
        expect(taskMatchesFilter(chatPlan, excluded)).toBe(false);
    });

    it('excludes multiple types simultaneously', () => {
        const excluded = new Set(['run-workflow', 'run-script']);
        expect(taskMatchesFilter(workflow, excluded)).toBe(false);
        expect(taskMatchesFilter(script, excluded)).toBe(false);
        expect(taskMatchesFilter(chatAsk, excluded)).toBe(true);
    });

    it('excludes legacy plan chats through the ask mode key', () => {
        const excluded = new Set(['ask']);
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

    describe('running tasks — context menu wired', () => {
        it('routes running rows through the unified context-menu helper', () => {
            // The redesigned compact row dispatches running-row right-clicks through
            // handleTaskContextMenu(e, task.id, 'running'); long-press still works via
            // the shared touch handlers attached to the row.
            expect(source).toContain("handleTaskContextMenu(e, task.id, contextMenuKind)");
        });
    });

    describe('queued tasks — drag-drop preserved on the wrapper element', () => {
        it('renders queued rows through the shared compact-row renderer', () => {
            // Each queued task is wrapped in a draggable <div> that delegates rendering to
            // the unified renderChatListRow with taskStatus='queued'. Drag/drop and
            // pause-marker insertion are preserved on the wrapper.
            expect(source).toContain("renderChatListRow(item, visibleTabFilteredQueued, { taskStatus: 'queued' })");
        });

        it('preserves the activeDraggedTaskId opacity-40 affordance on the wrapper', () => {
            expect(source).toContain('activeDraggedTaskId === item.id && \'opacity-40\'');
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

        it('wires onTouchStart on the unified compact row', () => {
            // The compact-row renderer is the single source of touch wiring across
            // pinned / unpinned / archived / running / completed sections.
            expect(source).toContain('historyLongPress.onTouchStart(e);');
        });

        it('wires onTouchEnd (cancel) on the unified compact row', () => {
            expect(source).toContain('onTouchEnd={historyLongPress.onTouchEnd}');
        });

        it('wires onTouchMove on the unified compact row', () => {
            expect(source).toContain('onTouchMove={historyLongPress.onTouchMove}');
        });

        it('suppresses onClick when long press fired', () => {
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

    it('toolbar new-chat button is present in queue toolbar', () => {
        expect(source).toContain('data-testid="toolbar-new-chat-btn"');
    });

    it('toolbar new-chat button reuses onNewChat callback', () => {
        // The toolbar button should use the same onNewChat ?? onOpenDialog handler
        const matches = source.match(/onNewChat \?\? onOpenDialog/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('toolbar new-chat button always shows the "New chat" label (primary CTA)', () => {
        // The activity-compact action bar treats the New chat button as the
        // primary, flex-grow CTA — so the label is always visible (no
        // responsive hiding) and a platform-aware kbd hint is shown next to it.
        // AC-01 makes the button a drop target: the label span swaps to a drop
        // hint while a context drag is over it, so the default label lives in the
        // "New chat" branch of that ternary rather than as inline span text.
        expect(source).toContain('className="flex-1 text-left truncate"');
        expect(source).toContain("'New chat'");
        expect(source).toContain('newChatKbdLabel');
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

    it('supports Shift+Tab mode cycling and imports cycleMode', () => {
        expect(source).toContain('cycleMode');
        expect(source).toContain('Shift');
    });

    it('defaults mode to ask and sends mode in the task payload', () => {
        expect(source).toContain("const [selectedMode, setSelectedMode] = useState<ChatMode>('ask')");
        // InitialChatComposer derives the submitted mode from selectedMode (with workflow aliasing),
        // then NewChatArea enqueues that submitted mode in the task payload.
        expect(source).toMatch(/onSubmit\(\{[\s\S]*mode,/);
        expect(source).toContain('mode: submission.mode as any');
    });

    it('still renders Start a new conversation hero text', () => {
        expect(source).toContain('Start a new conversation');
    });

    it('still renders the send input', () => {
        expect(source).toContain("testIdPrefix = 'new-chat'");
        expect(source).toContain('data-testid={`${testIdPrefix}-input`}');
        expect(source).toContain('data-testid={`${testIdPrefix}-send-btn`}');
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

        it('search bar is always visible on every tab (no searchVisible gate)', () => {
            // The activity-compact reference shows the search input as a permanent
            // part of the toolbar, so the per-tab `searchVisible` gate has been
            // removed entirely. The chats branch and activity branch each render
            // their own permanent search input.
            expect(source).not.toContain("activeTab === 'tasks') ? searchVisible : true");
            expect(source).toContain('Search bar — always visible');
        });

        it('search bar is always visible on chats tab', () => {
            // The chats-tab search input lives inside the `activeTab === \'chats\'`
            // branch and is unconditionally rendered.
            expect(source).toContain('data-testid="queue-search-input"');
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

        it('empty state guards on the visible-items list when search is active', () => {
            // After the chats-tab redesign, pinned/unpinned/archived rows are merged
            // into a single time-bucketed structure (`chatGroups.flatVisible`). The
            // empty-state guard now checks that flattened list together with the
            // current search query.
            const emptyBlock = source.substring(
                source.indexOf('chat-search-empty-state') - 300,
                source.indexOf('chat-search-empty-state') + 50,
            );
            expect(emptyBlock).toContain('chatGroups.flatVisible.length === 0');
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
                source.indexOf("e.key === 'f'") + 600,
            );
            // The Ctrl+F handler should set searchVisible and focus — no activeTab check
            expect(ctrlFBlock).toContain('setSearchVisible(true)');
            expect(ctrlFBlock).not.toContain("activeTab === 'tasks'");
        });
    });

    describe('close button behavior per tab', () => {
        it('close button never hides the always-visible search bar', () => {
            // The activity-compact reference keeps the search bar always visible,
            // so neither branch's close button toggles the legacy `searchVisible`
            // gate from inside its onClick handler.
            const activityCloseIdx = source.indexOf('queue-search-close');
            const chatsCloseIdx = source.indexOf('chat-search-close');
            const activityClose = source.substring(activityCloseIdx - 200, activityCloseIdx);
            const chatsClose = source.substring(chatsCloseIdx - 200, chatsCloseIdx);
            expect(activityClose).not.toContain('setSearchVisible(false)');
            expect(chatsClose).not.toContain('setSearchVisible(false)');
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
