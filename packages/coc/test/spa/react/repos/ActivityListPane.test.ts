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
});
