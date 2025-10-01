import * as assert from 'assert';
import * as vscode from 'vscode';
import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        const extension = vscode.extensions.getExtension('yihengtao.workspace-shortcuts');
        assert.ok(extension, 'Extension should be installed');
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('yihengtao.workspace-shortcuts');
        if (extension) {
            await extension.activate();
            assert.strictEqual(extension.isActive, true);
        }
    });

    test('Should register logical group commands', async () => {
        // Get all available commands
        const commands = await vscode.commands.getCommands(true);

        // Check if key commands are registered
        const requiredCommands = [
            'shortcuts.refresh',
            'shortcuts.createLogicalGroup',
            'shortcuts.addToLogicalGroup',
            'shortcuts.removeFromLogicalGroup',
            'shortcuts.renameLogicalGroup',
            'shortcuts.deleteLogicalGroup',
            'shortcuts.openConfiguration'
        ];

        for (const cmd of requiredCommands) {
            const commandExists = commands.includes(cmd);
            assert.ok(commandExists, `Command ${cmd} should be registered`);
        }
    });

    test('Refresh command should execute without error', async () => {
        // Execute the command and ensure it doesn't throw
        try {
            await vscode.commands.executeCommand('shortcuts.refresh');
            // If we get here, the command executed successfully
            assert.ok(true);
        } catch (error) {
            assert.fail(`Command execution failed: ${error}`);
        }
    });

    test('Extension should have activate function', () => {
        assert.strictEqual(typeof myExtension.activate, 'function');
    });

    test('Extension should have deactivate function', () => {
        assert.strictEqual(typeof myExtension.deactivate, 'function');
    });
});
