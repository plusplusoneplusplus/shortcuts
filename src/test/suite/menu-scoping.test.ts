/**
 * Tests for VS Code tree view context menu scoping.
 *
 * Validates that package.json menus configuration properly isolates
 * commands to their respective views, preventing cross-contamination
 * (e.g., Task Panel items appearing in AI Processes context menu).
 *
 * The key mechanisms:
 * 1. Every `view/item/context` entry must have a `view == <viewId>` clause.
 * 2. View-specific commands must be hidden from the command palette via
 *    `commandPalette` entries with `"when": "false"`.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * All tree view IDs defined in the extension
 */
const VIEW_IDS = [
    'tasksView',
    'clarificationProcessesView',
    'shortcutsView',
    'globalNotesView',
    'gitView',
    'pipelinesView',
    'markdownCommentsView',
    'debugPanelView',
];

/**
 * Map of command prefixes to the view they belong to
 */
const COMMAND_VIEW_MAP: Record<string, string> = {
    'tasksViewer.': 'tasksView',
    'clarificationProcesses.': 'clarificationProcessesView',
    'interactiveSessions.': 'clarificationProcessesView',
    'shortcuts.queue.': 'clarificationProcessesView',
    'gitView.': 'gitView',
    'gitDiffComments.': 'gitView',
    'pipelinesViewer.': 'pipelinesView',
    'markdownComments.': 'markdownCommentsView',
};

/**
 * Commands that are intentionally available in multiple views or globally
 * (e.g., review commands that work across views)
 */
const GLOBAL_COMMANDS = new Set([
    'shortcuts.reviewCommitAgainstRules',
    'shortcuts.reviewCommitAgainstRulesSelect',
    'shortcuts.reviewRangeAgainstRules',
    'shortcuts.reviewPendingAgainstRules',
    'shortcuts.reviewPendingAgainstRulesSelect',
    'shortcuts.reviewStagedAgainstRules',
    'shortcuts.reviewStagedAgainstRulesSelect',
    'markdownComments.openWithReviewEditor',
    'shortcuts.discovery.startForGroup',
]);

interface MenuEntry {
    command: string;
    when?: string;
    group?: string;
}

interface PackageJson {
    contributes: {
        commands: Array<{ command: string; title: string }>;
        menus: {
            'view/title'?: MenuEntry[];
            'view/item/context'?: MenuEntry[];
            'view/context'?: MenuEntry[];
            commandPalette?: MenuEntry[];
            'explorer/context'?: MenuEntry[];
        };
    };
}

function loadPackageJson(): PackageJson {
    const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
    const content = fs.readFileSync(pkgPath, 'utf8');
    return JSON.parse(content);
}

/**
 * Extract the view ID from a `when` clause string
 */
function extractViewFromWhen(when: string): string | null {
    const match = when.match(/view\s*==\s*(\w+)/);
    return match ? match[1] : null;
}

/**
 * Get the expected view for a command based on its prefix.
 *
 * Commands listed in GLOBAL_COMMANDS are intentionally scoped to multiple
 * views (or globally), so they are excluded from strict view assertions.
 */
function getExpectedView(command: string): string | null {
    if (GLOBAL_COMMANDS.has(command)) {
        return null;
    }

    for (const [prefix, view] of Object.entries(COMMAND_VIEW_MAP)) {
        if (command.startsWith(prefix)) {
            return view;
        }
    }
    return null;
}

suite('Menu Scoping Tests', () => {
    let pkg: PackageJson;

    suiteSetup(() => {
        pkg = loadPackageJson();
    });

    suite('view/item/context entries must have view constraint', () => {

        test('every view/item/context entry has a "when" clause', () => {
            const entries = pkg.contributes.menus['view/item/context'] || [];
            const missingWhen = entries.filter(e => !e.when);
            assert.strictEqual(
                missingWhen.length,
                0,
                `Found ${missingWhen.length} view/item/context entries without "when" clause: ${missingWhen.map(e => e.command).join(', ')}`
            );
        });

        test('every view/item/context entry includes a view == check', () => {
            const entries = pkg.contributes.menus['view/item/context'] || [];
            const missingView = entries.filter(e => {
                if (!e.when) { return true; }
                return !e.when.includes('view ==');
            });
            assert.strictEqual(
                missingView.length,
                0,
                `Found ${missingView.length} view/item/context entries without "view ==" in when clause: ${missingView.map(e => `${e.command} (when: ${e.when})`).join(', ')}`
            );
        });

        test('view/item/context entries reference valid view IDs', () => {
            const entries = pkg.contributes.menus['view/item/context'] || [];
            const invalidViews: string[] = [];
            for (const entry of entries) {
                if (!entry.when) { continue; }
                const viewId = extractViewFromWhen(entry.when);
                if (viewId && !VIEW_IDS.includes(viewId)) {
                    invalidViews.push(`${entry.command} references unknown view "${viewId}"`);
                }
            }
            assert.strictEqual(
                invalidViews.length,
                0,
                `Found entries referencing unknown views:\n${invalidViews.join('\n')}`
            );
        });

        test('commands are scoped to their expected view', () => {
            const entries = pkg.contributes.menus['view/item/context'] || [];
            const misscoped: string[] = [];
            for (const entry of entries) {
                if (!entry.when) { continue; }
                const expectedView = getExpectedView(entry.command);
                if (!expectedView) { continue; } // Skip commands without a known prefix
                const actualView = extractViewFromWhen(entry.when);
                if (actualView !== expectedView) {
                    misscoped.push(
                        `${entry.command}: expected view "${expectedView}", found "${actualView}" in when: "${entry.when}"`
                    );
                }
            }
            assert.strictEqual(
                misscoped.length,
                0,
                `Found commands scoped to wrong view:\n${misscoped.join('\n')}`
            );
        });
    });

    suite('view/title entries must have view constraint', () => {

        test('every view/title entry has a "when" clause with view ==', () => {
            const entries = pkg.contributes.menus['view/title'] || [];
            const missingView = entries.filter(e => {
                if (!e.when) { return true; }
                return !e.when.includes('view ==');
            });
            assert.strictEqual(
                missingView.length,
                0,
                `Found ${missingView.length} view/title entries without "view ==" in when clause: ${missingView.map(e => `${e.command} (when: ${e.when})`).join(', ')}`
            );
        });
    });

    suite('commandPalette hides view-specific commands', () => {

        test('commandPalette section exists', () => {
            assert.ok(
                pkg.contributes.menus.commandPalette,
                'Missing commandPalette section in menus - view-specific commands may leak into other views'
            );
        });

        test('all tasksViewer commands are hidden from command palette', () => {
            const paletteEntries = pkg.contributes.menus.commandPalette || [];
            const paletteCommands = new Set(paletteEntries.map(e => e.command));

            const viewItemEntries = pkg.contributes.menus['view/item/context'] || [];
            const viewTitleEntries = pkg.contributes.menus['view/title'] || [];

            // Get unique tasksViewer commands from view/item/context and view/title
            const taskCommands = new Set<string>();
            for (const entry of [...viewItemEntries, ...viewTitleEntries]) {
                if (entry.command.startsWith('tasksViewer.')) {
                    taskCommands.add(entry.command);
                }
            }

            const missingFromPalette: string[] = [];
            for (const cmd of taskCommands) {
                if (!paletteCommands.has(cmd)) {
                    missingFromPalette.push(cmd);
                }
            }

            assert.strictEqual(
                missingFromPalette.length,
                0,
                `Task commands missing from commandPalette (will leak into other views):\n${missingFromPalette.join('\n')}`
            );
        });

        test('all clarificationProcesses commands are hidden from command palette', () => {
            const paletteEntries = pkg.contributes.menus.commandPalette || [];
            const paletteCommands = new Set(paletteEntries.map(e => e.command));

            const viewItemEntries = pkg.contributes.menus['view/item/context'] || [];

            const aiCommands = new Set<string>();
            for (const entry of viewItemEntries) {
                if (entry.command.startsWith('clarificationProcesses.') ||
                    entry.command.startsWith('interactiveSessions.') ||
                    entry.command.startsWith('shortcuts.queue.')) {
                    aiCommands.add(entry.command);
                }
            }

            const missingFromPalette: string[] = [];
            for (const cmd of aiCommands) {
                if (!paletteCommands.has(cmd)) {
                    missingFromPalette.push(cmd);
                }
            }

            assert.strictEqual(
                missingFromPalette.length,
                0,
                `AI Process commands missing from commandPalette (will leak into other views):\n${missingFromPalette.join('\n')}`
            );
        });

        test('all gitView commands are hidden from command palette', () => {
            const paletteEntries = pkg.contributes.menus.commandPalette || [];
            const paletteCommands = new Set(paletteEntries.map(e => e.command));

            const viewItemEntries = pkg.contributes.menus['view/item/context'] || [];

            const gitCommands = new Set<string>();
            for (const entry of viewItemEntries) {
                if (entry.command.startsWith('gitView.') ||
                    entry.command.startsWith('gitDiffComments.')) {
                    gitCommands.add(entry.command);
                }
            }

            const missingFromPalette: string[] = [];
            for (const cmd of gitCommands) {
                if (!paletteCommands.has(cmd)) {
                    missingFromPalette.push(cmd);
                }
            }

            assert.strictEqual(
                missingFromPalette.length,
                0,
                `Git commands missing from commandPalette (will leak into other views):\n${missingFromPalette.join('\n')}`
            );
        });

        test('all pipelinesViewer commands are hidden from command palette', () => {
            const paletteEntries = pkg.contributes.menus.commandPalette || [];
            const paletteCommands = new Set(paletteEntries.map(e => e.command));

            const viewItemEntries = pkg.contributes.menus['view/item/context'] || [];

            const pipelineCommands = new Set<string>();
            for (const entry of viewItemEntries) {
                if (entry.command.startsWith('pipelinesViewer.')) {
                    pipelineCommands.add(entry.command);
                }
            }

            const missingFromPalette: string[] = [];
            for (const cmd of pipelineCommands) {
                if (!paletteCommands.has(cmd)) {
                    missingFromPalette.push(cmd);
                }
            }

            assert.strictEqual(
                missingFromPalette.length,
                0,
                `Pipeline commands missing from commandPalette (will leak into other views):\n${missingFromPalette.join('\n')}`
            );
        });

        test('all commandPalette entries have "when": "false"', () => {
            const paletteEntries = pkg.contributes.menus.commandPalette || [];
            const wrongWhen = paletteEntries.filter(e => e.when !== 'false');
            assert.strictEqual(
                wrongWhen.length,
                0,
                `Found commandPalette entries without "when": "false": ${wrongWhen.map(e => `${e.command} (when: ${e.when})`).join(', ')}`
            );
        });

        test('commandPalette entries reference valid commands', () => {
            const paletteEntries = pkg.contributes.menus.commandPalette || [];
            const definedCommands = new Set(
                pkg.contributes.commands.map(c => c.command)
            );

            const invalidCommands = paletteEntries.filter(
                e => !definedCommands.has(e.command)
            );

            assert.strictEqual(
                invalidCommands.length,
                0,
                `Found commandPalette entries for undefined commands: ${invalidCommands.map(e => e.command).join(', ')}`
            );
        });
    });

    suite('No cross-view context value collisions', () => {

        /**
         * AI Process contextValue prefixes
         */
        const AI_PROCESS_PREFIXES = [
            'clarificationProcess_',
            'codeReviewProcess_',
            'codeReviewGroupProcess_',
            'pipelineExecutionProcess_',
            'pipelineItemProcess_',
            'discoveryProcess_',
            'interactiveSession_',
            'interactiveSessionSection',
            'queuedTask_',
            'queuedTasksSection',
        ];

        /**
         * Task Panel contextValue prefixes
         */
        const TASK_PREFIXES = [
            'task',
            'taskFolder',
            'taskDocument',
            'archivedTask',
            'relatedItemsSection',
            'relatedFile',
            'relatedCommit',
        ];

        test('AI Process contextValue prefixes do not start with task prefixes', () => {
            const collisions: string[] = [];
            for (const aiPrefix of AI_PROCESS_PREFIXES) {
                for (const taskPrefix of TASK_PREFIXES) {
                    if (aiPrefix.startsWith(taskPrefix) || taskPrefix.startsWith(aiPrefix)) {
                        collisions.push(`AI "${aiPrefix}" collides with Task "${taskPrefix}"`);
                    }
                }
            }
            assert.strictEqual(
                collisions.length,
                0,
                `Found contextValue prefix collisions:\n${collisions.join('\n')}`
            );
        });

        test('viewItem regex patterns in task entries do not match AI process values', () => {
            // Task entries use patterns like /^task/, /^taskFolder/, /^taskDocument/
            // AI process values start with clarificationProcess_, codeReviewProcess_, etc.
            const taskPatterns = [/^task/, /^taskFolder/, /^taskDocument/, /^archivedTask/];
            const aiValues = [
                'clarificationProcess_running',
                'clarificationProcess_completed',
                'codeReviewProcess_running',
                'codeReviewGroupProcess_completed',
                'pipelineExecutionProcess_running',
                'discoveryProcess_completed',
                'interactiveSession_active',
                'queuedTask_high',
            ];

            const matches: string[] = [];
            for (const pattern of taskPatterns) {
                for (const value of aiValues) {
                    if (pattern.test(value)) {
                        matches.push(`Pattern ${pattern} matches AI value "${value}"`);
                    }
                }
            }

            assert.strictEqual(
                matches.length,
                0,
                `Task viewItem patterns accidentally match AI process values:\n${matches.join('\n')}`
            );
        });

        test('viewItem regex patterns in AI entries do not match task values', () => {
            const aiPatterns = [
                /^clarificationProcess_/,
                /^codeReviewProcess_/,
                /^codeReviewGroupProcess_/,
                /^pipelineExecutionProcess_/,
                /^pipelineItemProcess_/,
                /^discoveryProcess_/,
                /^interactiveSession_/,
                /^queuedTask_/,
            ];
            const taskValues = [
                'task',
                'task_future',
                'task_inProgress',
                'task_done',
                'task_reviewed',
                'taskFolder',
                'taskFolder_archived',
                'taskDocument',
                'archivedTask',
                'relatedItemsSection',
            ];

            const matches: string[] = [];
            for (const pattern of aiPatterns) {
                for (const value of taskValues) {
                    if (pattern.test(value)) {
                        matches.push(`Pattern ${pattern} matches Task value "${value}"`);
                    }
                }
            }

            assert.strictEqual(
                matches.length,
                0,
                `AI viewItem patterns accidentally match Task values:\n${matches.join('\n')}`
            );
        });
    });

    suite('Shortcuts view commands are hidden from command palette', () => {

        test('all shortcuts view-specific commands are hidden', () => {
            const paletteEntries = pkg.contributes.menus.commandPalette || [];
            const paletteCommands = new Set(paletteEntries.map(e => e.command));

            const viewItemEntries = pkg.contributes.menus['view/item/context'] || [];

            // Get shortcuts view commands (those with view == shortcutsView)
            const shortcutsCommands = new Set<string>();
            for (const entry of viewItemEntries) {
                if (entry.when?.includes('view == shortcutsView')) {
                    shortcutsCommands.add(entry.command);
                }
            }

            const missingFromPalette: string[] = [];
            for (const cmd of shortcutsCommands) {
                if (!paletteCommands.has(cmd)) {
                    missingFromPalette.push(cmd);
                }
            }

            assert.strictEqual(
                missingFromPalette.length,
                0,
                `Shortcuts commands missing from commandPalette:\n${missingFromPalette.join('\n')}`
            );
        });
    });

    suite('markdownComments view commands are hidden from command palette', () => {

        test('all markdownComments view-specific commands are hidden', () => {
            const paletteEntries = pkg.contributes.menus.commandPalette || [];
            const paletteCommands = new Set(paletteEntries.map(e => e.command));

            const viewItemEntries = pkg.contributes.menus['view/item/context'] || [];

            const mdCommands = new Set<string>();
            for (const entry of viewItemEntries) {
                if (entry.when?.includes('view == markdownCommentsView')) {
                    mdCommands.add(entry.command);
                }
            }

            const missingFromPalette: string[] = [];
            for (const cmd of mdCommands) {
                if (!paletteCommands.has(cmd)) {
                    missingFromPalette.push(cmd);
                }
            }

            assert.strictEqual(
                missingFromPalette.length,
                0,
                `Markdown comments commands missing from commandPalette:\n${missingFromPalette.join('\n')}`
            );
        });
    });
});
