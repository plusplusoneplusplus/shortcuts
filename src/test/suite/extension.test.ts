import * as assert from 'assert';
import * as vscode from 'vscode';
import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('your-publisher-name.shortcuts'));
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('your-publisher-name.shortcuts');
        if (extension) {
            await extension.activate();
            assert.strictEqual(extension.isActive, true);
        }
    });

    test('Should register hello world command', async () => {
        // Get all available commands
        const commands = await vscode.commands.getCommands(true);

        // Check if our command is registered
        const commandExists = commands.includes('shortcuts.helloWorld');
        assert.strictEqual(commandExists, true, 'Hello World command should be registered');
    });

    test('Hello world command should execute without error', async () => {
        // Execute the command and ensure it doesn't throw
        try {
            await vscode.commands.executeCommand('shortcuts.helloWorld');
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