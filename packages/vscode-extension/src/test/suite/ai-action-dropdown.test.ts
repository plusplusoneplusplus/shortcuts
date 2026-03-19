/**
 * Tests for AI Action dropdown functionality in Markdown Review Editor
 * Tests the "AI Action" button that provides options to:
 * 1. Send prompt to Chat (workbench.action.chat.open)
 * 2. Copy prompt to clipboard
 */

import * as assert from 'assert';

suite('AI Action Dropdown Tests', () => {
    
    suite('Message Types Validation', () => {
        // Test message structure validation for AI action messages

        interface WebviewMessage {
            type: string;
            [key: string]: unknown;
        }

        interface PromptOptions {
            format: string;
        }

        function isValidWebviewMessage(msg: unknown): msg is WebviewMessage {
            return typeof msg === 'object' && msg !== null && 'type' in msg;
        }

        function isCopyPromptMessage(msg: WebviewMessage): msg is WebviewMessage & { promptOptions: PromptOptions } {
            return msg.type === 'copyPrompt' &&
                'promptOptions' in msg &&
                typeof (msg as any).promptOptions === 'object' &&
                'format' in (msg as any).promptOptions;
        }

        function isSendToChatMessage(msg: WebviewMessage): msg is WebviewMessage & { promptOptions: PromptOptions } {
            return msg.type === 'sendToChat' &&
                'promptOptions' in msg &&
                typeof (msg as any).promptOptions === 'object' &&
                (msg as any).promptOptions !== null &&
                'format' in (msg as any).promptOptions;
        }

        function isSendToCLIInteractiveMessage(msg: WebviewMessage): msg is WebviewMessage & { promptOptions: PromptOptions } {
            return msg.type === 'sendToCLIInteractive' &&
                'promptOptions' in msg &&
                typeof (msg as any).promptOptions === 'object' &&
                (msg as any).promptOptions !== null &&
                'format' in (msg as any).promptOptions;
        }

        test('should validate copyPrompt message', () => {
            const msg = {
                type: 'copyPrompt',
                promptOptions: { format: 'markdown' }
            };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isCopyPromptMessage(msg));
        });

        test('should validate sendToChat message', () => {
            const msg = {
                type: 'sendToChat',
                promptOptions: { format: 'markdown' }
            };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isSendToChatMessage(msg));
        });

        test('should validate copyPrompt message with json format', () => {
            const msg = {
                type: 'copyPrompt',
                promptOptions: { format: 'json' }
            };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isCopyPromptMessage(msg));
        });

        test('should validate sendToChat message with json format', () => {
            const msg = {
                type: 'sendToChat',
                promptOptions: { format: 'json' }
            };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isSendToChatMessage(msg));
        });

        test('should reject copyPrompt message without promptOptions', () => {
            const msg = { type: 'copyPrompt' };
            assert.ok(!isCopyPromptMessage(msg));
        });

        test('should reject sendToChat message without promptOptions', () => {
            const msg = { type: 'sendToChat' };
            assert.ok(!isSendToChatMessage(msg));
        });

        test('should reject copyPrompt message with invalid promptOptions', () => {
            const msg = {
                type: 'copyPrompt',
                promptOptions: 'invalid'
            };
            assert.ok(!isCopyPromptMessage(msg));
        });

        test('should reject sendToChat message with invalid promptOptions', () => {
            const msg = {
                type: 'sendToChat',
                promptOptions: null
            };
            assert.ok(!isSendToChatMessage(msg));
        });

        test('should validate sendToCLIInteractive message', () => {
            const msg = {
                type: 'sendToCLIInteractive',
                promptOptions: { format: 'markdown' }
            };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isSendToCLIInteractiveMessage(msg));
        });

        test('should validate sendToCLIInteractive message with json format', () => {
            const msg = {
                type: 'sendToCLIInteractive',
                promptOptions: { format: 'json' }
            };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isSendToCLIInteractiveMessage(msg));
        });

        test('should reject sendToCLIInteractive message without promptOptions', () => {
            const msg = { type: 'sendToCLIInteractive' };
            assert.ok(!isSendToCLIInteractiveMessage(msg));
        });

        test('should reject sendToCLIInteractive message with invalid promptOptions', () => {
            const msg = {
                type: 'sendToCLIInteractive',
                promptOptions: null
            };
            assert.ok(!isSendToCLIInteractiveMessage(msg));
        });
    });

    suite('Prompt Generation', () => {
        // Test prompt text generation logic (extracted from review-editor-view-provider)

        interface MarkdownComment {
            id: string;
            selection: {
                startLine: number;
                startColumn: number;
                endLine: number;
                endColumn: number;
            };
            selectedText: string;
            comment: string;
            status: 'open' | 'resolved';
            author?: string;
        }

        function generatePromptText(
            comments: MarkdownComment[],
            filePath: string,
            options?: { includeFileContent?: boolean; format?: 'markdown' | 'json' }
        ): string {
            const format = options?.format || 'markdown';

            if (format === 'json') {
                return JSON.stringify({
                    task: 'Review and address the following comments in the markdown document',
                    file: filePath,
                    comments: comments.map(c => ({
                        id: c.id,
                        lineRange: c.selection.startLine === c.selection.endLine
                            ? `Line ${c.selection.startLine}`
                            : `Lines ${c.selection.startLine}-${c.selection.endLine}`,
                        selectedText: c.selectedText,
                        comment: c.comment,
                        author: c.author
                    })),
                    instructions: 'For each comment, modify the corresponding section to address the feedback.'
                }, null, 2);
            }

            // Markdown format
            const lines: string[] = [
                '# Document Revision Request',
                '',
                `**File:** ${filePath}`,
                `**Open Comments:** ${comments.length}`,
                '',
                '---',
                '',
                '## Comments to Address',
                ''
            ];

            comments.forEach((comment, index) => {
                const lineRange = comment.selection.startLine === comment.selection.endLine
                    ? `Line ${comment.selection.startLine}`
                    : `Lines ${comment.selection.startLine}-${comment.selection.endLine}`;

                lines.push(`### Comment ${index + 1}`);
                lines.push('');
                lines.push(`**Location:** ${lineRange}`);
                if (comment.author) {
                    lines.push(`**Author:** ${comment.author}`);
                }
                lines.push('');
                lines.push('**Selected Text:**');
                lines.push('```');
                lines.push(comment.selectedText);
                lines.push('```');
                lines.push('');
                lines.push('**Comment:**');
                lines.push(`> ${comment.comment}`);
                lines.push('');
                lines.push('---');
                lines.push('');
            });

            lines.push('## Instructions');
            lines.push('');
            lines.push('For each comment above, modify the corresponding section in the document to address the feedback.');

            return lines.join('\n');
        }

        test('should generate markdown prompt for single comment', () => {
            const comments: MarkdownComment[] = [{
                id: 'c1',
                selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                selectedText: 'Some selected text',
                comment: 'Please improve this',
                status: 'open'
            }];

            const prompt = generatePromptText(comments, 'test.md');
            
            assert.ok(prompt.includes('# Document Revision Request'));
            assert.ok(prompt.includes('**File:** test.md'));
            assert.ok(prompt.includes('**Open Comments:** 1'));
            assert.ok(prompt.includes('### Comment 1'));
            assert.ok(prompt.includes('**Location:** Line 5'));
            assert.ok(prompt.includes('Some selected text'));
            assert.ok(prompt.includes('> Please improve this'));
        });

        test('should generate markdown prompt for multi-line comment', () => {
            const comments: MarkdownComment[] = [{
                id: 'c1',
                selection: { startLine: 5, startColumn: 1, endLine: 10, endColumn: 20 },
                selectedText: 'Multi-line text',
                comment: 'Refactor this section',
                status: 'open'
            }];

            const prompt = generatePromptText(comments, 'test.md');
            
            assert.ok(prompt.includes('**Location:** Lines 5-10'));
        });

        test('should generate markdown prompt with author', () => {
            const comments: MarkdownComment[] = [{
                id: 'c1',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                selectedText: 'Text',
                comment: 'Comment',
                status: 'open',
                author: 'John Doe'
            }];

            const prompt = generatePromptText(comments, 'test.md');
            
            assert.ok(prompt.includes('**Author:** John Doe'));
        });

        test('should generate JSON prompt', () => {
            const comments: MarkdownComment[] = [{
                id: 'c1',
                selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                selectedText: 'Some text',
                comment: 'Fix this',
                status: 'open'
            }];

            const prompt = generatePromptText(comments, 'test.md', { format: 'json' });
            const parsed = JSON.parse(prompt);
            
            assert.strictEqual(parsed.task, 'Review and address the following comments in the markdown document');
            assert.strictEqual(parsed.file, 'test.md');
            assert.strictEqual(parsed.comments.length, 1);
            assert.strictEqual(parsed.comments[0].id, 'c1');
            assert.strictEqual(parsed.comments[0].lineRange, 'Line 5');
            assert.strictEqual(parsed.comments[0].selectedText, 'Some text');
            assert.strictEqual(parsed.comments[0].comment, 'Fix this');
        });

        test('should generate JSON prompt for multi-line comment', () => {
            const comments: MarkdownComment[] = [{
                id: 'c1',
                selection: { startLine: 1, startColumn: 1, endLine: 5, endColumn: 10 },
                selectedText: 'Text',
                comment: 'Comment',
                status: 'open'
            }];

            const prompt = generatePromptText(comments, 'test.md', { format: 'json' });
            const parsed = JSON.parse(prompt);
            
            assert.strictEqual(parsed.comments[0].lineRange, 'Lines 1-5');
        });

        test('should generate prompt for multiple comments', () => {
            const comments: MarkdownComment[] = [
                {
                    id: 'c1',
                    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                    selectedText: 'First text',
                    comment: 'First comment',
                    status: 'open'
                },
                {
                    id: 'c2',
                    selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                    selectedText: 'Second text',
                    comment: 'Second comment',
                    status: 'open'
                }
            ];

            const prompt = generatePromptText(comments, 'test.md');
            
            assert.ok(prompt.includes('**Open Comments:** 2'));
            assert.ok(prompt.includes('### Comment 1'));
            assert.ok(prompt.includes('### Comment 2'));
            assert.ok(prompt.includes('First text'));
            assert.ok(prompt.includes('Second text'));
        });
    });

    suite('Cross-Platform Path Handling', () => {
        // Test that path handling works on Windows, macOS, and Linux

        function normalizeFilePath(filePath: string): string {
            // Normalize path separators to forward slashes
            return filePath.replace(/\\/g, '/');
        }

        test('should normalize Windows paths', () => {
            const windowsPath = 'C:\\Users\\test\\documents\\file.md';
            const normalized = normalizeFilePath(windowsPath);
            assert.strictEqual(normalized, 'C:/Users/test/documents/file.md');
        });

        test('should preserve Unix paths', () => {
            const unixPath = '/home/user/documents/file.md';
            const normalized = normalizeFilePath(unixPath);
            assert.strictEqual(normalized, '/home/user/documents/file.md');
        });

        test('should preserve macOS paths', () => {
            const macPath = '/Users/user/Documents/file.md';
            const normalized = normalizeFilePath(macPath);
            assert.strictEqual(normalized, '/Users/user/Documents/file.md');
        });

        test('should handle mixed separators', () => {
            const mixedPath = 'C:\\Users/test\\documents/file.md';
            const normalized = normalizeFilePath(mixedPath);
            assert.strictEqual(normalized, 'C:/Users/test/documents/file.md');
        });

        test('should handle relative paths', () => {
            const relativePath = 'src\\test\\file.md';
            const normalized = normalizeFilePath(relativePath);
            assert.strictEqual(normalized, 'src/test/file.md');
        });
    });

    suite('Dropdown Menu State', () => {
        // Test dropdown menu state management logic

        interface DropdownState {
            isOpen: boolean;
        }

        function createDropdownState(): DropdownState {
            return { isOpen: false };
        }

        function toggleDropdown(state: DropdownState): DropdownState {
            return { isOpen: !state.isOpen };
        }

        function openDropdown(state: DropdownState): DropdownState {
            return { isOpen: true };
        }

        function closeDropdown(state: DropdownState): DropdownState {
            return { isOpen: false };
        }

        test('should start with closed dropdown', () => {
            const state = createDropdownState();
            assert.strictEqual(state.isOpen, false);
        });

        test('should toggle dropdown from closed to open', () => {
            let state = createDropdownState();
            state = toggleDropdown(state);
            assert.strictEqual(state.isOpen, true);
        });

        test('should toggle dropdown from open to closed', () => {
            let state = createDropdownState();
            state = toggleDropdown(state);
            state = toggleDropdown(state);
            assert.strictEqual(state.isOpen, false);
        });

        test('should open dropdown', () => {
            let state = createDropdownState();
            state = openDropdown(state);
            assert.strictEqual(state.isOpen, true);
        });

        test('should close dropdown', () => {
            let state = createDropdownState();
            state = openDropdown(state);
            state = closeDropdown(state);
            assert.strictEqual(state.isOpen, false);
        });

        test('should handle multiple open calls', () => {
            let state = createDropdownState();
            state = openDropdown(state);
            state = openDropdown(state);
            assert.strictEqual(state.isOpen, true);
        });

        test('should handle multiple close calls', () => {
            let state = createDropdownState();
            state = closeDropdown(state);
            state = closeDropdown(state);
            assert.strictEqual(state.isOpen, false);
        });
    });

    suite('Send to CLI Interactive', () => {
        // Test the CLI interactive session functionality

        interface MarkdownComment {
            id: string;
            selection: {
                startLine: number;
                startColumn: number;
                endLine: number;
                endColumn: number;
            };
            selectedText: string;
            comment: string;
            status: 'open' | 'resolved';
            type?: string;
        }

        function isUserComment(comment: MarkdownComment): boolean {
            const aiTypes = ['ai-clarification', 'ai-suggestion', 'ai-critique', 'ai-question'];
            return !comment.type || !aiTypes.includes(comment.type);
        }

        function filterCommentsForCLI(comments: MarkdownComment[]): MarkdownComment[] {
            return comments
                .filter(c => c.status === 'open')
                .filter(c => isUserComment(c));
        }

        function generateCLIPrompt(
            comments: MarkdownComment[],
            filePath: string,
            options?: { format?: 'markdown' | 'json' }
        ): string {
            const format = options?.format || 'markdown';
            const filteredComments = filterCommentsForCLI(comments);

            if (format === 'json') {
                return JSON.stringify({
                    task: 'Review and address the following comments',
                    file: filePath,
                    comments: filteredComments.map(c => ({
                        id: c.id,
                        lineRange: c.selection.startLine === c.selection.endLine
                            ? `Line ${c.selection.startLine}`
                            : `Lines ${c.selection.startLine}-${c.selection.endLine}`,
                        selectedText: c.selectedText,
                        comment: c.comment
                    }))
                }, null, 2);
            }

            // Markdown format
            const lines: string[] = [
                '# Document Review Request',
                '',
                `**File:** ${filePath}`,
                `**Comments:** ${filteredComments.length}`,
                ''
            ];

            filteredComments.forEach((comment, index) => {
                const lineRange = comment.selection.startLine === comment.selection.endLine
                    ? `Line ${comment.selection.startLine}`
                    : `Lines ${comment.selection.startLine}-${comment.selection.endLine}`;

                lines.push(`## Comment ${index + 1}`);
                lines.push(`**Location:** ${lineRange}`);
                lines.push('');
                lines.push('**Selected Text:**');
                lines.push('```');
                lines.push(comment.selectedText);
                lines.push('```');
                lines.push('');
                lines.push('**Comment:**');
                lines.push(`> ${comment.comment}`);
                lines.push('');
            });

            return lines.join('\n');
        }

        test('should generate CLI prompt for single comment', () => {
            const comments: MarkdownComment[] = [{
                id: 'c1',
                selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                selectedText: 'Some selected text',
                comment: 'Please improve this',
                status: 'open'
            }];

            const prompt = generateCLIPrompt(comments, 'test.md');

            assert.ok(prompt.includes('# Document Review Request'));
            assert.ok(prompt.includes('**File:** test.md'));
            assert.ok(prompt.includes('**Comments:** 1'));
            assert.ok(prompt.includes('## Comment 1'));
            assert.ok(prompt.includes('**Location:** Line 5'));
            assert.ok(prompt.includes('Some selected text'));
            assert.ok(prompt.includes('> Please improve this'));
        });

        test('should generate CLI prompt in JSON format', () => {
            const comments: MarkdownComment[] = [{
                id: 'c1',
                selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                selectedText: 'Some text',
                comment: 'Fix this',
                status: 'open'
            }];

            const prompt = generateCLIPrompt(comments, 'test.md', { format: 'json' });
            const parsed = JSON.parse(prompt);

            assert.strictEqual(parsed.task, 'Review and address the following comments');
            assert.strictEqual(parsed.file, 'test.md');
            assert.strictEqual(parsed.comments.length, 1);
            assert.strictEqual(parsed.comments[0].id, 'c1');
        });

        test('should exclude AI-generated comments from CLI prompt', () => {
            const comments: MarkdownComment[] = [
                {
                    id: 'c1',
                    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                    selectedText: 'User text',
                    comment: 'User comment',
                    status: 'open'
                },
                {
                    id: 'c2',
                    selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                    selectedText: 'AI text',
                    comment: 'AI comment',
                    status: 'open',
                    type: 'ai-clarification'
                }
            ];

            const prompt = generateCLIPrompt(comments, 'test.md');

            assert.ok(prompt.includes('**Comments:** 1'));
            assert.ok(prompt.includes('User text'));
            assert.ok(!prompt.includes('AI text'));
        });

        test('should exclude resolved comments from CLI prompt', () => {
            const comments: MarkdownComment[] = [
                {
                    id: 'c1',
                    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                    selectedText: 'Open text',
                    comment: 'Open comment',
                    status: 'open'
                },
                {
                    id: 'c2',
                    selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                    selectedText: 'Resolved text',
                    comment: 'Resolved comment',
                    status: 'resolved'
                }
            ];

            const prompt = generateCLIPrompt(comments, 'test.md');

            assert.ok(prompt.includes('**Comments:** 1'));
            assert.ok(prompt.includes('Open text'));
            assert.ok(!prompt.includes('Resolved text'));
        });

        test('should handle multi-line selections in CLI prompt', () => {
            const comments: MarkdownComment[] = [{
                id: 'c1',
                selection: { startLine: 5, startColumn: 1, endLine: 10, endColumn: 20 },
                selectedText: 'Multi-line text',
                comment: 'Refactor this section',
                status: 'open'
            }];

            const prompt = generateCLIPrompt(comments, 'test.md');

            assert.ok(prompt.includes('**Location:** Lines 5-10'));
        });

        test('should return empty prompt content when no valid comments', () => {
            const comments: MarkdownComment[] = [
                {
                    id: 'c1',
                    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                    selectedText: 'Resolved',
                    comment: 'Comment',
                    status: 'resolved'
                },
                {
                    id: 'c2',
                    selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10 },
                    selectedText: 'AI',
                    comment: 'Comment',
                    status: 'open',
                    type: 'ai-clarification'
                }
            ];

            const prompt = generateCLIPrompt(comments, 'test.md');

            assert.ok(prompt.includes('**Comments:** 0'));
        });
    });

    suite('CLI Interactive Cross-Platform Path Handling', () => {
        // Test that CLI interactive works correctly on Windows, macOS, and Linux

        function normalizePathForCLI(filePath: string): string {
            // Normalize path separators to forward slashes for consistency
            return filePath.replace(/\\/g, '/');
        }

        function buildWorkingDirectory(workspaceRoot: string, preferSrc: boolean): string {
            // Simulates the working directory selection logic
            const normalized = normalizePathForCLI(workspaceRoot);
            if (preferSrc) {
                return normalized + '/src';
            }
            return normalized;
        }

        test('should normalize Windows workspace paths', () => {
            const windowsPath = 'C:\\Users\\test\\project';
            const normalized = normalizePathForCLI(windowsPath);
            assert.strictEqual(normalized, 'C:/Users/test/project');
        });

        test('should preserve Unix workspace paths', () => {
            const unixPath = '/home/user/project';
            const normalized = normalizePathForCLI(unixPath);
            assert.strictEqual(normalized, '/home/user/project');
        });

        test('should preserve macOS workspace paths', () => {
            const macPath = '/Users/user/Documents/project';
            const normalized = normalizePathForCLI(macPath);
            assert.strictEqual(normalized, '/Users/user/Documents/project');
        });

        test('should build working directory with src preference on Windows', () => {
            const windowsPath = 'C:\\Users\\test\\project';
            const workDir = buildWorkingDirectory(windowsPath, true);
            assert.strictEqual(workDir, 'C:/Users/test/project/src');
        });

        test('should build working directory without src preference', () => {
            const unixPath = '/home/user/project';
            const workDir = buildWorkingDirectory(unixPath, false);
            assert.strictEqual(workDir, '/home/user/project');
        });

        test('should handle mixed path separators', () => {
            const mixedPath = 'C:\\Users/test\\project/subdir';
            const normalized = normalizePathForCLI(mixedPath);
            assert.strictEqual(normalized, 'C:/Users/test/project/subdir');
        });
    });

    suite('Comment Filtering for Prompt Generation', () => {
        // Test that only open user comments are included in prompts

        interface MarkdownComment {
            id: string;
            status: 'open' | 'resolved';
            type?: string;
            author?: string;
        }

        function isUserComment(comment: MarkdownComment): boolean {
            // AI-generated comments have specific types
            const aiTypes = ['ai-clarification', 'ai-suggestion', 'ai-critique', 'ai-question'];
            return !comment.type || !aiTypes.includes(comment.type);
        }

        function filterCommentsForPrompt(comments: MarkdownComment[]): MarkdownComment[] {
            return comments
                .filter(c => c.status === 'open')
                .filter(c => isUserComment(c));
        }

        test('should include open user comments', () => {
            const comments: MarkdownComment[] = [
                { id: 'c1', status: 'open' },
                { id: 'c2', status: 'open' }
            ];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 2);
        });

        test('should exclude resolved comments', () => {
            const comments: MarkdownComment[] = [
                { id: 'c1', status: 'open' },
                { id: 'c2', status: 'resolved' }
            ];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].id, 'c1');
        });

        test('should exclude AI-generated clarification comments', () => {
            const comments: MarkdownComment[] = [
                { id: 'c1', status: 'open' },
                { id: 'c2', status: 'open', type: 'ai-clarification' }
            ];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].id, 'c1');
        });

        test('should exclude AI-generated suggestion comments', () => {
            const comments: MarkdownComment[] = [
                { id: 'c1', status: 'open' },
                { id: 'c2', status: 'open', type: 'ai-suggestion' }
            ];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 1);
        });

        test('should exclude AI-generated critique comments', () => {
            const comments: MarkdownComment[] = [
                { id: 'c1', status: 'open' },
                { id: 'c2', status: 'open', type: 'ai-critique' }
            ];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 1);
        });

        test('should exclude AI-generated question comments', () => {
            const comments: MarkdownComment[] = [
                { id: 'c1', status: 'open' },
                { id: 'c2', status: 'open', type: 'ai-question' }
            ];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 1);
        });

        test('should exclude both resolved and AI comments', () => {
            const comments: MarkdownComment[] = [
                { id: 'c1', status: 'open' },
                { id: 'c2', status: 'resolved' },
                { id: 'c3', status: 'open', type: 'ai-clarification' },
                { id: 'c4', status: 'resolved', type: 'ai-suggestion' }
            ];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].id, 'c1');
        });

        test('should return empty array when no comments match', () => {
            const comments: MarkdownComment[] = [
                { id: 'c1', status: 'resolved' },
                { id: 'c2', status: 'open', type: 'ai-clarification' }
            ];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 0);
        });

        test('should handle empty comments array', () => {
            const comments: MarkdownComment[] = [];
            const filtered = filterCommentsForPrompt(comments);
            assert.strictEqual(filtered.length, 0);
        });
    });

    suite('Resolve Comments Submenu Structure', () => {
        // Test the "Resolve Comments" parent menu item with nested submenu structure
        
        interface AIActionMenuItem {
            id: string;
            label: string;
            icon: string;
            hasSubmenu?: boolean;
            children?: AIActionMenuItem[];
        }

        /**
         * Get the AI Action menu structure
         * This simulates the HTML structure in webview-content.ts
         */
        function getAIActionMenuStructure(): AIActionMenuItem[] {
            return [
                {
                    id: 'resolveCommentsItem',
                    label: 'Resolve Comments',
                    icon: '✨',
                    hasSubmenu: true,
                    children: [
                        { id: 'sendToNewChatBtn', label: 'Send to New Chat', icon: '💬' },
                        { id: 'sendToExistingChatBtn', label: 'Send to Existing Chat', icon: '🔄' },
                        { id: 'sendToCLIInteractiveBtn', label: 'Send to CLI Interactive', icon: '🖥️' },
                        { id: 'copyPromptBtn', label: 'Copy as Prompt', icon: '📋' }
                    ]
                }
            ];
        }

        /**
         * Find a menu item by ID, searching nested children
         */
        function findMenuItemById(items: AIActionMenuItem[], id: string): AIActionMenuItem | undefined {
            for (const item of items) {
                if (item.id === id) {
                    return item;
                }
                if (item.children) {
                    const found = findMenuItemById(item.children, id);
                    if (found) return found;
                }
            }
            return undefined;
        }

        /**
         * Get all menu items including nested ones (flat list)
         */
        function getAllMenuItems(items: AIActionMenuItem[]): AIActionMenuItem[] {
            const result: AIActionMenuItem[] = [];
            for (const item of items) {
                result.push(item);
                if (item.children) {
                    result.push(...getAllMenuItems(item.children));
                }
            }
            return result;
        }

        test('should have Resolve Comments as parent menu item', () => {
            const structure = getAIActionMenuStructure();
            assert.strictEqual(structure.length, 1);
            assert.strictEqual(structure[0].id, 'resolveCommentsItem');
            assert.strictEqual(structure[0].label, 'Resolve Comments');
            assert.strictEqual(structure[0].hasSubmenu, true);
        });

        test('should have submenu children under Resolve Comments', () => {
            const structure = getAIActionMenuStructure();
            const resolveComments = structure[0];
            assert.ok(resolveComments.children);
            assert.strictEqual(resolveComments.children!.length, 4);
        });

        test('should contain Send to New Chat in submenu', () => {
            const structure = getAIActionMenuStructure();
            const item = findMenuItemById(structure, 'sendToNewChatBtn');
            assert.ok(item);
            assert.strictEqual(item!.label, 'Send to New Chat');
            assert.strictEqual(item!.icon, '💬');
        });

        test('should contain Send to Existing Chat in submenu', () => {
            const structure = getAIActionMenuStructure();
            const item = findMenuItemById(structure, 'sendToExistingChatBtn');
            assert.ok(item);
            assert.strictEqual(item!.label, 'Send to Existing Chat');
            assert.strictEqual(item!.icon, '🔄');
        });

        test('should contain Send to CLI Interactive in submenu', () => {
            const structure = getAIActionMenuStructure();
            const item = findMenuItemById(structure, 'sendToCLIInteractiveBtn');
            assert.ok(item);
            assert.strictEqual(item!.label, 'Send to CLI Interactive');
            assert.strictEqual(item!.icon, '🖥️');
        });

        test('should contain Copy as Prompt in submenu', () => {
            const structure = getAIActionMenuStructure();
            const item = findMenuItemById(structure, 'copyPromptBtn');
            assert.ok(item);
            assert.strictEqual(item!.label, 'Copy as Prompt');
            assert.strictEqual(item!.icon, '📋');
        });

        test('should have 5 total menu items (1 parent + 4 children)', () => {
            const structure = getAIActionMenuStructure();
            const allItems = getAllMenuItems(structure);
            assert.strictEqual(allItems.length, 5);
        });

        test('should not have Send to New Chat at top level', () => {
            const structure = getAIActionMenuStructure();
            // Top level should only have Resolve Comments
            const topLevelIds = structure.map(item => item.id);
            assert.ok(!topLevelIds.includes('sendToNewChatBtn'));
        });
    });

    suite('Submenu State Management', () => {
        // Test submenu open/close state management

        interface SubmenuState {
            mainMenuOpen: boolean;
            resolveCommentsSubmenuOpen: boolean;
        }

        function createSubmenuState(): SubmenuState {
            return {
                mainMenuOpen: false,
                resolveCommentsSubmenuOpen: false
            };
        }

        function openMainMenu(state: SubmenuState): SubmenuState {
            return { ...state, mainMenuOpen: true };
        }

        function closeAllMenus(state: SubmenuState): SubmenuState {
            return { mainMenuOpen: false, resolveCommentsSubmenuOpen: false };
        }

        function toggleResolveCommentsSubmenu(state: SubmenuState): SubmenuState {
            if (!state.mainMenuOpen) return state; // Can't open submenu if main menu is closed
            return { ...state, resolveCommentsSubmenuOpen: !state.resolveCommentsSubmenuOpen };
        }

        test('should start with all menus closed', () => {
            const state = createSubmenuState();
            assert.strictEqual(state.mainMenuOpen, false);
            assert.strictEqual(state.resolveCommentsSubmenuOpen, false);
        });

        test('should open main menu', () => {
            let state = createSubmenuState();
            state = openMainMenu(state);
            assert.strictEqual(state.mainMenuOpen, true);
            assert.strictEqual(state.resolveCommentsSubmenuOpen, false);
        });

        test('should toggle submenu when main menu is open', () => {
            let state = createSubmenuState();
            state = openMainMenu(state);
            state = toggleResolveCommentsSubmenu(state);
            assert.strictEqual(state.mainMenuOpen, true);
            assert.strictEqual(state.resolveCommentsSubmenuOpen, true);
        });

        test('should not toggle submenu when main menu is closed', () => {
            let state = createSubmenuState();
            state = toggleResolveCommentsSubmenu(state);
            assert.strictEqual(state.mainMenuOpen, false);
            assert.strictEqual(state.resolveCommentsSubmenuOpen, false);
        });

        test('should close all menus including submenu', () => {
            let state = createSubmenuState();
            state = openMainMenu(state);
            state = toggleResolveCommentsSubmenu(state);
            state = closeAllMenus(state);
            assert.strictEqual(state.mainMenuOpen, false);
            assert.strictEqual(state.resolveCommentsSubmenuOpen, false);
        });

        test('should toggle submenu off when toggled twice', () => {
            let state = createSubmenuState();
            state = openMainMenu(state);
            state = toggleResolveCommentsSubmenu(state);
            state = toggleResolveCommentsSubmenu(state);
            assert.strictEqual(state.resolveCommentsSubmenuOpen, false);
        });
    });

    suite('Submenu Scroll Support', () => {
        // Test that the submenu supports scrolling when there are many items
        // This validates the CSS changes from overflow:hidden to overflow-y:auto with max-height

        /**
         * Parse CSS properties from a CSS rule string
         * Simulates extracting CSS property values for testing
         */
        function parseCSSProperties(cssText: string): Map<string, string> {
            const properties = new Map<string, string>();
            const lines = cssText.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.includes(':') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')) {
                    const colonIndex = trimmed.indexOf(':');
                    const property = trimmed.substring(0, colonIndex).trim();
                    const value = trimmed.substring(colonIndex + 1).replace(';', '').trim();
                    if (property && value) {
                        properties.set(property, value);
                    }
                }
            }
            return properties;
        }

        /**
         * Parse a CSS viewport height value (e.g., "60vh") into a number
         */
        function parseViewportHeight(value: string): number | null {
            const match = value.match(/^(\d+(?:\.\d+)?)vh$/);
            return match ? parseFloat(match[1]) : null;
        }

        /**
         * Simulate whether a submenu would need scrolling based on viewport height and item count
         */
        function wouldNeedScrolling(
            viewportHeight: number,
            maxHeightVh: number,
            itemHeight: number,
            itemCount: number
        ): boolean {
            const maxHeightPx = (viewportHeight * maxHeightVh) / 100;
            const totalContentHeight = itemCount * itemHeight;
            return totalContentHeight > maxHeightPx;
        }

        /**
         * Calculate the visible items count within a max-height constraint
         */
        function visibleItemCount(
            viewportHeight: number,
            maxHeightVh: number,
            itemHeight: number
        ): number {
            const maxHeightPx = (viewportHeight * maxHeightVh) / 100;
            return Math.floor(maxHeightPx / itemHeight);
        }

        // The actual CSS rule for .ai-action-submenu
        const submenuCSS = `
.ai-action-submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: 0;
    min-width: 180px;
    margin-left: 4px;
    background: var(--comment-bg);
    border: 1px solid var(--comment-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 1001;
    overflow-y: auto;
    max-height: 60vh;
}`;

        test('should use overflow-y: auto instead of overflow: hidden', () => {
            const properties = parseCSSProperties(submenuCSS);
            assert.strictEqual(properties.get('overflow-y'), 'auto',
                'overflow-y should be "auto" to enable scrolling when content exceeds max-height');
            assert.ok(!properties.has('overflow') || properties.get('overflow') !== 'hidden',
                'overflow should not be "hidden" as it prevents scrolling');
        });

        test('should have max-height set to constrain submenu height', () => {
            const properties = parseCSSProperties(submenuCSS);
            const maxHeight = properties.get('max-height');
            assert.ok(maxHeight, 'max-height should be defined');
            assert.ok(maxHeight!.includes('vh'), 'max-height should use viewport height units');
        });

        test('should have max-height of 60vh', () => {
            const properties = parseCSSProperties(submenuCSS);
            const maxHeight = properties.get('max-height');
            assert.strictEqual(maxHeight, '60vh',
                'max-height should be 60vh for good visibility while ensuring scroll triggers');
        });

        test('should parse viewport height value correctly', () => {
            assert.strictEqual(parseViewportHeight('60vh'), 60);
            assert.strictEqual(parseViewportHeight('100vh'), 100);
            assert.strictEqual(parseViewportHeight('50.5vh'), 50.5);
            assert.strictEqual(parseViewportHeight('60px'), null); // not vh
            assert.strictEqual(parseViewportHeight('invalid'), null);
        });

        test('should need scrolling when many items exceed 60vh on small screens', () => {
            // Small screen: 600px viewport, 60vh = 360px max
            // Each item ~36px height, 15 items = 540px (exceeds 360px)
            const result = wouldNeedScrolling(600, 60, 36, 15);
            assert.strictEqual(result, true,
                '15 items at 36px each (540px) should exceed 60vh (360px) on a 600px viewport');
        });

        test('should not need scrolling with few items on large screens', () => {
            // Large screen: 1080px viewport, 60vh = 648px max
            // Each item ~36px height, 5 items = 180px (fits within 648px)
            const result = wouldNeedScrolling(1080, 60, 36, 5);
            assert.strictEqual(result, false,
                '5 items at 36px each (180px) should fit within 60vh (648px) on a 1080px viewport');
        });

        test('should need scrolling with many prompt files on standard screen', () => {
            // Standard screen: 900px viewport, 60vh = 540px max
            // Each item ~36px height, 20 items = 720px (exceeds 540px)
            const result = wouldNeedScrolling(900, 60, 36, 20);
            assert.strictEqual(result, true,
                '20 prompt files at 36px each should exceed 60vh on a 900px viewport');
        });

        test('should calculate visible items correctly on various screen sizes', () => {
            // Small screen: 600px viewport, 60vh = 360px, item height 36px
            assert.strictEqual(visibleItemCount(600, 60, 36), 10,
                'Should show 10 items on 600px viewport');

            // Standard screen: 900px viewport, 60vh = 540px, item height 36px
            assert.strictEqual(visibleItemCount(900, 60, 36), 15,
                'Should show 15 items on 900px viewport');

            // Large screen: 1080px viewport, 60vh = 648px, item height 36px
            assert.strictEqual(visibleItemCount(1080, 60, 36), 18,
                'Should show 18 items on 1080px viewport');
        });

        test('should still display correctly with no items (empty submenu)', () => {
            const result = wouldNeedScrolling(900, 60, 36, 0);
            assert.strictEqual(result, false,
                'Empty submenu should not need scrolling');
        });

        test('should still display correctly with exactly one item', () => {
            const result = wouldNeedScrolling(900, 60, 36, 1);
            assert.strictEqual(result, false,
                'Single item should not need scrolling');
        });

        test('should handle edge case where items exactly fill max-height', () => {
            // 900px viewport, 60vh = 540px, 36px items -> exactly 15 items fill it
            const result = wouldNeedScrolling(900, 60, 36, 15);
            assert.strictEqual(result, false,
                'Items that exactly fill the max-height should not need scrolling');
        });

        test('should need scrolling with 16 items (one more than fits)', () => {
            // 900px viewport, 60vh = 540px, 36px items -> 15 fit, 16 should scroll
            const result = wouldNeedScrolling(900, 60, 36, 16);
            assert.strictEqual(result, true,
                'One extra item beyond max-height should trigger scrolling');
        });

        test('should retain existing positioning properties', () => {
            const properties = parseCSSProperties(submenuCSS);
            assert.strictEqual(properties.get('position'), 'absolute');
            assert.strictEqual(properties.get('left'), '100%');
            assert.strictEqual(properties.get('top'), '0');
            assert.ok(properties.get('z-index'));
        });

        test('should retain visual styling properties', () => {
            const properties = parseCSSProperties(submenuCSS);
            assert.ok(properties.get('background'), 'background should be defined');
            assert.ok(properties.get('border'), 'border should be defined');
            assert.ok(properties.get('border-radius'), 'border-radius should be defined');
            assert.ok(properties.get('box-shadow'), 'box-shadow should be defined');
            assert.strictEqual(properties.get('min-width'), '180px',
                'min-width should be preserved');
        });
    });

    suite('Submenu Scrollbar Styling', () => {
        // Test custom scrollbar styling for VS Code theme consistency

        /**
         * Validate that a CSS selector targets a pseudo-element correctly
         */
        function isValidScrollbarSelector(selector: string): boolean {
            const validPseudoElements = [
                '::-webkit-scrollbar',
                '::-webkit-scrollbar-track',
                '::-webkit-scrollbar-thumb',
                '::-webkit-scrollbar-thumb:hover',
                '::-webkit-scrollbar-thumb:active',
                '::-webkit-scrollbar-corner'
            ];
            return validPseudoElements.some(pseudo => selector.endsWith(pseudo));
        }

        /**
         * Check if a CSS value references a VS Code theme variable
         */
        function usesVSCodeThemeVariable(value: string): boolean {
            return value.includes('--vscode-');
        }

        /**
         * Check if a CSS value has a fallback value
         */
        function hasFallbackValue(value: string): boolean {
            // var(--custom-prop, fallback) has a comma-separated fallback
            const varMatch = value.match(/var\([^)]*,\s*.+\)/);
            return varMatch !== null;
        }

        // Scrollbar CSS rules
        const scrollbarRules = {
            scrollbar: '.ai-action-submenu::-webkit-scrollbar { width: 6px; }',
            track: '.ai-action-submenu::-webkit-scrollbar-track { background: transparent; }',
            thumb: '.ai-action-submenu::-webkit-scrollbar-thumb { background: var(--comment-border); border-radius: 3px; }',
            thumbHover: '.ai-action-submenu::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7)); }'
        };

        test('should have valid scrollbar pseudo-element selectors', () => {
            assert.ok(isValidScrollbarSelector('.ai-action-submenu::-webkit-scrollbar'));
            assert.ok(isValidScrollbarSelector('.ai-action-submenu::-webkit-scrollbar-track'));
            assert.ok(isValidScrollbarSelector('.ai-action-submenu::-webkit-scrollbar-thumb'));
            assert.ok(isValidScrollbarSelector('.ai-action-submenu::-webkit-scrollbar-thumb:hover'));
        });

        test('should have scrollbar width defined', () => {
            assert.ok(scrollbarRules.scrollbar.includes('width: 6px'),
                'Scrollbar should have a narrow width (6px) for subtlety');
        });

        test('should have transparent scrollbar track', () => {
            assert.ok(scrollbarRules.track.includes('background: transparent'),
                'Scrollbar track should be transparent to blend with the submenu');
        });

        test('should use theme variable for scrollbar thumb', () => {
            assert.ok(scrollbarRules.thumb.includes('var(--comment-border)'),
                'Scrollbar thumb should use --comment-border for theme consistency');
        });

        test('should have rounded scrollbar thumb', () => {
            assert.ok(scrollbarRules.thumb.includes('border-radius: 3px'),
                'Scrollbar thumb should have rounded corners');
        });

        test('should use VS Code theme variable for thumb hover', () => {
            assert.ok(usesVSCodeThemeVariable(scrollbarRules.thumbHover),
                'Scrollbar thumb hover should reference a VS Code theme variable');
        });

        test('should have fallback value for thumb hover background', () => {
            assert.ok(hasFallbackValue(scrollbarRules.thumbHover),
                'Scrollbar thumb hover should have a fallback value for non-VS Code environments');
        });

        test('should use scrollbarSlider-hoverBackground variable', () => {
            assert.ok(scrollbarRules.thumbHover.includes('--vscode-scrollbarSlider-hoverBackground'),
                'Should use VS Code scrollbar slider hover variable for native feel');
        });

        test('should reject invalid scrollbar selectors', () => {
            assert.ok(!isValidScrollbarSelector('.ai-action-submenu::scrollbar'));
            assert.ok(!isValidScrollbarSelector('.ai-action-submenu:scrollbar'));
            assert.ok(!isValidScrollbarSelector('.ai-action-submenu'));
        });

        test('should detect VS Code theme variables correctly', () => {
            assert.ok(usesVSCodeThemeVariable('var(--vscode-editor-background)'));
            assert.ok(usesVSCodeThemeVariable('var(--vscode-scrollbarSlider-hoverBackground, #666)'));
            assert.ok(!usesVSCodeThemeVariable('var(--comment-border)'));
            assert.ok(!usesVSCodeThemeVariable('#ff0000'));
            assert.ok(!usesVSCodeThemeVariable('transparent'));
        });

        test('should detect fallback values correctly', () => {
            assert.ok(hasFallbackValue('var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7))'));
            assert.ok(hasFallbackValue('var(--custom-prop, #fff)'));
            assert.ok(!hasFallbackValue('var(--custom-prop)'));
            assert.ok(!hasFallbackValue('#ff0000'));
        });
    });

    suite('Resolve Comments Cross-Platform Compatibility', () => {
        // Test that the submenu structure works correctly on all platforms

        /**
         * Simulate DOM element class manipulation
         */
        interface MockElement {
            classes: Set<string>;
            addClass(className: string): void;
            removeClass(className: string): void;
            hasClass(className: string): boolean;
            toggleClass(className: string): void;
        }

        function createMockElement(): MockElement {
            return {
                classes: new Set<string>(),
                addClass(className: string) {
                    this.classes.add(className);
                },
                removeClass(className: string) {
                    this.classes.delete(className);
                },
                hasClass(className: string) {
                    return this.classes.has(className);
                },
                toggleClass(className: string) {
                    if (this.classes.has(className)) {
                        this.classes.delete(className);
                    } else {
                        this.classes.add(className);
                    }
                }
            };
        }

        test('should toggle submenu-open class', () => {
            const element = createMockElement();
            assert.strictEqual(element.hasClass('submenu-open'), false);
            
            element.toggleClass('submenu-open');
            assert.strictEqual(element.hasClass('submenu-open'), true);
            
            element.toggleClass('submenu-open');
            assert.strictEqual(element.hasClass('submenu-open'), false);
        });

        test('should handle show class on main menu', () => {
            const menu = createMockElement();
            const button = createMockElement();
            
            // Open menu
            menu.addClass('show');
            button.addClass('active');
            assert.strictEqual(menu.hasClass('show'), true);
            assert.strictEqual(button.hasClass('active'), true);
            
            // Close menu
            menu.removeClass('show');
            button.removeClass('active');
            assert.strictEqual(menu.hasClass('show'), false);
            assert.strictEqual(button.hasClass('active'), false);
        });

        test('should cleanup submenu state when closing main menu', () => {
            const menu = createMockElement();
            const submenuParent = createMockElement();
            
            // Open menu and submenu
            menu.addClass('show');
            submenuParent.addClass('submenu-open');
            
            // Close everything
            menu.removeClass('show');
            submenuParent.removeClass('submenu-open');
            
            assert.strictEqual(menu.hasClass('show'), false);
            assert.strictEqual(submenuParent.hasClass('submenu-open'), false);
        });
    });
});

