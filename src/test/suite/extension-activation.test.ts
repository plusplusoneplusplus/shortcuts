import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('Extension Activation Test Suite', () => {
    const extensionId = 'yihengtao.workspace-shortcuts';

    test('Package.json should include onStartupFinished activation event', () => {
        // Read package.json to verify configuration
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        assert.ok(
            Array.isArray(packageJson.activationEvents),
            'activationEvents should be an array'
        );
        
        assert.ok(
            packageJson.activationEvents.includes('onStartupFinished'),
            'activationEvents should include onStartupFinished for automatic startup activation'
        );
    });

    test('onStartupFinished should be first activation event for clarity', () => {
        // Verify onStartupFinished is listed first (best practice for readability)
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        assert.strictEqual(
            packageJson.activationEvents[0],
            'onStartupFinished',
            'onStartupFinished should be the first activation event'
        );
    });

    test('Existing activation events should be preserved for backward compatibility', () => {
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        const expectedEvents = [
            'onView:shortcutsView',
            'onView:markdownCommentsView',
            'onView:gitView',
            'onView:tasksView',
            'onCommand:shortcuts.createLogicalGroup',
            'onCustomEditor:reviewEditorView',
            'onCustomEditor:gitDiffReviewEditor',
            'onCustomEditor:pipelinePreviewEditor',
            'onViewContainer:shortcuts'
        ];
        
        for (const event of expectedEvents) {
            assert.ok(
                packageJson.activationEvents.includes(event),
                `Activation event "${event}" should be preserved for backward compatibility`
            );
        }
    });

    test('Extension should be present and activatable', async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, 'Extension should be installed');
        
        // Ensure extension can be activated
        if (!extension.isActive) {
            await extension.activate();
        }
        assert.strictEqual(extension.isActive, true, 'Extension should be active');
    });

    test('Extension activation should not throw errors', async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, 'Extension should be installed');
        
        try {
            if (!extension.isActive) {
                await extension.activate();
            }
            // Success - no error thrown
            assert.ok(true, 'Extension activation completed without errors');
        } catch (error) {
            assert.fail(`Extension activation should not throw: ${error}`);
        }
    });

    test('Extension should register core views after activation', async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, 'Extension should be installed');
        
        if (!extension.isActive) {
            await extension.activate();
        }
        
        // Verify extension contributes expected views by checking package.json
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        // Check that views are defined in contributes
        assert.ok(packageJson.contributes?.views, 'Package.json should define contributed views');
        
        // Check shortcuts view container has views
        const shortcutsViews = packageJson.contributes.views.shortcuts;
        assert.ok(Array.isArray(shortcutsViews), 'Shortcuts view container should have views');
        assert.ok(shortcutsViews.length > 0, 'Should have at least one view in shortcuts container');
    });

    test('Extension should not use deprecated wildcard activation', () => {
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        // Ensure we don't use '*' wildcard which can impact startup performance
        assert.ok(
            !packageJson.activationEvents.includes('*'),
            'Should not use wildcard (*) activation event as it impacts VS Code startup performance'
        );
    });

    test('Activation events should be valid VS Code events', () => {
        const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        const validPrefixes = [
            'onStartupFinished',
            'onView:',
            'onCommand:',
            'onCustomEditor:',
            'onViewContainer:',
            'onLanguage:',
            'onDebug',
            'workspaceContains:',
            'onFileSystem:',
            'onUri',
            'onWebviewPanel:'
        ];
        
        for (const event of packageJson.activationEvents) {
            const isValid = validPrefixes.some(prefix => 
                event === prefix || event.startsWith(prefix)
            );
            assert.ok(isValid, `Activation event "${event}" should be a valid VS Code activation event`);
        }
    });
});
