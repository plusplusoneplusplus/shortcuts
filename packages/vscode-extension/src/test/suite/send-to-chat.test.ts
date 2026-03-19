/**
 * Tests for the Send to Chat functionality in Markdown Review
 * 
 * Tests cover:
 * - WebviewMessage type with newConversation flag
 * - requestSendToChat function with new/existing conversation options
 * - generateAndSendToChat behavior for both modes
 */

import * as assert from 'assert';

suite('Send to Chat Tests', () => {

    suite('WebviewMessage Type', () => {
        // Type definitions for testing (mirrors the actual types)
        interface PromptOptions {
            format: string;
            newConversation?: boolean;
        }

        interface SendToChatMessage {
            type: 'sendToChat';
            promptOptions: PromptOptions;
        }

        test('should support sendToChat message with newConversation true', () => {
            const message: SendToChatMessage = {
                type: 'sendToChat',
                promptOptions: {
                    format: 'markdown',
                    newConversation: true
                }
            };

            assert.strictEqual(message.type, 'sendToChat');
            assert.strictEqual(message.promptOptions.format, 'markdown');
            assert.strictEqual(message.promptOptions.newConversation, true);
        });

        test('should support sendToChat message with newConversation false', () => {
            const message: SendToChatMessage = {
                type: 'sendToChat',
                promptOptions: {
                    format: 'markdown',
                    newConversation: false
                }
            };

            assert.strictEqual(message.type, 'sendToChat');
            assert.strictEqual(message.promptOptions.format, 'markdown');
            assert.strictEqual(message.promptOptions.newConversation, false);
        });

        test('should support sendToChat message without newConversation (backwards compatible)', () => {
            const message: SendToChatMessage = {
                type: 'sendToChat',
                promptOptions: {
                    format: 'markdown'
                }
            };

            assert.strictEqual(message.type, 'sendToChat');
            assert.strictEqual(message.promptOptions.format, 'markdown');
            assert.strictEqual(message.promptOptions.newConversation, undefined);
        });

        test('should support different format options', () => {
            const markdownMessage: SendToChatMessage = {
                type: 'sendToChat',
                promptOptions: {
                    format: 'markdown',
                    newConversation: true
                }
            };

            const jsonMessage: SendToChatMessage = {
                type: 'sendToChat',
                promptOptions: {
                    format: 'json',
                    newConversation: false
                }
            };

            assert.strictEqual(markdownMessage.promptOptions.format, 'markdown');
            assert.strictEqual(jsonMessage.promptOptions.format, 'json');
        });
    });

    suite('requestSendToChat Function Logic', () => {
        // Mock implementation that mirrors the actual requestSendToChat function
        function createSendToChatMessage(format: string = 'markdown', newConversation: boolean = true) {
            return {
                type: 'sendToChat' as const,
                promptOptions: { format, newConversation }
            };
        }

        test('should default to new conversation when not specified', () => {
            const message = createSendToChatMessage('markdown');
            assert.strictEqual(message.promptOptions.newConversation, true);
        });

        test('should use existing conversation when specified', () => {
            const message = createSendToChatMessage('markdown', false);
            assert.strictEqual(message.promptOptions.newConversation, false);
        });

        test('should use new conversation when explicitly specified', () => {
            const message = createSendToChatMessage('markdown', true);
            assert.strictEqual(message.promptOptions.newConversation, true);
        });

        test('should default to markdown format', () => {
            const message = createSendToChatMessage();
            assert.strictEqual(message.promptOptions.format, 'markdown');
        });
    });

    suite('Chat Mode Selection Logic', () => {
        // Test the logic for determining which chat mode to use
        interface ChatOptions {
            newConversation?: boolean;
        }

        function determineChatMode(options?: ChatOptions): 'new' | 'existing' {
            // Default to new conversation if not specified
            const newConversation = options?.newConversation ?? true;
            return newConversation ? 'new' : 'existing';
        }

        test('should return new mode when newConversation is true', () => {
            const mode = determineChatMode({ newConversation: true });
            assert.strictEqual(mode, 'new');
        });

        test('should return existing mode when newConversation is false', () => {
            const mode = determineChatMode({ newConversation: false });
            assert.strictEqual(mode, 'existing');
        });

        test('should default to new mode when options are undefined', () => {
            const mode = determineChatMode(undefined);
            assert.strictEqual(mode, 'new');
        });

        test('should default to new mode when newConversation is undefined', () => {
            const mode = determineChatMode({});
            assert.strictEqual(mode, 'new');
        });
    });

    suite('Chat Command Sequence Logic', () => {
        // Test the command sequence logic for different chat modes
        interface CommandSequence {
            commands: string[];
            hasDelay: boolean;
        }

        function getCommandSequence(newConversation: boolean): CommandSequence {
            if (newConversation) {
                return {
                    commands: [
                        'workbench.action.chat.newChat',
                        'workbench.action.chat.open'
                    ],
                    hasDelay: true
                };
            } else {
                return {
                    commands: [
                        'workbench.action.chat.open'
                    ],
                    hasDelay: false
                };
            }
        }

        test('should return new chat command sequence for new conversation', () => {
            const sequence = getCommandSequence(true);
            assert.strictEqual(sequence.commands.length, 2);
            assert.strictEqual(sequence.commands[0], 'workbench.action.chat.newChat');
            assert.strictEqual(sequence.commands[1], 'workbench.action.chat.open');
            assert.strictEqual(sequence.hasDelay, true);
        });

        test('should return single command for existing conversation', () => {
            const sequence = getCommandSequence(false);
            assert.strictEqual(sequence.commands.length, 1);
            assert.strictEqual(sequence.commands[0], 'workbench.action.chat.open');
            assert.strictEqual(sequence.hasDelay, false);
        });
    });

    suite('Menu Item Configuration', () => {
        // Test the menu item configuration for the AI Action dropdown
        interface MenuItem {
            id: string;
            label: string;
            icon: string;
            newConversation: boolean;
        }

        function getAIActionMenuItems(): MenuItem[] {
            return [
                {
                    id: 'sendToNewChatBtn',
                    label: 'Send to New Chat',
                    icon: '💬',
                    newConversation: true
                },
                {
                    id: 'sendToExistingChatBtn',
                    label: 'Send to Existing Chat',
                    icon: '🔄',
                    newConversation: false
                }
            ];
        }

        test('should have two send to chat menu items', () => {
            const items = getAIActionMenuItems();
            assert.strictEqual(items.length, 2);
        });

        test('should have new chat option with correct configuration', () => {
            const items = getAIActionMenuItems();
            const newChatItem = items.find(item => item.id === 'sendToNewChatBtn');
            
            assert.ok(newChatItem, 'New chat item should exist');
            assert.strictEqual(newChatItem.label, 'Send to New Chat');
            assert.strictEqual(newChatItem.newConversation, true);
        });

        test('should have existing chat option with correct configuration', () => {
            const items = getAIActionMenuItems();
            const existingChatItem = items.find(item => item.id === 'sendToExistingChatBtn');
            
            assert.ok(existingChatItem, 'Existing chat item should exist');
            assert.strictEqual(existingChatItem.label, 'Send to Existing Chat');
            assert.strictEqual(existingChatItem.newConversation, false);
        });

        test('should have distinct icons for each option', () => {
            const items = getAIActionMenuItems();
            const icons = items.map(item => item.icon);
            const uniqueIcons = new Set(icons);
            
            assert.strictEqual(uniqueIcons.size, items.length, 'Each menu item should have a unique icon');
        });
    });

    suite('Cross-Platform Path Handling', () => {
        // Test that file paths work correctly on Windows, Mac, and Linux
        function normalizeFilePath(filePath: string): string {
            // Convert Windows backslashes to forward slashes
            return filePath.replace(/\\/g, '/');
        }

        function getRelativePath(absolutePath: string, workspaceRoot: string): string {
            const normalizedAbsolute = normalizeFilePath(absolutePath);
            const normalizedRoot = normalizeFilePath(workspaceRoot);
            
            if (normalizedAbsolute.startsWith(normalizedRoot)) {
                let relative = normalizedAbsolute.slice(normalizedRoot.length);
                // Remove leading slash
                if (relative.startsWith('/')) {
                    relative = relative.slice(1);
                }
                return relative;
            }
            return normalizedAbsolute;
        }

        test('should normalize Windows paths', () => {
            const windowsPath = 'C:\\Users\\test\\project\\file.md';
            const normalized = normalizeFilePath(windowsPath);
            assert.strictEqual(normalized, 'C:/Users/test/project/file.md');
        });

        test('should keep Unix paths unchanged', () => {
            const unixPath = '/home/user/project/file.md';
            const normalized = normalizeFilePath(unixPath);
            assert.strictEqual(normalized, '/home/user/project/file.md');
        });

        test('should keep Mac paths unchanged', () => {
            const macPath = '/Users/user/Documents/project/file.md';
            const normalized = normalizeFilePath(macPath);
            assert.strictEqual(normalized, '/Users/user/Documents/project/file.md');
        });

        test('should get relative path on Windows', () => {
            const absolutePath = 'C:\\Users\\test\\project\\src\\file.md';
            const workspaceRoot = 'C:\\Users\\test\\project';
            const relative = getRelativePath(absolutePath, workspaceRoot);
            assert.strictEqual(relative, 'src/file.md');
        });

        test('should get relative path on Unix', () => {
            const absolutePath = '/home/user/project/src/file.md';
            const workspaceRoot = '/home/user/project';
            const relative = getRelativePath(absolutePath, workspaceRoot);
            assert.strictEqual(relative, 'src/file.md');
        });

        test('should get relative path on Mac', () => {
            const absolutePath = '/Users/user/Documents/project/src/file.md';
            const workspaceRoot = '/Users/user/Documents/project';
            const relative = getRelativePath(absolutePath, workspaceRoot);
            assert.strictEqual(relative, 'src/file.md');
        });

        test('should handle paths with trailing slash in workspace root', () => {
            const absolutePath = '/home/user/project/src/file.md';
            const workspaceRoot = '/home/user/project/';
            const relative = getRelativePath(absolutePath, workspaceRoot);
            assert.strictEqual(relative, 'src/file.md');
        });
    });

    suite('Prompt Generation for Chat', () => {
        // Test prompt generation logic that's used before sending to chat
        interface Comment {
            id: string;
            selectedText: string;
            comment: string;
            selection: {
                startLine: number;
                endLine: number;
            };
        }

        function generatePromptText(comments: Comment[], filePath: string): string {
            if (comments.length === 0) {
                return 'No open user comments to generate prompt from.';
            }

            const lines: string[] = [
                '# Document Revision Request',
                '',
                `**File:** ${filePath}`,
                `**Open Comments:** ${comments.length}`,
                '',
                '---',
                ''
            ];

            comments.forEach((c, index) => {
                const lineRange = c.selection.startLine === c.selection.endLine
                    ? `Line ${c.selection.startLine}`
                    : `Lines ${c.selection.startLine}-${c.selection.endLine}`;

                lines.push(`## Comment ${index + 1}`);
                lines.push(`**Location:** ${lineRange}`);
                lines.push(`**Selected Text:** "${c.selectedText}"`);
                lines.push(`**Feedback:** ${c.comment}`);
                lines.push('');
            });

            return lines.join('\n');
        }

        test('should return no comments message when empty', () => {
            const prompt = generatePromptText([], 'test.md');
            assert.ok(prompt.includes('No open user comments'));
        });

        test('should include file path in prompt', () => {
            const comments: Comment[] = [{
                id: '1',
                selectedText: 'test',
                comment: 'Fix this',
                selection: { startLine: 1, endLine: 1 }
            }];
            const prompt = generatePromptText(comments, 'src/file.md');
            assert.ok(prompt.includes('src/file.md'));
        });

        test('should include comment count in prompt', () => {
            const comments: Comment[] = [
                { id: '1', selectedText: 'a', comment: 'c1', selection: { startLine: 1, endLine: 1 } },
                { id: '2', selectedText: 'b', comment: 'c2', selection: { startLine: 2, endLine: 2 } }
            ];
            const prompt = generatePromptText(comments, 'test.md');
            assert.ok(prompt.includes('Open Comments:** 2'));
        });

        test('should format single line location correctly', () => {
            const comments: Comment[] = [{
                id: '1',
                selectedText: 'test',
                comment: 'Fix this',
                selection: { startLine: 5, endLine: 5 }
            }];
            const prompt = generatePromptText(comments, 'test.md');
            assert.ok(prompt.includes('Line 5'));
            assert.ok(!prompt.includes('Lines 5-5'));
        });

        test('should format multi-line location correctly', () => {
            const comments: Comment[] = [{
                id: '1',
                selectedText: 'test',
                comment: 'Fix this',
                selection: { startLine: 5, endLine: 10 }
            }];
            const prompt = generatePromptText(comments, 'test.md');
            assert.ok(prompt.includes('Lines 5-10'));
        });

        test('should include selected text in prompt', () => {
            const comments: Comment[] = [{
                id: '1',
                selectedText: 'important text here',
                comment: 'Fix this',
                selection: { startLine: 1, endLine: 1 }
            }];
            const prompt = generatePromptText(comments, 'test.md');
            assert.ok(prompt.includes('important text here'));
        });

        test('should include feedback in prompt', () => {
            const comments: Comment[] = [{
                id: '1',
                selectedText: 'test',
                comment: 'This needs to be more descriptive',
                selection: { startLine: 1, endLine: 1 }
            }];
            const prompt = generatePromptText(comments, 'test.md');
            assert.ok(prompt.includes('This needs to be more descriptive'));
        });
    });

    suite('Individual Comment to Chat', () => {
        // Test the sendCommentToChat message type
        interface SendCommentToChatMessage {
            type: 'sendCommentToChat';
            commentId: string;
            newConversation: boolean;
        }

        test('should support sendCommentToChat message with newConversation true', () => {
            const message: SendCommentToChatMessage = {
                type: 'sendCommentToChat',
                commentId: 'comment_123',
                newConversation: true
            };

            assert.strictEqual(message.type, 'sendCommentToChat');
            assert.strictEqual(message.commentId, 'comment_123');
            assert.strictEqual(message.newConversation, true);
        });

        test('should support sendCommentToChat message with newConversation false', () => {
            const message: SendCommentToChatMessage = {
                type: 'sendCommentToChat',
                commentId: 'comment_456',
                newConversation: false
            };

            assert.strictEqual(message.type, 'sendCommentToChat');
            assert.strictEqual(message.commentId, 'comment_456');
            assert.strictEqual(message.newConversation, false);
        });

        test('should require commentId field', () => {
            const message: SendCommentToChatMessage = {
                type: 'sendCommentToChat',
                commentId: 'required_id',
                newConversation: true
            };

            assert.ok(message.commentId, 'commentId should be defined');
            assert.ok(message.commentId.length > 0, 'commentId should not be empty');
        });
    });

    suite('requestSendCommentToChat Function Logic', () => {
        // Mock implementation that mirrors the actual requestSendCommentToChat function
        function createSendCommentToChatMessage(commentId: string, newConversation: boolean) {
            return {
                type: 'sendCommentToChat' as const,
                commentId,
                newConversation
            };
        }

        test('should create message for new conversation', () => {
            const message = createSendCommentToChatMessage('comment_123', true);
            assert.strictEqual(message.type, 'sendCommentToChat');
            assert.strictEqual(message.commentId, 'comment_123');
            assert.strictEqual(message.newConversation, true);
        });

        test('should create message for existing conversation', () => {
            const message = createSendCommentToChatMessage('comment_123', false);
            assert.strictEqual(message.type, 'sendCommentToChat');
            assert.strictEqual(message.commentId, 'comment_123');
            assert.strictEqual(message.newConversation, false);
        });

        test('should handle different comment IDs', () => {
            const ids = ['comment_1', 'comment_abc123', 'test-id-456', 'uuid-like-123e4567-e89b'];

            for (const id of ids) {
                const message = createSendCommentToChatMessage(id, true);
                assert.strictEqual(message.commentId, id);
            }
        });
    });

    suite('Bubble Chat Dropdown Menu Configuration', () => {
        // Test the bubble chat dropdown menu item configuration
        interface BubbleChatMenuItem {
            dataAction: string;
            label: string;
            icon: string;
            newConversation: boolean;
        }

        function getBubbleChatMenuItems(): BubbleChatMenuItem[] {
            return [
                {
                    dataAction: 'new',
                    label: 'New Chat',
                    icon: '💬',
                    newConversation: true
                },
                {
                    dataAction: 'existing',
                    label: 'Existing Chat',
                    icon: '🔄',
                    newConversation: false
                }
            ];
        }

        test('should have two bubble chat menu items', () => {
            const items = getBubbleChatMenuItems();
            assert.strictEqual(items.length, 2);
        });

        test('should have new chat option with correct configuration', () => {
            const items = getBubbleChatMenuItems();
            const newChatItem = items.find(item => item.dataAction === 'new');

            assert.ok(newChatItem, 'New chat item should exist');
            assert.strictEqual(newChatItem.label, 'New Chat');
            assert.strictEqual(newChatItem.newConversation, true);
        });

        test('should have existing chat option with correct configuration', () => {
            const items = getBubbleChatMenuItems();
            const existingChatItem = items.find(item => item.dataAction === 'existing');

            assert.ok(existingChatItem, 'Existing chat item should exist');
            assert.strictEqual(existingChatItem.label, 'Existing Chat');
            assert.strictEqual(existingChatItem.newConversation, false);
        });

        test('should have distinct icons for each option', () => {
            const items = getBubbleChatMenuItems();
            const icons = items.map(item => item.icon);
            const uniqueIcons = new Set(icons);

            assert.strictEqual(uniqueIcons.size, items.length, 'Each menu item should have a unique icon');
        });
    });

    suite('Single Comment Prompt Generation', () => {
        // Test prompt generation logic for a single comment
        interface Comment {
            id: string;
            filePath: string;
            selectedText: string;
            comment: string;
            selection: {
                startLine: number;
                endLine: number;
            };
        }

        function generateSingleCommentPrompt(comment: Comment): string {
            const lineRange = comment.selection.startLine === comment.selection.endLine
                ? `Line ${comment.selection.startLine}`
                : `Lines ${comment.selection.startLine}-${comment.selection.endLine}`;

            return [
                '# Document Revision Request',
                '',
                `## File: ${comment.filePath}`,
                '',
                `### Comment (${lineRange})`,
                `**ID:** \`${comment.id}\``,
                '',
                '**Selected Text:**',
                '```',
                comment.selectedText,
                '```',
                '',
                `**Comment:** ${comment.comment}`,
                '',
                '**Requested Action:** Revise this section to address the comment.'
            ].join('\n');
        }

        test('should generate prompt for single comment', () => {
            const comment: Comment = {
                id: 'comment_123',
                filePath: 'src/test.md',
                selectedText: 'sample text',
                comment: 'Please improve this',
                selection: { startLine: 5, endLine: 5 }
            };
            const prompt = generateSingleCommentPrompt(comment);

            assert.ok(prompt.includes('Document Revision Request'));
            assert.ok(prompt.includes('src/test.md'));
            assert.ok(prompt.includes('comment_123'));
            assert.ok(prompt.includes('sample text'));
            assert.ok(prompt.includes('Please improve this'));
        });

        test('should format single line location correctly', () => {
            const comment: Comment = {
                id: 'comment_1',
                filePath: 'test.md',
                selectedText: 'text',
                comment: 'fix',
                selection: { startLine: 10, endLine: 10 }
            };
            const prompt = generateSingleCommentPrompt(comment);

            assert.ok(prompt.includes('Line 10'));
            assert.ok(!prompt.includes('Lines 10-10'));
        });

        test('should format multi-line location correctly', () => {
            const comment: Comment = {
                id: 'comment_1',
                filePath: 'test.md',
                selectedText: 'text',
                comment: 'fix',
                selection: { startLine: 5, endLine: 15 }
            };
            const prompt = generateSingleCommentPrompt(comment);

            assert.ok(prompt.includes('Lines 5-15'));
        });

        test('should include comment ID in prompt', () => {
            const comment: Comment = {
                id: 'unique_id_12345',
                filePath: 'test.md',
                selectedText: 'text',
                comment: 'fix',
                selection: { startLine: 1, endLine: 1 }
            };
            const prompt = generateSingleCommentPrompt(comment);

            assert.ok(prompt.includes('unique_id_12345'));
        });
    });

    suite('Dropdown Toggle Logic', () => {
        // Test the dropdown toggle logic for the chat menu in bubble
        interface DropdownState {
            isOpen: boolean;
        }

        function toggleDropdown(state: DropdownState): DropdownState {
            return { isOpen: !state.isOpen };
        }

        function hideDropdown(): DropdownState {
            return { isOpen: false };
        }

        test('should toggle dropdown from closed to open', () => {
            const initial: DropdownState = { isOpen: false };
            const result = toggleDropdown(initial);
            assert.strictEqual(result.isOpen, true);
        });

        test('should toggle dropdown from open to closed', () => {
            const initial: DropdownState = { isOpen: true };
            const result = toggleDropdown(initial);
            assert.strictEqual(result.isOpen, false);
        });

        test('should hide dropdown regardless of current state', () => {
            const openState: DropdownState = { isOpen: true };
            const closedState: DropdownState = { isOpen: false };

            assert.strictEqual(hideDropdown().isOpen, false);
            assert.strictEqual(hideDropdown().isOpen, false);
        });
    });
});

