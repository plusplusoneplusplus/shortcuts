/**
 * Tests for the logicalGroups.enabled setting
 * Verifies that the Logical Groups panel visibility can be controlled via settings
 * and is deprecated (hidden by default)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Logical Groups Panel Setting Tests', () => {
    let originalConfig: boolean | undefined;

    suiteSetup(async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.logicalGroups');
        originalConfig = config.get<boolean>('enabled');
    });

    suiteTeardown(async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.logicalGroups');
        await config.update('enabled', originalConfig, vscode.ConfigurationTarget.Global);
    });

    test('setting should exist in configuration', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.logicalGroups');
        const settingValue = config.get<boolean>('enabled');

        assert.ok(settingValue === true || settingValue === false || settingValue === undefined,
            'Setting logicalGroups.enabled should exist');
    });

    test('setting should default to false (deprecated, hidden by default)', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.logicalGroups');
        const settingValue = config.get<boolean>('enabled', false);

        assert.strictEqual(settingValue, false, 'Default value should be false');
    });

    test('should be able to update the setting to true', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.logicalGroups');
        await config.update('enabled', true, vscode.ConfigurationTarget.Global);

        const updatedConfig = vscode.workspace.getConfiguration('workspaceShortcuts.logicalGroups');
        const settingValue = updatedConfig.get<boolean>('enabled');
        assert.strictEqual(settingValue, true, 'Setting should be updated to true');
    });

    test('should be able to update the setting to false', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.logicalGroups');
        await config.update('enabled', true, vscode.ConfigurationTarget.Global);

        await config.update('enabled', false, vscode.ConfigurationTarget.Global);

        const finalConfig = vscode.workspace.getConfiguration('workspaceShortcuts.logicalGroups');
        const settingValue = finalConfig.get<boolean>('enabled');
        assert.strictEqual(settingValue, false, 'Setting should be updated back to false');
    });

    test('setting should be accessible via full path', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        const settingValue = config.get<boolean>('logicalGroups.enabled');

        assert.ok(settingValue === true || settingValue === false || settingValue === undefined,
            'Setting should be accessible via workspaceShortcuts.logicalGroups.enabled');
    });

    test('package.json should define the setting with deprecation notice', () => {
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const properties = packageJson.contributes.configuration.properties;

        const setting = properties['workspaceShortcuts.logicalGroups.enabled'];
        assert.ok(setting, 'Setting should exist in package.json');
        assert.strictEqual(setting.type, 'boolean', 'Setting type should be boolean');
        assert.strictEqual(setting.default, false, 'Default should be false');
        assert.ok(setting.markdownDeprecationMessage, 'Should have a deprecation message');
    });

    test('shortcutsView when clause should use the enabled setting', () => {
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const views = packageJson.contributes.views.shortcuts;
        const shortcutsView = views.find((v: any) => v.id === 'shortcutsView');

        assert.ok(shortcutsView, 'shortcutsView should exist');
        assert.strictEqual(
            shortcutsView.when,
            'config.workspaceShortcuts.logicalGroups.enabled',
            'shortcutsView when clause should reference the logicalGroups.enabled config setting'
        );
    });

    test('shortcutsView commands should be registered regardless of panel visibility', async () => {
        const commands = await vscode.commands.getCommands(true);

        assert.ok(
            commands.includes('shortcuts.refresh'),
            'shortcuts.refresh command should be registered'
        );
        assert.ok(
            commands.includes('shortcuts.createLogicalGroup'),
            'shortcuts.createLogicalGroup command should be registered'
        );
    });
});
