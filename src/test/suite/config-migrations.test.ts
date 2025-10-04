/**
 * Tests for configuration migration system
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    canMigrate,
    CURRENT_CONFIG_VERSION,
    detectConfigVersion,
    getSupportedVersions,
    migrateConfig
} from '../../shortcuts/config-migrations';

suite('Configuration Migration Tests', () => {
    let tempDir: string;

    setup(() => {
        // Create a temporary directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-migration-test-'));

        // Create a test folder for migration tests
        const testFolder = path.join(tempDir, 'test-folder');
        fs.mkdirSync(testFolder);
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Version Detection', () => {
        test('should detect v1 config (old shortcuts format)', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'src', name: 'Source' }
                ]
            };

            const version = detectConfigVersion(v1Config);
            assert.strictEqual(version, 1);
        });

        test('should detect v2 config (logical groups without version)', () => {
            const v2Config = {
                logicalGroups: [
                    {
                        name: 'Test Group',
                        items: [
                            { path: 'src', name: 'Source', type: 'folder' }
                        ]
                    }
                ]
            };

            const version = detectConfigVersion(v2Config);
            assert.strictEqual(version, 2);
        });

        test('should detect v3 config (with version field)', () => {
            const v3Config = {
                version: 3,
                logicalGroups: [
                    {
                        name: 'Test Group',
                        items: []
                    }
                ]
            };

            const version = detectConfigVersion(v3Config);
            assert.strictEqual(version, 3);
        });

        test('should detect explicit version number', () => {
            const config = {
                version: 2,
                logicalGroups: []
            };

            const version = detectConfigVersion(config);
            assert.strictEqual(version, 2);
        });

        test('should treat empty config as current version', () => {
            const emptyConfig = {};

            const version = detectConfigVersion(emptyConfig);
            assert.strictEqual(version, CURRENT_CONFIG_VERSION);
        });
    });

    suite('Migration v1 -> v2', () => {
        test('should migrate single shortcut to logical group', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'test-folder', name: 'Test Folder' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual(result.migrated, true);
            assert.strictEqual(result.fromVersion, 1);
            assert.strictEqual(result.toVersion, CURRENT_CONFIG_VERSION);
            assert.strictEqual(result.appliedMigrations.length, CURRENT_CONFIG_VERSION - 1);

            assert.strictEqual(result.config.logicalGroups.length, 1);
            assert.strictEqual(result.config.logicalGroups[0].name, 'Test Folder');
            assert.strictEqual(result.config.logicalGroups[0].items.length, 1);
            assert.strictEqual(result.config.logicalGroups[0].items[0].path, 'test-folder');
            assert.strictEqual(result.config.logicalGroups[0].items[0].type, 'folder');
        });

        test('should migrate multiple shortcuts', () => {
            // Create multiple test folders
            const folder1 = path.join(tempDir, 'folder1');
            const folder2 = path.join(tempDir, 'folder2');
            fs.mkdirSync(folder1);
            fs.mkdirSync(folder2);

            const v1Config = {
                shortcuts: [
                    { path: 'folder1', name: 'Folder One' },
                    { path: 'folder2', name: 'Folder Two' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual(result.config.logicalGroups.length, 2);
            assert.strictEqual(result.config.logicalGroups[0].name, 'Folder One');
            assert.strictEqual(result.config.logicalGroups[1].name, 'Folder Two');
        });

        test('should skip shortcuts with non-existent paths', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'non-existent', name: 'Missing' },
                    { path: 'test-folder', name: 'Exists' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            // Should only migrate the existing folder
            assert.strictEqual(result.config.logicalGroups.length, 1);
            assert.strictEqual(result.config.logicalGroups[0].name, 'Exists');

            // Should have warnings
            assert.ok(result.warnings.length > 0);
            assert.ok(result.warnings.some(w => w.includes('non-existent')));
        });

        test('should skip shortcuts with invalid data', () => {
            const v1Config = {
                shortcuts: [
                    null,
                    { path: '', name: 'Empty Path' },
                    { name: 'No Path' },
                    { path: 'test-folder', name: 'Valid' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            // Should only migrate the valid shortcut
            assert.strictEqual(result.config.logicalGroups.length, 1);
            assert.strictEqual(result.config.logicalGroups[0].name, 'Valid');
        });

        test('should use basename as name if name not provided', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'test-folder' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual(result.config.logicalGroups.length, 1);
            assert.strictEqual(result.config.logicalGroups[0].name, 'test-folder');
        });

        test('should preserve existing logical groups during migration', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'test-folder', name: 'Migrated' }
                ],
                logicalGroups: [
                    {
                        name: 'Existing Group',
                        items: [
                            { path: 'other', name: 'Other', type: 'folder' }
                        ]
                    }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            // Should have both groups
            assert.strictEqual(result.config.logicalGroups.length, 2);
            assert.ok(result.config.logicalGroups.some(g => g.name === 'Existing Group'));
            assert.ok(result.config.logicalGroups.some(g => g.name === 'Migrated'));
        });

        test('should not create duplicate groups', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'test-folder', name: 'Test' }
                ],
                logicalGroups: [
                    {
                        name: 'Test',
                        items: []
                    }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            // Should only have one group
            assert.strictEqual(result.config.logicalGroups.length, 1);
            assert.ok(result.warnings.some(w => w.includes('already exists')));
        });

        test('should remove shortcuts array after migration', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'test-folder', name: 'Test' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual((result.config as any).shortcuts, undefined);
        });
    });

    suite('Migration v2 -> v3', () => {
        test('should migrate v2 to v3 without data loss', () => {
            const v2Config = {
                version: 2,
                logicalGroups: [
                    {
                        name: 'Test Group',
                        description: 'Test Description',
                        items: [
                            { path: 'src', name: 'Source', type: 'folder' },
                            { path: 'package.json', name: 'Package', type: 'file' }
                        ],
                        icon: 'folder'
                    }
                ]
            };

            const result = migrateConfig(v2Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual(result.migrated, true);
            assert.strictEqual(result.fromVersion, 2);
            assert.strictEqual(result.toVersion, 3);

            // All data should be preserved
            assert.strictEqual(result.config.logicalGroups.length, 1);
            const group = result.config.logicalGroups[0];
            assert.strictEqual(group.name, 'Test Group');
            assert.strictEqual(group.description, 'Test Description');
            assert.strictEqual(group.icon, 'folder');
            assert.strictEqual(group.items.length, 2);
        });

        test('should ensure items array exists', () => {
            const v2Config = {
                version: 2,
                logicalGroups: [
                    {
                        name: 'Test Group'
                        // Missing items array
                    }
                ]
            };

            const result = migrateConfig(v2Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.ok(Array.isArray(result.config.logicalGroups[0].items));
        });
    });

    suite('Multi-Version Migration', () => {
        test('should migrate from v1 directly to current version', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'test-folder', name: 'Test' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual(result.fromVersion, 1);
            assert.strictEqual(result.toVersion, CURRENT_CONFIG_VERSION);
            assert.strictEqual(result.config.version, CURRENT_CONFIG_VERSION);

            // Should have applied all intermediate migrations
            assert.ok(result.appliedMigrations.includes('v1->v2'));
            assert.ok(result.appliedMigrations.includes('v2->v3'));
        });

        test('should not migrate if already at current version', () => {
            const currentConfig = {
                version: CURRENT_CONFIG_VERSION,
                logicalGroups: []
            };

            const result = migrateConfig(currentConfig, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual(result.migrated, false);
            assert.strictEqual(result.appliedMigrations.length, 0);
        });
    });

    suite('Migration Validation', () => {
        test('should validate that v1 config can be migrated', () => {
            const v1Config = {
                shortcuts: []
            };

            assert.strictEqual(canMigrate(v1Config), true);
        });

        test('should validate that v2 config can be migrated', () => {
            const v2Config = {
                version: 2,
                logicalGroups: []
            };

            assert.strictEqual(canMigrate(v2Config), true);
        });

        test('should validate that current version can be "migrated" (no-op)', () => {
            const currentConfig = {
                version: CURRENT_CONFIG_VERSION,
                logicalGroups: []
            };

            assert.strictEqual(canMigrate(currentConfig), true);
        });

        test('should return supported versions', () => {
            const versions = getSupportedVersions();

            assert.ok(Array.isArray(versions));
            assert.ok(versions.length > 0);
            assert.ok(versions.includes(1));
            assert.ok(versions.includes(2));
            assert.ok(versions.includes(CURRENT_CONFIG_VERSION));

            // Should be sorted
            for (let i = 1; i < versions.length; i++) {
                assert.ok(versions[i] > versions[i - 1]);
            }
        });
    });

    suite('Edge Cases', () => {
        test('should handle config with basePaths', () => {
            const v1Config = {
                shortcuts: [
                    { path: 'test-folder', name: 'Test' }
                ],
                basePaths: [
                    { alias: '@root', path: tempDir }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            // basePaths should be preserved
            assert.ok(result.config.basePaths);
            assert.strictEqual(result.config.basePaths.length, 1);
            assert.strictEqual(result.config.basePaths[0].alias, '@root');
        });

        test('should handle empty shortcuts array', () => {
            const v1Config = {
                shortcuts: []
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual(result.config.logicalGroups.length, 0);
            assert.strictEqual((result.config as any).shortcuts, undefined);
        });

        test('should handle config with no shortcuts or logicalGroups', () => {
            const emptyConfig = {
                basePaths: []
            };

            const result = migrateConfig(emptyConfig, {
                workspaceRoot: tempDir,
                verbose: false
            });

            // Should not crash, should return valid config
            assert.ok(result.config);
            assert.strictEqual(result.migrated, false);
        });

        test('should handle absolute paths in shortcuts', () => {
            const absolutePath = path.join(tempDir, 'test-folder');

            const v1Config = {
                shortcuts: [
                    { path: absolutePath, name: 'Absolute' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: false
            });

            assert.strictEqual(result.config.logicalGroups.length, 1);
            assert.strictEqual(result.config.logicalGroups[0].items[0].path, absolutePath);
        });
    });

    suite('Verbose Mode', () => {
        test('should apply migrations with verbose flag', () => {
            // Test that verbose mode doesn't crash and produces valid output
            const v1Config = {
                shortcuts: [
                    { path: 'test-folder', name: 'Test' }
                ]
            };

            const result = migrateConfig(v1Config, {
                workspaceRoot: tempDir,
                verbose: true
            });

            // Should successfully migrate
            assert.strictEqual(result.migrated, true);
            assert.strictEqual(result.fromVersion, 1);
            assert.strictEqual(result.toVersion, CURRENT_CONFIG_VERSION);
            assert.ok(result.appliedMigrations.length > 0);
        });
    });
});
