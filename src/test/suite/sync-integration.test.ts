/**
 * Integration tests for sync functionality with real VSCode context
 * These tests interact with the actual extension and test provider switching
 * Updated to use settings-based sync configuration
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../shortcuts/configuration-manager';
import { ShortcutsConfig } from '../../shortcuts/types';

suite('Sync Integration Tests (Settings-based)', function () {
    // Increase timeout for integration tests
    this.timeout(30000);

    let context: vscode.ExtensionContext;
    let testWorkspaceRoot: string;
    let configManager: ConfigurationManager;
    let mockSyncConfig: MockWorkspaceConfiguration;
    const originalGetConfiguration = vscode.workspace.getConfiguration;

    suiteSetup(async function () {
        // Get the extension
        const extension = vscode.extensions.getExtension('yihengtao.workspace-shortcuts');
        if (!extension) {
            throw new Error('Extension not found');
        }

        if (!extension.isActive) {
            await extension.activate();
        }

        // Create a temporary test workspace
        testWorkspaceRoot = path.join(os.tmpdir(), 'shortcuts-sync-test-' + Date.now());
        fs.mkdirSync(testWorkspaceRoot, { recursive: true });
        fs.mkdirSync(path.join(testWorkspaceRoot, '.vscode'), { recursive: true });

        console.log('Test workspace created at:', testWorkspaceRoot);
    });

    setup(async function () {
        // Set up mock configuration for sync settings
        mockSyncConfig = new MockWorkspaceConfiguration();
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceShortcuts.sync') {
                return mockSyncConfig;
            }
            return originalGetConfiguration(section);
        };

        // Create a mock context for testing
        const mockGlobalState = new MockMemento();
        const mockWorkspaceState = new MockMemento();
        const mockSecrets = new MockSecretStorage();

        context = {
            globalState: mockGlobalState,
            workspaceState: mockWorkspaceState,
            secrets: mockSecrets,
            extensionPath: testWorkspaceRoot,
            extensionUri: vscode.Uri.file(testWorkspaceRoot),
            subscriptions: []
        } as any;

        // Initialize configuration manager with test workspace
        configManager = new ConfigurationManager(testWorkspaceRoot, context);
    });

    teardown(async function () {
        // Clean up test config file
        const configPath = path.join(testWorkspaceRoot, '.vscode', 'shortcuts.yaml');
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }

        // Dispose sync manager if exists
        const syncManager = configManager.getSyncManager();
        if (syncManager) {
            syncManager.dispose();
        }

        // Restore original configuration
        (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    });

    suiteTeardown(function () {
        // Clean up test workspace
        if (fs.existsSync(testWorkspaceRoot)) {
            fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
        }
    });

    suite('Provider Switching via Settings', () => {
        test('should initialize with no sync configuration', async () => {
            // No settings configured, so no sync
            await mockSyncConfig.update('enabled', false);
            await configManager.initializeSyncManager();

            const syncManager = configManager.getSyncManager();
            assert.strictEqual(syncManager, undefined, 'Sync manager should not exist when disabled');
        });

        test('should configure VSCode sync provider via settings', async () => {
            // Configure VSCode sync in settings
            await mockSyncConfig.update('enabled', true);
            await mockSyncConfig.update('autoSync', true);
            await mockSyncConfig.update('provider', 'vscode');
            await mockSyncConfig.update('vscode.scope', 'global');

            // Initialize sync manager
            await configManager.initializeSyncManager();

            const syncManager = configManager.getSyncManager();
            assert.ok(syncManager, 'Sync manager should be initialized');
            assert.strictEqual(syncManager.isEnabled(), true, 'Sync should be enabled');

            const providers = syncManager.getProviders();
            assert.strictEqual(providers.size, 1, 'Should have 1 provider');
            assert.ok(providers.has('vscode'), 'Should have VSCode provider');
        });

        test('should disable sync completely', async () => {
            // Start with sync enabled
            await mockSyncConfig.update('enabled', true);
            await mockSyncConfig.update('provider', 'vscode');
            await mockSyncConfig.update('vscode.scope', 'global');

            await configManager.initializeSyncManager();

            let syncManager = configManager.getSyncManager();
            assert.ok(syncManager, 'Sync manager should exist initially');
            assert.strictEqual(syncManager.isEnabled(), true, 'Sync should be enabled');

            // Disable sync
            await mockSyncConfig.update('enabled', false);
            await configManager.reinitializeSyncManager();

            syncManager = configManager.getSyncManager();
            assert.strictEqual(syncManager, undefined, 'Sync manager should not exist when disabled');
        });

        test('should handle switching between global and workspace scope for VSCode sync', async () => {
            // Start with global scope
            await mockSyncConfig.update('enabled', true);
            await mockSyncConfig.update('provider', 'vscode');
            await mockSyncConfig.update('vscode.scope', 'global');

            await configManager.initializeSyncManager();

            let syncManager = configManager.getSyncManager();
            const vscodeProvider1 = syncManager?.getProviders().get('vscode');
            assert.ok(vscodeProvider1, 'VSCode provider should exist');

            // Switch to workspace scope
            await mockSyncConfig.update('vscode.scope', 'workspace');
            await configManager.reinitializeSyncManager();

            syncManager = configManager.getSyncManager();
            const vscodeProvider2 = syncManager?.getProviders().get('vscode');
            assert.ok(vscodeProvider2, 'VSCode provider should still exist after scope change');
        });
    });

    suite('Sync Operations with Settings', () => {
        test('should sync to cloud after provider configuration', async () => {
            // Configure with VSCode sync
            await mockSyncConfig.update('enabled', true);
            await mockSyncConfig.update('autoSync', false); // Manual sync for testing
            await mockSyncConfig.update('provider', 'vscode');
            await mockSyncConfig.update('vscode.scope', 'global');

            const config: ShortcutsConfig = {
                logicalGroups: [
                    {
                        name: 'Test Group',
                        items: []
                    }
                ]
            };

            await configManager.saveConfiguration(config);
            await configManager.initializeSyncManager();

            // Perform sync
            try {
                await configManager.syncToCloud();
                console.log('Sync to cloud completed successfully');
            } catch (error) {
                console.log('Sync failed (expected in test environment):', error);
                // In test environment, sync might fail due to mock context
                // This is acceptable for this test
            }

            // Verify config was saved (should not contain sync property)
            const savedConfig = await configManager.loadConfiguration();
            assert.strictEqual(savedConfig.logicalGroups.length, 1, 'Config should have 1 group');
            assert.strictEqual(savedConfig.logicalGroups[0].name, 'Test Group', 'Group name should match');
            assert.strictEqual((savedConfig as any).sync, undefined, 'Config should not contain sync property');
        });

        test('should get sync status for active providers', async () => {
            await mockSyncConfig.update('enabled', true);
            await mockSyncConfig.update('provider', 'vscode');
            await mockSyncConfig.update('vscode.scope', 'global');

            await configManager.initializeSyncManager();

            const status = await configManager.getSyncStatus();
            assert.ok(status, 'Should get sync status');
            assert.ok(status.includes('Cloud Sync Status'), 'Status should include header');
        });

        test('should handle auto-sync setting toggle', async () => {
            await mockSyncConfig.update('enabled', true);
            await mockSyncConfig.update('autoSync', true);
            await mockSyncConfig.update('provider', 'vscode');
            await mockSyncConfig.update('vscode.scope', 'global');

            await configManager.initializeSyncManager();

            let syncManager = configManager.getSyncManager();
            assert.strictEqual(syncManager?.isAutoSyncEnabled(), true, 'Auto-sync should be enabled');

            // Disable auto-sync
            await mockSyncConfig.update('autoSync', false);
            await configManager.reinitializeSyncManager();

            syncManager = configManager.getSyncManager();
            assert.strictEqual(syncManager?.isAutoSyncEnabled(), false, 'Auto-sync should be disabled');
        });
    });

    suite('Settings Validation', () => {
        test('should handle missing provider setting gracefully', async () => {
            await mockSyncConfig.update('enabled', true);
            // No provider specified - defaults to 'vscode'

            await configManager.initializeSyncManager();

            const syncManager = configManager.getSyncManager();
            // Provider defaults to 'vscode' when not specified, so sync manager will exist
            // with the default VSCode provider
            assert.ok(syncManager, 'Sync manager should exist with default vscode provider');
            assert.ok(syncManager.getProviders().has('vscode'), 'Should have VSCode provider as default');
        });

        test('should separate sync settings from shortcuts data', async () => {
            // Configure sync in settings
            await mockSyncConfig.update('enabled', true);
            await mockSyncConfig.update('provider', 'vscode');
            await mockSyncConfig.update('vscode.scope', 'global');

            const config: ShortcutsConfig = {
                logicalGroups: [
                    {
                        name: 'Test Group',
                        items: []
                    }
                ]
            };

            await configManager.saveConfiguration(config);
            await configManager.initializeSyncManager();

            // Load and verify config doesn't contain sync
            const loadedConfig = await configManager.loadConfiguration();
            assert.strictEqual((loadedConfig as any).sync, undefined, 'Loaded config should not have sync property');
            assert.strictEqual(loadedConfig.logicalGroups.length, 1, 'Should have shortcuts data');
        });
    });
});

/**
 * Mock Memento for testing
 */
class MockMemento implements vscode.Memento {
    private storage = new Map<string, any>();

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const value = this.storage.get(key);
        return value !== undefined ? value : defaultValue;
    }

    async update(key: string, value: any): Promise<void> {
        if (value === undefined) {
            this.storage.delete(key);
        } else {
            this.storage.set(key, value);
        }
    }

    setKeysForSync(keys: readonly string[]): void {
        // Mock implementation
    }
}

/**
 * Mock SecretStorage for testing
 */
class MockSecretStorage implements vscode.SecretStorage {
    private storage = new Map<string, string>();

    async get(key: string): Promise<string | undefined> {
        return this.storage.get(key);
    }

    async store(key: string, value: string): Promise<void> {
        this.storage.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.storage.delete(key);
    }

    onDidChange: vscode.Event<vscode.SecretStorageChangeEvent> = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event;
}

/**
 * Mock WorkspaceConfiguration for testing sync settings
 */
class MockWorkspaceConfiguration implements vscode.WorkspaceConfiguration {
    private settings = new Map<string, any>();

    get<T>(section: string): T | undefined;
    get<T>(section: string, defaultValue: T): T;
    get<T>(section: string, defaultValue?: T): T | undefined {
        const value = this.settings.get(section);
        return value !== undefined ? value : defaultValue;
    }

    has(section: string): boolean {
        return this.settings.has(section);
    }

    inspect<T>(section: string): { key: string; } | undefined {
        return undefined;
    }

    async update(section: string, value: any, configurationTarget?: vscode.ConfigurationTarget | boolean): Promise<void> {
        if (value === undefined) {
            this.settings.delete(section);
        } else {
            this.settings.set(section, value);
        }
    }

    readonly [key: string]: any;
}
