/**
 * Tests for Commit Removal from Logical Groups
 * 
 * Tests the functionality for removing git commits from logical groups.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { ShortcutsConfig, LogicalGroup, LogicalGroupItem } from '../../shortcuts/types';

suite('Commit Removal from Logical Groups', () => {
    let tempDir: string;
    let configManager: ConfigurationManager;
    let originalShowWarningMessage: any;
    let originalShowErrorMessage: any;
    let originalShowInfoMessage: any;
    let warningMessages: string[];
    let errorMessages: string[];
    let infoMessages: string[];

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-commit-test-'));
        
        // Pre-create empty config so tests start with a clean slate
        const vscodePath = path.join(tempDir, '.vscode');
        fs.mkdirSync(vscodePath, { recursive: true });
        fs.writeFileSync(path.join(vscodePath, 'shortcuts.yaml'), 'logicalGroups: []\n');
        
        configManager = new ConfigurationManager(tempDir);

        // Mock vscode.window methods to capture messages
        warningMessages = [];
        errorMessages = [];
        infoMessages = [];

        originalShowWarningMessage = vscode.window.showWarningMessage;
        originalShowErrorMessage = vscode.window.showErrorMessage;
        originalShowInfoMessage = vscode.window.showInformationMessage;

        vscode.window.showWarningMessage = (message: string, ...items: any[]) => {
            warningMessages.push(message);
            return Promise.resolve(undefined);
        };

        vscode.window.showErrorMessage = (message: string, ...items: any[]) => {
            errorMessages.push(message);
            return Promise.resolve(undefined);
        };

        vscode.window.showInformationMessage = (message: string, ...items: any[]) => {
            infoMessages.push(message);
            return Promise.resolve(undefined);
        };
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        // Restore original vscode.window methods
        vscode.window.showWarningMessage = originalShowWarningMessage;
        vscode.window.showErrorMessage = originalShowErrorMessage;
        vscode.window.showInformationMessage = originalShowInfoMessage;
    });

    /**
     * Helper to create a config with commits
     */
    async function createConfigWithCommits(
        groupName: string,
        commits: Array<{ name: string; hash: string; repositoryRoot: string }>
    ): Promise<void> {
        await configManager.createLogicalGroup(groupName);
        
        const config = await configManager.loadConfiguration();
        const group = config.logicalGroups.find(g => g.name === groupName);
        
        if (group) {
            for (const commit of commits) {
                group.items.push({
                    name: commit.name,
                    type: 'commit',
                    commitRef: {
                        hash: commit.hash,
                        repositoryRoot: commit.repositoryRoot
                    }
                });
            }
            await configManager.saveConfiguration(config);
        }
    }

    suite('removeCommitFromLogicalGroup', () => {
        
        test('should remove a commit from a logical group', async () => {
            await createConfigWithCommits('Test Group', [
                { name: 'feat: add feature', hash: 'abc123def456', repositoryRoot: '/test/repo' },
                { name: 'fix: bug fix', hash: 'def456abc123', repositoryRoot: '/test/repo' }
            ]);

            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 2, 'Should have 2 commits initially');

            await configManager.removeCommitFromLogicalGroup('Test Group', 'abc123def456');

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should have 1 commit after removal');
            assert.strictEqual(config.logicalGroups[0].items[0].commitRef?.hash, 'def456abc123', 'Remaining commit should be the second one');
        });

        test('should remove the last commit from a group', async () => {
            await createConfigWithCommits('Single Commit Group', [
                { name: 'only commit', hash: 'single123', repositoryRoot: '/test/repo' }
            ]);

            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should have 1 commit initially');

            await configManager.removeCommitFromLogicalGroup('Single Commit Group', 'single123');

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 0, 'Should have 0 commits after removal');
        });

        test('should show warning when commit not found', async () => {
            await createConfigWithCommits('Test Group', [
                { name: 'existing commit', hash: 'existing123', repositoryRoot: '/test/repo' }
            ]);

            await configManager.removeCommitFromLogicalGroup('Test Group', 'nonexistent456');

            assert.ok(
                warningMessages.some(m => m.includes('Commit not found')),
                'Should show warning when commit not found'
            );

            // Verify the existing commit is still there
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should still have 1 commit');
        });

        test('should show error when group not found', async () => {
            await configManager.createLogicalGroup('Existing Group');

            await configManager.removeCommitFromLogicalGroup('Nonexistent Group', 'any123');

            assert.ok(
                errorMessages.some(m => m.includes('Logical group not found')),
                'Should show error when group not found'
            );
        });

        test('should not affect non-commit items in the group', async () => {
            // Create a group with mixed items
            await configManager.createLogicalGroup('Mixed Group');
            
            // Add a file item
            const testFile = path.join(tempDir, 'test-file.txt');
            fs.writeFileSync(testFile, 'test content');
            await configManager.addToLogicalGroup('Mixed Group', testFile, 'Test File', 'file');
            
            // Add a commit item
            let config = await configManager.loadConfiguration();
            const group = config.logicalGroups.find(g => g.name === 'Mixed Group');
            if (group) {
                group.items.push({
                    name: 'test commit',
                    type: 'commit',
                    commitRef: {
                        hash: 'commit123',
                        repositoryRoot: '/test/repo'
                    }
                });
                await configManager.saveConfiguration(config);
            }

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 2, 'Should have 2 items initially');

            // Remove the commit
            await configManager.removeCommitFromLogicalGroup('Mixed Group', 'commit123');

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should have 1 item after removal');
            assert.strictEqual(config.logicalGroups[0].items[0].type, 'file', 'Remaining item should be the file');
        });

        test('should remove commit from nested group', async () => {
            // Create parent group
            await configManager.createLogicalGroup('Parent Group');
            
            // Create nested group
            await configManager.createNestedLogicalGroup('Parent Group', 'Commits');
            
            // Add commit to nested group
            let config = await configManager.loadConfiguration();
            const parentGroup = config.logicalGroups.find(g => g.name === 'Parent Group');
            if (parentGroup && parentGroup.groups) {
                const nestedGroup = parentGroup.groups.find(g => g.name === 'Commits');
                if (nestedGroup) {
                    nestedGroup.items.push({
                        name: 'nested commit',
                        type: 'commit',
                        commitRef: {
                            hash: 'nested123',
                            repositoryRoot: '/test/repo'
                        }
                    });
                    await configManager.saveConfiguration(config);
                }
            }

            config = await configManager.loadConfiguration();
            const nestedGroup = config.logicalGroups[0].groups?.[0];
            assert.strictEqual(nestedGroup?.items.length, 1, 'Should have 1 commit in nested group');

            // Remove from nested group using path
            await configManager.removeCommitFromLogicalGroup('Parent Group/Commits', 'nested123');

            config = await configManager.loadConfiguration();
            const updatedNestedGroup = config.logicalGroups[0].groups?.[0];
            assert.strictEqual(updatedNestedGroup?.items.length, 0, 'Should have 0 commits after removal');
        });

        test('should handle multiple commits with same message but different hashes', async () => {
            await createConfigWithCommits('Duplicate Names', [
                { name: 'fix: bug', hash: 'hash1', repositoryRoot: '/test/repo' },
                { name: 'fix: bug', hash: 'hash2', repositoryRoot: '/test/repo' },
                { name: 'fix: bug', hash: 'hash3', repositoryRoot: '/test/repo' }
            ]);

            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 3, 'Should have 3 commits initially');

            // Remove by specific hash
            await configManager.removeCommitFromLogicalGroup('Duplicate Names', 'hash2');

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 2, 'Should have 2 commits after removal');
            
            const remainingHashes = config.logicalGroups[0].items.map(i => i.commitRef?.hash);
            assert.ok(remainingHashes.includes('hash1'), 'hash1 should remain');
            assert.ok(!remainingHashes.includes('hash2'), 'hash2 should be removed');
            assert.ok(remainingHashes.includes('hash3'), 'hash3 should remain');
        });

        test('should handle commits with long hashes', async () => {
            const longHash = 'abcdef1234567890abcdef1234567890abcdef12';
            
            await createConfigWithCommits('Long Hash Group', [
                { name: 'commit with long hash', hash: longHash, repositoryRoot: '/test/repo' }
            ]);

            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should have 1 commit initially');

            await configManager.removeCommitFromLogicalGroup('Long Hash Group', longHash);

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 0, 'Should have 0 commits after removal');
        });

        test('should handle commits with short hashes', async () => {
            const shortHash = 'abc123';
            
            await createConfigWithCommits('Short Hash Group', [
                { name: 'commit with short hash', hash: shortHash, repositoryRoot: '/test/repo' }
            ]);

            let config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should have 1 commit initially');

            await configManager.removeCommitFromLogicalGroup('Short Hash Group', shortHash);

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 0, 'Should have 0 commits after removal');
        });

        test('should handle empty group', async () => {
            await configManager.createLogicalGroup('Empty Group');

            await configManager.removeCommitFromLogicalGroup('Empty Group', 'any123');

            assert.ok(
                warningMessages.some(m => m.includes('Commit not found')),
                'Should show warning when trying to remove from empty group'
            );
        });

        test('should handle group with only file items', async () => {
            await configManager.createLogicalGroup('Files Only');
            
            const testFile = path.join(tempDir, 'file.txt');
            fs.writeFileSync(testFile, 'content');
            await configManager.addToLogicalGroup('Files Only', testFile, 'File', 'file');

            await configManager.removeCommitFromLogicalGroup('Files Only', 'any123');

            assert.ok(
                warningMessages.some(m => m.includes('Commit not found')),
                'Should show warning when commit not found in files-only group'
            );

            // Verify file is still there
            const config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1, 'File should still be in group');
        });
    });

    suite('Integration with file removal', () => {
        
        test('should support removing both files and commits from same group', async () => {
            // Create group with mixed items
            await configManager.createLogicalGroup('Mixed Items');
            
            // Add file
            const testFile = path.join(tempDir, 'mixed-file.txt');
            fs.writeFileSync(testFile, 'content');
            await configManager.addToLogicalGroup('Mixed Items', testFile, 'Mixed File', 'file');
            
            // Add commit
            let config = await configManager.loadConfiguration();
            const group = config.logicalGroups.find(g => g.name === 'Mixed Items');
            if (group) {
                group.items.push({
                    name: 'mixed commit',
                    type: 'commit',
                    commitRef: {
                        hash: 'mixed123',
                        repositoryRoot: '/test/repo'
                    }
                });
                await configManager.saveConfiguration(config);
            }

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 2, 'Should have 2 items');

            // Remove file using removeFromLogicalGroup
            await configManager.removeFromLogicalGroup('Mixed Items', testFile);

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 1, 'Should have 1 item after file removal');
            assert.strictEqual(config.logicalGroups[0].items[0].type, 'commit', 'Remaining item should be commit');

            // Remove commit using removeCommitFromLogicalGroup
            await configManager.removeCommitFromLogicalGroup('Mixed Items', 'mixed123');

            config = await configManager.loadConfiguration();
            assert.strictEqual(config.logicalGroups[0].items.length, 0, 'Should have 0 items after both removals');
        });
    });
});

