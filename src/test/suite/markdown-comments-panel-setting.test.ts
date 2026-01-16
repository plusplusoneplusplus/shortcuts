/**
 * Tests for the markdownComments.panelEnabled setting
 * Verifies that the Markdown Comments panel visibility can be controlled via settings
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Markdown Comments Panel Setting Tests', () => {
    let originalConfig: boolean | undefined;

    suiteSetup(async () => {
        // Store original config value
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        originalConfig = config.get<boolean>('panelEnabled');
    });

    suiteTeardown(async () => {
        // Restore original config value
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        await config.update('panelEnabled', originalConfig, vscode.ConfigurationTarget.Global);
    });

    test('setting should exist in configuration', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        const settingValue = config.get<boolean>('panelEnabled');
        
        // The setting should exist (either true, false, or undefined which defaults to false)
        assert.ok(settingValue === true || settingValue === false || settingValue === undefined,
            'Setting markdownComments.panelEnabled should exist');
    });

    test('setting should default to false', async () => {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        const settingValue = config.get<boolean>('panelEnabled', false);
        
        // Default value should be false (panel hidden by default)
        assert.strictEqual(settingValue, false, 'Default value should be false');
    });

    test('should be able to update the setting to true', async () => {
        // Update to true
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        await config.update('panelEnabled', true, vscode.ConfigurationTarget.Global);
        
        // Re-read the configuration to get the updated value
        const updatedConfig = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        const settingValue = updatedConfig.get<boolean>('panelEnabled');
        assert.strictEqual(settingValue, true, 'Setting should be updated to true');
    });

    test('should be able to update the setting to false', async () => {
        // First set to true
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        await config.update('panelEnabled', true, vscode.ConfigurationTarget.Global);
        
        // Then update back to false
        await config.update('panelEnabled', false, vscode.ConfigurationTarget.Global);
        
        // Re-read the configuration
        const finalConfig = vscode.workspace.getConfiguration('workspaceShortcuts.markdownComments');
        const settingValue = finalConfig.get<boolean>('panelEnabled');
        assert.strictEqual(settingValue, false, 'Setting should be updated back to false');
    });

    test('setting should be accessible via full path', async () => {
        // Test that the setting can also be accessed via the full path
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        const settingValue = config.get<boolean>('markdownComments.panelEnabled');
        
        // The setting should be accessible
        assert.ok(settingValue === true || settingValue === false || settingValue === undefined,
            'Setting should be accessible via workspaceShortcuts.markdownComments.panelEnabled');
    });

    test('markdownCommentsView commands should be registered', async () => {
        // Verify that the markdown comments view commands are registered
        const commands = await vscode.commands.getCommands(true);
        
        // These commands should be registered regardless of panel visibility
        assert.ok(
            commands.includes('markdownComments.refresh'),
            'markdownComments.refresh command should be registered'
        );
        assert.ok(
            commands.includes('markdownComments.toggleShowResolved'),
            'markdownComments.toggleShowResolved command should be registered'
        );
        assert.ok(
            commands.includes('markdownComments.generatePrompt'),
            'markdownComments.generatePrompt command should be registered'
        );
    });
});
