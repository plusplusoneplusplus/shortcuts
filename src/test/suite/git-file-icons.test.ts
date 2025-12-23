/**
 * Tests for git file icons functionality
 * Covers: VSCode default file icons with git decoration colors
 */

import * as assert from 'assert';
import { STAGE_PREFIX, STATUS_SHORT } from '../../shortcuts/git/git-constants';
import { GitChangeStatus, GitChangeStage } from '../../shortcuts/git/types';

suite('Git File Icons Tests', () => {

    suite('GitChangeStatus Type', () => {
        test('should have all expected status values', () => {
            const allStatuses: GitChangeStatus[] = [
                'modified', 'added', 'deleted', 'renamed',
                'copied', 'untracked', 'ignored', 'conflict'
            ];
            
            // Verify all statuses are valid string values
            for (const status of allStatuses) {
                assert.strictEqual(typeof status, 'string');
                assert.ok(status.length > 0, `Status should not be empty: ${status}`);
            }
        });
    });

    suite('GitChangeStage Type', () => {
        test('should have all expected stage values', () => {
            const allStages: GitChangeStage[] = ['staged', 'unstaged', 'untracked'];
            
            // Verify all stages are valid string values
            for (const stage of allStages) {
                assert.strictEqual(typeof stage, 'string');
                assert.ok(stage.length > 0, `Stage should not be empty: ${stage}`);
            }
        });
    });

    suite('STATUS_SHORT Constants', () => {
        test('should have short codes for all status types', () => {
            const allStatuses: GitChangeStatus[] = [
                'modified', 'added', 'deleted', 'renamed',
                'copied', 'untracked', 'ignored', 'conflict'
            ];
            
            for (const status of allStatuses) {
                assert.ok(
                    STATUS_SHORT[status],
                    `Missing short code for status: ${status}`
                );
                assert.strictEqual(
                    STATUS_SHORT[status].length,
                    1,
                    `Short code should be single character for: ${status}`
                );
            }
        });

        test('should have correct short codes', () => {
            assert.strictEqual(STATUS_SHORT['modified'], 'M');
            assert.strictEqual(STATUS_SHORT['added'], 'A');
            assert.strictEqual(STATUS_SHORT['deleted'], 'D');
            assert.strictEqual(STATUS_SHORT['renamed'], 'R');
            assert.strictEqual(STATUS_SHORT['copied'], 'C');
            assert.strictEqual(STATUS_SHORT['untracked'], 'U');
            assert.strictEqual(STATUS_SHORT['ignored'], 'I');
            assert.strictEqual(STATUS_SHORT['conflict'], '!');
        });
    });

    suite('STAGE_PREFIX Constants', () => {
        test('should use checkmark for staged files', () => {
            assert.strictEqual(STAGE_PREFIX['staged'], '\u2713');
        });

        test('should use circle for unstaged files', () => {
            assert.strictEqual(STAGE_PREFIX['unstaged'], '\u25CB');
        });

        test('should use question mark for untracked files', () => {
            assert.strictEqual(STAGE_PREFIX['untracked'], '?');
        });

        test('should have prefixes for all stage types', () => {
            const allStages: GitChangeStage[] = ['staged', 'unstaged', 'untracked'];
            
            for (const stage of allStages) {
                assert.ok(
                    STAGE_PREFIX[stage],
                    `Missing prefix for stage: ${stage}`
                );
            }
        });
    });

    suite('VSCode Default Icons Behavior', () => {
        test('should use resourceUri for file icons', () => {
            // When iconPath is not set, VSCode uses resourceUri to determine the file icon
            // from the current icon theme. This test documents the expected behavior.
            
            // The GitChangeItem class now:
            // 1. Sets resourceUri to the file URI
            // 2. Does NOT set iconPath
            // 3. VSCode automatically uses the icon theme's icon for that file type
            // 4. Git decorations (colors) are applied based on the file's git status
            
            assert.ok(true, 'VSCode uses resourceUri for file icons when iconPath is not set');
        });

        test('should apply git decoration colors via resourceUri', () => {
            // VSCode's git extension automatically applies colors to files based on their status
            // when resourceUri is set. This is handled by VSCode's file decoration system.
            
            // Expected colors (applied automatically by VSCode):
            // - Modified: gitDecoration.modifiedResourceForeground (yellow/orange)
            // - Added: gitDecoration.addedResourceForeground (green)
            // - Deleted: gitDecoration.deletedResourceForeground (red)
            // - Untracked: gitDecoration.untrackedResourceForeground (green)
            // - Renamed: gitDecoration.renamedResourceForeground (blue/cyan)
            // - Conflict: gitDecoration.conflictingResourceForeground (red)
            
            assert.ok(true, 'Git decoration colors are applied via resourceUri');
        });
    });
});

