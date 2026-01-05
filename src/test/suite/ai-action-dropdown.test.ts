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
});

