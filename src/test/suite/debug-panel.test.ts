import * as assert from 'assert';
import { DebugPanelTreeDataProvider } from '../../shortcuts/debug-panel/debug-panel-tree-provider';
import { DebugCommandItem } from '../../shortcuts/debug-panel/debug-command-item';
import { getDefaultDebugCommands, DebugCommand } from '../../shortcuts/debug-panel/debug-commands';

suite('Debug Panel Tests', () => {
    suite('getDefaultDebugCommands', () => {
        test('should return array of debug commands', () => {
            const commands = getDefaultDebugCommands();
            assert.ok(Array.isArray(commands));
            assert.ok(commands.length > 0);
        });

        test('should have required properties on each command', () => {
            const commands = getDefaultDebugCommands();
            for (const cmd of commands) {
                assert.ok(cmd.id, 'Command should have id');
                assert.ok(cmd.label, 'Command should have label');
                assert.ok(cmd.icon, 'Command should have icon');
                assert.ok(cmd.commandId, 'Command should have commandId');
            }
        });

        test('should include new-chat-with-prompt command', () => {
            const commands = getDefaultDebugCommands();
            const newChat = commands.find(c => c.id === 'new-chat-with-prompt');
            assert.ok(newChat);
            assert.strictEqual(newChat?.commandId, 'debugPanel.newChatWithPrompt');
        });

        test('should include open-chat command', () => {
            const commands = getDefaultDebugCommands();
            const openChat = commands.find(c => c.id === 'open-chat');
            assert.ok(openChat);
            assert.strictEqual(openChat?.commandId, 'workbench.panel.chat.view.copilot.focus');
        });

        test('should have exactly 6 commands', () => {
            const commands = getDefaultDebugCommands();
            assert.strictEqual(commands.length, 6);
        });

        test('should include read-setting command', () => {
            const commands = getDefaultDebugCommands();
            const readSetting = commands.find(c => c.id === 'read-setting');
            assert.ok(readSetting);
            assert.strictEqual(readSetting?.commandId, 'debugPanel.readSetting');
        });

        test('should include run-custom-command as first command', () => {
            const commands = getDefaultDebugCommands();
            const runCustomCommand = commands.find(c => c.id === 'run-custom-command');
            assert.ok(runCustomCommand);
            assert.strictEqual(runCustomCommand?.commandId, 'debugPanel.runCustomCommand');
            assert.strictEqual(commands[0].id, 'run-custom-command');
        });

        test('should include new-chat-conversation command', () => {
            const commands = getDefaultDebugCommands();
            const newChatConversation = commands.find(c => c.id === 'new-chat-conversation');
            assert.ok(newChatConversation);
            assert.strictEqual(newChatConversation?.commandId, 'debugPanel.newChatConversation');
        });
    });

    suite('DebugCommandItem', () => {
        test('should create tree item with correct properties', () => {
            const cmd: DebugCommand = {
                id: 'test',
                label: 'Test Label',
                description: 'Test Desc',
                icon: 'debug',
                commandId: 'test.command'
            };
            const item = new DebugCommandItem(cmd);

            assert.strictEqual(item.label, 'Test Label');
            assert.strictEqual(item.description, 'Test Desc');
            assert.strictEqual(item.contextValue, 'debugCommand');
            assert.ok(item.command);
            assert.strictEqual(item.command?.command, 'debugPanel.executeCommand');
        });

        test('should use tooltip from command if provided', () => {
            const cmd: DebugCommand = {
                id: 'test',
                label: 'Test Label',
                description: 'Test Desc',
                tooltip: 'Custom Tooltip',
                icon: 'debug',
                commandId: 'test.command'
            };
            const item = new DebugCommandItem(cmd);

            assert.strictEqual(item.tooltip, 'Custom Tooltip');
        });

        test('should fall back to description for tooltip if not provided', () => {
            const cmd: DebugCommand = {
                id: 'test',
                label: 'Test Label',
                description: 'Test Desc',
                icon: 'debug',
                commandId: 'test.command'
            };
            const item = new DebugCommandItem(cmd);

            assert.strictEqual(item.tooltip, 'Test Desc');
        });

        test('should pass command arguments correctly', () => {
            const cmd: DebugCommand = {
                id: 'test',
                label: 'Test Label',
                icon: 'debug',
                commandId: 'test.command',
                args: ['arg1', 'arg2']
            };
            const item = new DebugCommandItem(cmd);

            assert.ok(item.command);
            assert.deepStrictEqual(item.command?.arguments, ['test.command', ['arg1', 'arg2']]);
        });
    });

    suite('DebugPanelTreeDataProvider', () => {
        test('should return debug command items as children', () => {
            const provider = new DebugPanelTreeDataProvider();
            const children = provider.getChildren();

            assert.ok(Array.isArray(children));
            assert.ok(children.length > 0);
            assert.ok(children[0] instanceof DebugCommandItem);
        });

        test('should return empty array for element children', () => {
            const provider = new DebugPanelTreeDataProvider();
            const children = provider.getChildren();
            const subChildren = provider.getChildren(children[0]);

            assert.strictEqual(subChildren.length, 0);
        });

        test('should return same tree item from getTreeItem', () => {
            const provider = new DebugPanelTreeDataProvider();
            const children = provider.getChildren();
            const item = children[0];
            const returned = provider.getTreeItem(item);

            assert.strictEqual(returned, item);
        });

        test('should have onDidChangeTreeData event', () => {
            const provider = new DebugPanelTreeDataProvider();
            assert.ok(provider.onDidChangeTreeData);
        });

        test('should be disposable', () => {
            const provider = new DebugPanelTreeDataProvider();
            assert.ok(typeof provider.dispose === 'function');
            // Should not throw
            provider.dispose();
        });
    });
});

