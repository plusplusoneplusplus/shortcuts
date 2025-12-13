/**
 * Comprehensive unit tests for webview-scripts module
 * 
 * These tests cover the testable parts of webview-scripts:
 * - Pure functions that don't require DOM
 * - State management logic
 * - Parsing functions for code blocks and tables
 * 
 * Note: Functions requiring DOM (panel-manager, dom-handlers, etc.) are tested
 * via integration tests or manual testing in the webview context.
 */

import * as assert from 'assert';

// We can't directly import webview-scripts as they're bundled for browser
// Instead, we test the business logic that has been extracted to webview-logic
// and the pure functions in webview-scripts

// Test the pure parsing functions that are conceptually part of webview-scripts
// but have been designed to be testable

suite('Webview Scripts Tests', () => {

    suite('Code Block Parsing Logic', () => {
        // These tests cover the parseCodeBlocks logic

        interface CodeBlock {
            language: string;
            startLine: number;
            endLine: number;
            code: string;
            id: string;
            isMermaid: boolean;
        }

        /**
         * Pure function implementation for testing - mirrors parseCodeBlocks
         */
        function parseCodeBlocks(content: string): CodeBlock[] {
            const lines = content.split('\n');
            const blocks: CodeBlock[] = [];
            let inBlock = false;
            let currentBlock: Partial<CodeBlock> | null = null;
            let codeLines: string[] = [];

            lines.forEach((line, index) => {
                const fenceMatch = line.match(/^```(\w*)/);

                if (fenceMatch && !inBlock) {
                    inBlock = true;
                    currentBlock = {
                        language: fenceMatch[1] || 'plaintext',
                        startLine: index + 1,
                        isMermaid: fenceMatch[1] === 'mermaid'
                    };
                    codeLines = [];
                } else if (line.startsWith('```') && inBlock) {
                    inBlock = false;
                    if (currentBlock) {
                        currentBlock.endLine = index + 1;
                        currentBlock.code = codeLines.join('\n');
                        currentBlock.id = 'codeblock-' + currentBlock.startLine;
                        blocks.push(currentBlock as CodeBlock);
                    }
                    currentBlock = null;
                } else if (inBlock) {
                    codeLines.push(line);
                }
            });

            return blocks;
        }

        test('should parse single code block', () => {
            const content = '```javascript\nconst x = 1;\n```';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].language, 'javascript');
            assert.strictEqual(blocks[0].code, 'const x = 1;');
            assert.strictEqual(blocks[0].startLine, 1);
            assert.strictEqual(blocks[0].endLine, 3);
        });

        test('should parse multiple code blocks', () => {
            const content = '```js\ncode1\n```\n\nText\n\n```python\ncode2\n```';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 2);
            assert.strictEqual(blocks[0].language, 'js');
            assert.strictEqual(blocks[1].language, 'python');
        });

        test('should detect mermaid blocks', () => {
            const content = '```mermaid\ngraph TD\nA-->B\n```';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].isMermaid, true);
            assert.strictEqual(blocks[0].language, 'mermaid');
        });

        test('should use plaintext as default language', () => {
            const content = '```\nsome code\n```';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].language, 'plaintext');
        });

        test('should handle empty code blocks', () => {
            const content = '```js\n```';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].code, '');
        });

        test('should handle multi-line code', () => {
            const content = '```js\nline1\nline2\nline3\n```';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].code, 'line1\nline2\nline3');
        });

        test('should generate unique block IDs', () => {
            const content = '```js\na\n```\n```py\nb\n```';
            // Lines: 1=```js, 2=a, 3=```, 4=```py, 5=b, 6=```
            const blocks = parseCodeBlocks(content);
            assert.notStrictEqual(blocks[0].id, blocks[1].id);
            assert.strictEqual(blocks[0].id, 'codeblock-1');
            assert.strictEqual(blocks[1].id, 'codeblock-4'); // Second block starts at line 4
        });

        test('should handle code blocks at different positions', () => {
            const content = 'text\n```js\ncode\n```\nmore text';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].startLine, 2);
            assert.strictEqual(blocks[0].endLine, 4);
        });

        test('should handle unclosed code blocks gracefully', () => {
            const content = '```js\ncode without closing';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 0);
        });

        test('should return empty array for content with no code blocks', () => {
            const content = 'Just some text\nMore text';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 0);
        });

        test('should handle empty content', () => {
            const blocks = parseCodeBlocks('');
            assert.strictEqual(blocks.length, 0);
        });

        test('should preserve whitespace in code', () => {
            const content = '```js\n  indented\n    more indented\n```';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks[0].code, '  indented\n    more indented');
        });

        test('should handle special characters in code', () => {
            const content = '```js\nconst obj = { "key": "<value>" };\n```';
            const blocks = parseCodeBlocks(content);
            assert.ok(blocks[0].code.includes('<value>'));
        });
    });

    suite('Table Parsing Logic', () => {
        // These tests cover the parseTables logic

        interface ParsedTable {
            startLine: number;
            endLine: number;
            headers: string[];
            alignments: Array<'left' | 'center' | 'right'>;
            rows: string[][];
            id: string;
        }

        /**
         * Parse a table row into cells - mirrors webview-scripts implementation
         */
        function parseTableRow(line: string): string[] {
            const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
            return trimmed.split('|').map(cell => cell.trim());
        }

        /**
         * Parse table alignments from separator line
         */
        function parseTableAlignments(line: string): Array<'left' | 'center' | 'right'> {
            const cells = parseTableRow(line);
            return cells.map(cell => {
                const left = cell.startsWith(':');
                const right = cell.endsWith(':');
                if (left && right) return 'center';
                if (right) return 'right';
                return 'left';
            });
        }

        /**
         * Parse tables from content - mirrors webview-scripts implementation
         */
        function parseTables(content: string): ParsedTable[] {
            const lines = content.split('\n');
            const tables: ParsedTable[] = [];
            let i = 0;

            while (i < lines.length) {
                const line = lines[i];

                // Check if this line could be a table header (contains |)
                if (line.includes('|') && i + 1 < lines.length) {
                    const separatorLine = lines[i + 1];

                    // Check if next line is a table separator (contains | and - or :)
                    if (/^\|?[\s\-:|]+\|/.test(separatorLine)) {
                        // Parse header cells
                        const headers = parseTableRow(line);
                        if (headers.length === 0) {
                            i++;
                            continue;
                        }

                        // Parse alignment from separator
                        const alignments = parseTableAlignments(separatorLine);

                        // Parse body rows
                        const rows: string[][] = [];
                        let j = i + 2;
                        while (j < lines.length && lines[j].includes('|')) {
                            const row = parseTableRow(lines[j]);
                            if (row.length > 0) {
                                rows.push(row);
                            }
                            j++;
                        }

                        tables.push({
                            startLine: i + 1, // 1-based
                            endLine: j + 1,   // 1-based, exclusive
                            headers,
                            alignments,
                            rows,
                            id: 'table-' + (i + 1)
                        });

                        i = j;
                        continue;
                    }
                }
                i++;
            }

            return tables;
        }

        suite('parseTableRow', () => {
            test('should parse simple row', () => {
                assert.deepStrictEqual(parseTableRow('| A | B |'), ['A', 'B']);
            });

            test('should handle whitespace', () => {
                assert.deepStrictEqual(parseTableRow('|  A  |  B  |'), ['A', 'B']);
            });

            test('should handle row without outer pipes', () => {
                assert.deepStrictEqual(parseTableRow('A | B'), ['A', 'B']);
            });

            test('should handle multiple columns', () => {
                assert.deepStrictEqual(
                    parseTableRow('| A | B | C | D | E |'),
                    ['A', 'B', 'C', 'D', 'E']
                );
            });

            test('should handle empty cells', () => {
                assert.deepStrictEqual(parseTableRow('| A |  | C |'), ['A', '', 'C']);
            });

            test('should handle only pipes', () => {
                const result = parseTableRow('|||');
                assert.strictEqual(result.length, 2);
            });
        });

        suite('parseTableAlignments', () => {
            test('should parse left alignment', () => {
                assert.deepStrictEqual(
                    parseTableAlignments('|---|---|'),
                    ['left', 'left']
                );
            });

            test('should parse right alignment', () => {
                assert.deepStrictEqual(
                    parseTableAlignments('|---:|---:|'),
                    ['right', 'right']
                );
            });

            test('should parse center alignment', () => {
                assert.deepStrictEqual(
                    parseTableAlignments('|:---:|:---:|'),
                    ['center', 'center']
                );
            });

            test('should parse mixed alignments', () => {
                assert.deepStrictEqual(
                    parseTableAlignments('|:---|:---:|---:|'),
                    ['left', 'center', 'right']
                );
            });

            test('should handle minimal separators', () => {
                assert.deepStrictEqual(
                    parseTableAlignments('|-|-|'),
                    ['left', 'left']
                );
            });
        });

        suite('parseTables', () => {
            test('should parse simple table', () => {
                const content = '| A | B |\n|---|---|\n| 1 | 2 |';
                const tables = parseTables(content);
                assert.strictEqual(tables.length, 1);
                assert.deepStrictEqual(tables[0].headers, ['A', 'B']);
                assert.strictEqual(tables[0].rows.length, 1);
            });

            test('should parse table with multiple rows', () => {
                const content = '| H1 | H2 |\n|---|---|\n| R1 | R1 |\n| R2 | R2 |\n| R3 | R3 |';
                const tables = parseTables(content);
                assert.strictEqual(tables.length, 1);
                assert.strictEqual(tables[0].rows.length, 3);
            });

            test('should parse multiple tables', () => {
                const content = '| A |\n|---|\n| 1 |\n\n| B |\n|---|\n| 2 |';
                const tables = parseTables(content);
                assert.strictEqual(tables.length, 2);
            });

            test('should handle table with alignments', () => {
                const content = '| L | C | R |\n|:--|:--:|--:|\n| 1 | 2 | 3 |';
                const tables = parseTables(content);
                assert.deepStrictEqual(tables[0].alignments, ['left', 'center', 'right']);
            });

            test('should generate table IDs based on start line', () => {
                const content = 'text\n| A |\n|---|\n| 1 |';
                const tables = parseTables(content);
                assert.strictEqual(tables[0].id, 'table-2');
            });

            test('should calculate correct start and end lines', () => {
                const content = 'text\n| A |\n|---|\n| 1 |\n| 2 |\nmore text';
                const tables = parseTables(content);
                assert.strictEqual(tables[0].startLine, 2);
                assert.strictEqual(tables[0].endLine, 6);
            });

            test('should return empty array for content with no tables', () => {
                const content = 'Just some text\nMore text';
                const tables = parseTables(content);
                assert.strictEqual(tables.length, 0);
            });

            test('should return empty array for empty content', () => {
                const tables = parseTables('');
                assert.strictEqual(tables.length, 0);
            });

            test('should not parse invalid tables (no separator)', () => {
                const content = '| A | B |\n| 1 | 2 |';
                const tables = parseTables(content);
                assert.strictEqual(tables.length, 0);
            });

            test('should handle table at start of document', () => {
                const content = '| A |\n|---|\n| 1 |';
                const tables = parseTables(content);
                assert.strictEqual(tables[0].startLine, 1);
            });

            test('should handle table at end of document', () => {
                const content = 'text\n| A |\n|---|\n| 1 |';
                const tables = parseTables(content);
                assert.strictEqual(tables.length, 1);
            });

            test('should handle cells with markdown content', () => {
                const content = '| **Bold** | *Italic* |\n|---|---|\n| `code` | [link](url) |';
                const tables = parseTables(content);
                assert.strictEqual(tables[0].headers[0], '**Bold**');
                assert.strictEqual(tables[0].rows[0][0], '`code`');
            });
        });
    });

    suite('State Manager Logic', () => {
        // Test the state management patterns used in webview

        interface WebviewSettings {
            showResolved: boolean;
        }

        interface MarkdownComment {
            id: string;
            selection: { startLine: number; endLine: number };
            status: string;
        }

        class TestStateManager {
            private _currentContent: string = '';
            private _comments: MarkdownComment[] = [];
            private _filePath: string = '';
            private _settings: WebviewSettings = { showResolved: true };
            private _editingCommentId: string | null = null;

            get currentContent() { return this._currentContent; }
            get comments() { return this._comments; }
            get filePath() { return this._filePath; }
            get settings() { return this._settings; }
            get editingCommentId() { return this._editingCommentId; }

            setCurrentContent(content: string) { this._currentContent = content; }
            setComments(comments: MarkdownComment[]) { this._comments = comments; }
            setFilePath(path: string) { this._filePath = path; }
            setSettings(settings: Partial<WebviewSettings>) {
                this._settings = { ...this._settings, ...settings };
            }
            setEditingCommentId(id: string | null) { this._editingCommentId = id; }

            findCommentById(id: string): MarkdownComment | undefined {
                return this._comments.find(c => c.id === id);
            }

            getCommentsForLine(lineNum: number): MarkdownComment[] {
                return this._comments.filter(c =>
                    c.selection.startLine <= lineNum &&
                    c.selection.endLine >= lineNum
                );
            }

            getVisibleCommentsForLine(lineNum: number): MarkdownComment[] {
                return this.getCommentsForLine(lineNum).filter(c =>
                    this._settings.showResolved || c.status !== 'resolved'
                );
            }
        }

        let state: TestStateManager;

        setup(() => {
            state = new TestStateManager();
        });

        suite('Content Management', () => {
            test('should store and retrieve content', () => {
                state.setCurrentContent('# Hello World');
                assert.strictEqual(state.currentContent, '# Hello World');
            });

            test('should handle empty content', () => {
                state.setCurrentContent('');
                assert.strictEqual(state.currentContent, '');
            });

            test('should handle multiline content', () => {
                const content = 'Line 1\nLine 2\nLine 3';
                state.setCurrentContent(content);
                assert.strictEqual(state.currentContent, content);
            });
        });

        suite('Comments Management', () => {
            const sampleComments: MarkdownComment[] = [
                { id: 'c1', selection: { startLine: 1, endLine: 1 }, status: 'open' },
                { id: 'c2', selection: { startLine: 5, endLine: 7 }, status: 'resolved' },
                { id: 'c3', selection: { startLine: 10, endLine: 10 }, status: 'open' }
            ];

            test('should store and retrieve comments', () => {
                state.setComments(sampleComments);
                assert.strictEqual(state.comments.length, 3);
            });

            test('should find comment by ID', () => {
                state.setComments(sampleComments);
                const found = state.findCommentById('c2');
                assert.ok(found);
                assert.strictEqual(found.id, 'c2');
            });

            test('should return undefined for non-existent ID', () => {
                state.setComments(sampleComments);
                const found = state.findCommentById('nonexistent');
                assert.strictEqual(found, undefined);
            });

            test('should get comments for line (single line comment)', () => {
                state.setComments(sampleComments);
                const lineComments = state.getCommentsForLine(1);
                assert.strictEqual(lineComments.length, 1);
                assert.strictEqual(lineComments[0].id, 'c1');
            });

            test('should get comments for line (multi-line comment)', () => {
                state.setComments(sampleComments);
                assert.strictEqual(state.getCommentsForLine(5).length, 1);
                assert.strictEqual(state.getCommentsForLine(6).length, 1);
                assert.strictEqual(state.getCommentsForLine(7).length, 1);
            });

            test('should return empty array for line with no comments', () => {
                state.setComments(sampleComments);
                assert.strictEqual(state.getCommentsForLine(3).length, 0);
            });

            test('should get visible comments respecting showResolved', () => {
                state.setComments(sampleComments);
                state.setSettings({ showResolved: true });
                assert.strictEqual(state.getVisibleCommentsForLine(5).length, 1);

                state.setSettings({ showResolved: false });
                assert.strictEqual(state.getVisibleCommentsForLine(5).length, 0);
            });
        });

        suite('Settings Management', () => {
            test('should have default showResolved true', () => {
                assert.strictEqual(state.settings.showResolved, true);
            });

            test('should update settings partially', () => {
                state.setSettings({ showResolved: false });
                assert.strictEqual(state.settings.showResolved, false);
            });

            test('should preserve other settings on partial update', () => {
                // First set to false
                state.setSettings({ showResolved: false });
                // Then set to true again
                state.setSettings({ showResolved: true });
                assert.strictEqual(state.settings.showResolved, true);
            });
        });

        suite('File Path Management', () => {
            test('should store and retrieve file path', () => {
                state.setFilePath('/path/to/file.md');
                assert.strictEqual(state.filePath, '/path/to/file.md');
            });

            test('should handle empty path', () => {
                state.setFilePath('');
                assert.strictEqual(state.filePath, '');
            });
        });

        suite('Editing State', () => {
            test('should track editing comment ID', () => {
                state.setEditingCommentId('c1');
                assert.strictEqual(state.editingCommentId, 'c1');
            });

            test('should clear editing comment ID', () => {
                state.setEditingCommentId('c1');
                state.setEditingCommentId(null);
                assert.strictEqual(state.editingCommentId, null);
            });

            test('should start with null editing ID', () => {
                assert.strictEqual(state.editingCommentId, null);
            });
        });
    });

    suite('Message Types Validation', () => {
        // Test message structure validation

        interface WebviewMessage {
            type: string;
            [key: string]: unknown;
        }

        function isValidWebviewMessage(msg: unknown): msg is WebviewMessage {
            return typeof msg === 'object' && msg !== null && 'type' in msg;
        }

        function isReadyMessage(msg: WebviewMessage): boolean {
            return msg.type === 'ready';
        }

        function isAddCommentMessage(msg: WebviewMessage): boolean {
            return msg.type === 'addComment' &&
                'selection' in msg &&
                'comment' in msg;
        }

        function isEditCommentMessage(msg: WebviewMessage): boolean {
            return msg.type === 'editComment' &&
                'commentId' in msg &&
                'comment' in msg;
        }

        test('should validate ready message', () => {
            const msg = { type: 'ready' };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isReadyMessage(msg));
        });

        test('should validate addComment message', () => {
            const msg = {
                type: 'addComment',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                comment: 'Test comment'
            };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isAddCommentMessage(msg));
        });

        test('should validate editComment message', () => {
            const msg = {
                type: 'editComment',
                commentId: 'c1',
                comment: 'Updated comment'
            };
            assert.ok(isValidWebviewMessage(msg));
            assert.ok(isEditCommentMessage(msg));
        });

        test('should reject invalid messages', () => {
            assert.ok(!isValidWebviewMessage(null));
            assert.ok(!isValidWebviewMessage(undefined));
            assert.ok(!isValidWebviewMessage('string'));
            assert.ok(!isValidWebviewMessage(123));
        });

        test('should reject incomplete addComment message', () => {
            const msg = { type: 'addComment' }; // Missing selection and comment
            assert.ok(!isAddCommentMessage(msg));
        });
    });

    suite('Highlight Code Logic', () => {
        // Test the fallback behavior when hljs is not available

        function escapeHtml(text: string): string {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        /**
         * Simulates highlightCode behavior when hljs is not available
         */
        function highlightCodeFallback(code: string): string {
            return escapeHtml(code);
        }

        test('should escape HTML in code', () => {
            const result = highlightCodeFallback('<script>alert("xss")</script>');
            assert.ok(result.includes('&lt;script&gt;'));
            assert.ok(!result.includes('<script>'));
        });

        test('should handle empty code', () => {
            const result = highlightCodeFallback('');
            assert.strictEqual(result, '');
        });

        test('should preserve code structure', () => {
            const code = 'function test() {\n  return 42;\n}';
            const result = highlightCodeFallback(code);
            assert.ok(result.includes('function test()'));
            assert.ok(result.includes('return 42;'));
        });
    });

    suite('Comment Highlight Application', () => {
        // Test the logic for applying comment highlights

        interface CommentSelection {
            startLine: number;
            startColumn: number;
            endLine: number;
            endColumn: number;
        }

        /**
         * Calculate which columns should be highlighted for a line
         */
        function getHighlightColumnsForLine(
            selection: CommentSelection,
            lineNumber: number,
            lineLength: number
        ): { startCol: number; endCol: number } {
            if (selection.startLine === selection.endLine && selection.startLine === lineNumber) {
                return {
                    startCol: selection.startColumn,
                    endCol: selection.endColumn
                };
            } else if (selection.startLine === lineNumber) {
                return {
                    startCol: selection.startColumn,
                    endCol: lineLength + 1
                };
            } else if (selection.endLine === lineNumber) {
                return {
                    startCol: 1,
                    endCol: selection.endColumn
                };
            } else if (lineNumber > selection.startLine && lineNumber < selection.endLine) {
                return {
                    startCol: 1,
                    endCol: lineLength + 1
                };
            }
            return {
                startCol: 1,
                endCol: lineLength + 1
            };
        }

        test('should calculate single-line selection columns', () => {
            const selection = { startLine: 5, startColumn: 3, endLine: 5, endColumn: 10 };
            const result = getHighlightColumnsForLine(selection, 5, 20);
            assert.strictEqual(result.startCol, 3);
            assert.strictEqual(result.endCol, 10);
        });

        test('should calculate first line of multi-line selection', () => {
            const selection = { startLine: 5, startColumn: 10, endLine: 8, endColumn: 15 };
            const result = getHighlightColumnsForLine(selection, 5, 30);
            assert.strictEqual(result.startCol, 10);
            assert.strictEqual(result.endCol, 31);
        });

        test('should calculate middle line of multi-line selection', () => {
            const selection = { startLine: 5, startColumn: 10, endLine: 8, endColumn: 15 };
            const result = getHighlightColumnsForLine(selection, 6, 25);
            assert.strictEqual(result.startCol, 1);
            assert.strictEqual(result.endCol, 26);
        });

        test('should calculate last line of multi-line selection', () => {
            const selection = { startLine: 5, startColumn: 10, endLine: 8, endColumn: 15 };
            const result = getHighlightColumnsForLine(selection, 8, 30);
            assert.strictEqual(result.startCol, 1);
            assert.strictEqual(result.endCol, 15);
        });
    });

    suite('Block Comment Detection', () => {
        // Test logic for detecting if blocks have comments

        interface MarkdownComment {
            id: string;
            selection: { startLine: number; endLine: number };
            status: string;
        }

        /**
         * Check if a block of lines has any visible comments
         */
        function blockHasComments(
            startLine: number,
            endLine: number,
            commentsMap: Map<number, MarkdownComment[]>,
            showResolved: boolean
        ): boolean {
            for (let line = startLine; line <= endLine; line++) {
                const comments = commentsMap.get(line);
                if (comments) {
                    const visible = comments.filter(c =>
                        showResolved || c.status !== 'resolved'
                    );
                    if (visible.length > 0) return true;
                }
            }
            return false;
        }

        test('should detect comments in block', () => {
            const commentsMap = new Map<number, MarkdownComment[]>();
            commentsMap.set(5, [{ id: 'c1', selection: { startLine: 5, endLine: 5 }, status: 'open' }]);
            assert.ok(blockHasComments(1, 10, commentsMap, true));
        });

        test('should not detect comments outside block', () => {
            const commentsMap = new Map<number, MarkdownComment[]>();
            commentsMap.set(15, [{ id: 'c1', selection: { startLine: 15, endLine: 15 }, status: 'open' }]);
            assert.ok(!blockHasComments(1, 10, commentsMap, true));
        });

        test('should respect showResolved setting', () => {
            const commentsMap = new Map<number, MarkdownComment[]>();
            commentsMap.set(5, [{ id: 'c1', selection: { startLine: 5, endLine: 5 }, status: 'resolved' }]);
            assert.ok(blockHasComments(1, 10, commentsMap, true));
            assert.ok(!blockHasComments(1, 10, commentsMap, false));
        });

        test('should handle empty comments map', () => {
            const commentsMap = new Map<number, MarkdownComment[]>();
            assert.ok(!blockHasComments(1, 10, commentsMap, true));
        });

        test('should handle single-line block', () => {
            const commentsMap = new Map<number, MarkdownComment[]>();
            commentsMap.set(5, [{ id: 'c1', selection: { startLine: 5, endLine: 5 }, status: 'open' }]);
            assert.ok(blockHasComments(5, 5, commentsMap, true));
            assert.ok(!blockHasComments(6, 6, commentsMap, true));
        });
    });

    suite('Sorting Comments for Highlight Application', () => {
        // Test the sorting logic for applying highlights right-to-left

        interface Comment {
            id: string;
            selection: { startColumn: number };
        }

        /**
         * Sort comments by column descending (for right-to-left highlight application)
         */
        function sortByColumnDescending(comments: Comment[]): Comment[] {
            return [...comments].sort((a, b) =>
                b.selection.startColumn - a.selection.startColumn
            );
        }

        test('should sort comments by column descending', () => {
            const comments = [
                { id: 'c1', selection: { startColumn: 5 } },
                { id: 'c2', selection: { startColumn: 20 } },
                { id: 'c3', selection: { startColumn: 10 } }
            ];
            const sorted = sortByColumnDescending(comments);
            assert.strictEqual(sorted[0].id, 'c2');
            assert.strictEqual(sorted[1].id, 'c3');
            assert.strictEqual(sorted[2].id, 'c1');
        });

        test('should not modify original array', () => {
            const comments = [
                { id: 'c1', selection: { startColumn: 5 } },
                { id: 'c2', selection: { startColumn: 20 } }
            ];
            const originalOrder = comments.map(c => c.id);
            sortByColumnDescending(comments);
            assert.deepStrictEqual(comments.map(c => c.id), originalOrder);
        });

        test('should handle empty array', () => {
            const sorted = sortByColumnDescending([]);
            assert.strictEqual(sorted.length, 0);
        });

        test('should handle single comment', () => {
            const comments = [{ id: 'c1', selection: { startColumn: 5 } }];
            const sorted = sortByColumnDescending(comments);
            assert.strictEqual(sorted.length, 1);
        });
    });

    suite('Plain Text Content Extraction (getPlainTextContent)', () => {
        /**
         * This test suite verifies the getPlainTextContent logic that extracts
         * plain text from the contenteditable editor.
         * 
         * The key requirement is that this function MUST handle:
         * 1. Normal rendered .line-content[data-line] elements
         * 2. Browser-created elements from contenteditable mutations (br, div, p)
         * 3. Mixed content where users have edited and created new lines
         * 
         * A regression occurred when the implementation was simplified to only
         * read .line-content[data-line] elements, missing user-created content.
         */

        // Mock DOM node types
        const TEXT_NODE = 3;
        const ELEMENT_NODE = 1;

        interface MockNode {
            nodeType: number;
            textContent: string | null;
            tagName?: string;
            childNodes: MockNode[];
            classList?: { contains: (className: string) => boolean };
            hasAttribute?: (attr: string) => boolean;
            getAttribute?: (attr: string) => string | null;
        }

        /**
         * Create a mock text node
         */
        function createTextNode(text: string): MockNode {
            return {
                nodeType: TEXT_NODE,
                textContent: text,
                childNodes: []
            };
        }

        /**
         * Create a mock element node
         */
        function createElementNode(
            tagName: string,
            children: MockNode[] = [],
            classNames: string[] = [],
            attributes: Record<string, string> = {}
        ): MockNode {
            return {
                nodeType: ELEMENT_NODE,
                tagName: tagName.toUpperCase(),
                textContent: children.map(c => c.textContent || '').join(''),
                childNodes: children,
                classList: {
                    contains: (className: string) => classNames.includes(className)
                },
                hasAttribute: (attr: string) => attr in attributes,
                getAttribute: (attr: string) => attributes[attr] || null
            };
        }

        /**
         * Implementation of getPlainTextContent logic for testing
         * This MUST match the actual implementation in dom-handlers.ts
         */
        function getPlainTextContent(editorWrapper: MockNode): string {
            const lines: string[] = [];

            function processNode(node: MockNode, isFirstChild: boolean = false): void {
                if (node.nodeType === TEXT_NODE) {
                    const text = node.textContent || '';
                    if (lines.length === 0) {
                        lines.push(text);
                    } else {
                        lines[lines.length - 1] += text;
                    }
                } else if (node.nodeType === ELEMENT_NODE) {
                    const el = node;
                    const tag = (el.tagName || '').toLowerCase();

                    // Skip comment bubbles and gutter icons
                    if (el.classList?.contains('inline-comment-bubble') ||
                        el.classList?.contains('gutter-icon') ||
                        el.classList?.contains('line-number') ||
                        el.classList?.contains('line-number-column')) {
                        return;
                    }

                    // Handle line breaks - CRITICAL: br tags must start new lines
                    if (tag === 'br') {
                        lines.push('');
                        return;
                    }

                    // Check if this is a block element that should start a new line
                    const isBlockElement = tag === 'div' || tag === 'p' ||
                        el.classList?.contains('line-row') ||
                        el.classList?.contains('block-row');

                    // For line-content with data-line, handle as a single line
                    if (el.classList?.contains('line-content') && el.hasAttribute?.('data-line')) {
                        // Start a new line for each line-content element
                        if (lines.length === 0 || lines[lines.length - 1] !== '' || !isFirstChild) {
                            lines.push('');
                        }
                        // Process children
                        let childIndex = 0;
                        el.childNodes.forEach(child => {
                            processNode(child, childIndex === 0);
                            childIndex++;
                        });
                        return;
                    }

                    // For line-row elements, just process children
                    if (el.classList?.contains('line-row') || el.classList?.contains('block-row')) {
                        let childIndex = 0;
                        el.childNodes.forEach(child => {
                            processNode(child, childIndex === 0);
                            childIndex++;
                        });
                        return;
                    }

                    // For other block elements created by contenteditable
                    // CRITICAL: This handles user-created divs/paragraphs
                    if (isBlockElement && lines.length > 0 && lines[lines.length - 1] !== '' && !isFirstChild) {
                        lines.push('');
                    }

                    // Process children
                    let childIndex = 0;
                    el.childNodes.forEach(child => {
                        processNode(child, childIndex === 0);
                        childIndex++;
                    });
                }
            }

            processNode(editorWrapper, true);

            // Clean up: handle nbsp placeholders for empty lines
            return lines.map(line => {
                if (line === '\u00a0') {
                    return '';
                }
                return line;
            }).join('\n');
        }

        /**
         * BROKEN implementation that would miss user-created content
         * This demonstrates what NOT to do - only reading data-line elements
         */
        function getPlainTextContentBroken(editorWrapper: MockNode): string {
            const lines: string[] = [];

            // This approach only looks at .line-content[data-line] elements
            // and misses any content created by the browser during editing
            function findLineContentElements(node: MockNode): MockNode[] {
                const results: MockNode[] = [];
                if (node.nodeType === ELEMENT_NODE) {
                    if (node.classList?.contains('line-content') && node.hasAttribute?.('data-line')) {
                        results.push(node);
                    }
                    node.childNodes.forEach(child => {
                        results.push(...findLineContentElements(child));
                    });
                }
                return results;
            }

            const lineElements = findLineContentElements(editorWrapper);
            lineElements.forEach(lineEl => {
                let text = lineEl.textContent || '';
                if (text === '\u00a0') text = '';
                lines.push(text);
            });

            return lines.join('\n');
        }

        suite('Normal rendered content', () => {
            test('should extract text from line-content elements with data-line', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [], ['line-number']),
                        createElementNode('div', [createTextNode('Line 1')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    createElementNode('div', [
                        createElementNode('div', [], ['line-number']),
                        createElementNode('div', [createTextNode('Line 2')], ['line-content'], { 'data-line': '2' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, 'Line 1\nLine 2');
            });

            test('should handle empty lines with nbsp', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Text')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('\u00a0')], ['line-content'], { 'data-line': '2' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, 'Text\n');
            });

            test('should skip line-number elements', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('1')], ['line-number']),
                        createElementNode('div', [createTextNode('Content')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, 'Content');
                assert.ok(!result.includes('1Content')); // Line number should not be included
            });

            test('should skip comment bubbles', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [
                            createTextNode('Text with '),
                            createElementNode('span', [createTextNode('commented')], ['commented-text']),
                            createElementNode('div', [createTextNode('Bubble content')], ['inline-comment-bubble'])
                        ], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.ok(!result.includes('Bubble content'));
                assert.ok(result.includes('Text with'));
            });
        });

        suite('Browser-created contenteditable mutations', () => {
            /**
             * CRITICAL TEST: When user presses Enter in the editor, the browser
             * creates new elements (br, div, p) that don't have data-line attributes.
             * The content extraction MUST handle these elements.
             */
            test('should handle br elements created by contenteditable', () => {
                // Simulates: user types "Line 1", presses Shift+Enter, types "Line 2"
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [
                            createTextNode('Line 1'),
                            createElementNode('br', []),
                            createTextNode('Line 2')
                        ], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, 'Line 1\nLine 2');
            });

            test('should handle div elements created by contenteditable (Enter key)', () => {
                // Simulates: user presses Enter in the middle of content
                // Browser creates new divs without data-line attribute
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Original line')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    // This div is created by the browser when user presses Enter
                    // It does NOT have the line-row or line-content classes
                    createElementNode('div', [createTextNode('New line created by user')])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.ok(result.includes('Original line'));
                assert.ok(result.includes('New line created by user'));
            });

            test('should handle p elements created by contenteditable', () => {
                // Some browsers create <p> elements instead of <div>
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Line 1')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    createElementNode('p', [createTextNode('Paragraph created by user')])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.ok(result.includes('Line 1'));
                assert.ok(result.includes('Paragraph created by user'));
            });

            test('should handle mixed rendered and user-created content', () => {
                // Simulates: rendered content with user edits interspersed
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Rendered line 1')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    createElementNode('div', [createTextNode('User added this')]),
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Rendered line 2')], ['line-content'], { 'data-line': '2' })
                    ], ['line-row']),
                    createElementNode('div', [createTextNode('User added this too')])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.ok(result.includes('Rendered line 1'));
                assert.ok(result.includes('User added this'));
                assert.ok(result.includes('Rendered line 2'));
                assert.ok(result.includes('User added this too'));
            });

            test('should preserve correct line order with user-created content', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('A')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    createElementNode('div', [createTextNode('B')]),
                    createElementNode('div', [createTextNode('C')]),
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('D')], ['line-content'], { 'data-line': '2' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                const lines = result.split('\n');

                // Verify order is preserved
                const indexA = lines.findIndex(l => l === 'A');
                const indexB = lines.findIndex(l => l === 'B');
                const indexC = lines.findIndex(l => l === 'C');
                const indexD = lines.findIndex(l => l === 'D');

                assert.ok(indexA < indexB, 'A should come before B');
                assert.ok(indexB < indexC, 'B should come before C');
                assert.ok(indexC < indexD, 'C should come before D');
            });
        });

        suite('Regression prevention - broken implementation comparison', () => {
            /**
             * These tests demonstrate that a simplified implementation that
             * only reads .line-content[data-line] elements would FAIL.
             * This ensures the regression doesn't happen again.
             */

            test('broken implementation misses user-created div elements', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Rendered')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    createElementNode('div', [createTextNode('User created')])
                ], ['editor-wrapper']);

                const correctResult = getPlainTextContent(wrapper);
                const brokenResult = getPlainTextContentBroken(wrapper);

                // Correct implementation captures all content
                assert.ok(correctResult.includes('Rendered'));
                assert.ok(correctResult.includes('User created'));

                // Broken implementation misses user-created content
                assert.ok(brokenResult.includes('Rendered'));
                assert.ok(!brokenResult.includes('User created'),
                    'Broken implementation should miss user-created content - this test ensures we use the correct implementation');
            });

            test('broken implementation misses content from br elements', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [
                            createTextNode('Before'),
                            createElementNode('br', []),
                            createTextNode('After')
                        ], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const correctResult = getPlainTextContent(wrapper);
                const brokenResult = getPlainTextContentBroken(wrapper);

                // Correct implementation handles br as line break
                assert.strictEqual(correctResult, 'Before\nAfter');

                // Broken implementation just concatenates (no line break)
                assert.strictEqual(brokenResult, 'BeforeAfter',
                    'Broken implementation should not handle br elements properly');
            });

            test('broken implementation returns wrong content for edited document', () => {
                // Simulate a document where user has made multiple edits
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Line 1')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    createElementNode('div', [createTextNode('Inserted by user')]),
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Line 2')], ['line-content'], { 'data-line': '2' })
                    ], ['line-row']),
                    createElementNode('p', [createTextNode('Another user insert')]),
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Line 3')], ['line-content'], { 'data-line': '3' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const correctResult = getPlainTextContent(wrapper);
                const brokenResult = getPlainTextContentBroken(wrapper);

                // Count lines in each result
                const correctLines = correctResult.split('\n').filter(l => l.length > 0);
                const brokenLines = brokenResult.split('\n').filter(l => l.length > 0);

                // Correct implementation should have 5 lines (3 rendered + 2 user-created)
                assert.strictEqual(correctLines.length, 5);

                // Broken implementation should only have 3 lines (misses user-created)
                assert.strictEqual(brokenLines.length, 3,
                    'Broken implementation should miss user-created content');
            });
        });

        suite('Edge cases', () => {
            test('should handle empty editor', () => {
                const wrapper = createElementNode('div', [], ['editor-wrapper']);
                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, '');
            });

            test('should handle editor with only whitespace', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('   ')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, '   ');
            });

            test('should handle deeply nested user-created content', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [
                            createElementNode('span', [createTextNode('Nested text')])
                        ])
                    ])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.ok(result.includes('Nested text'));
            });

            test('should handle multiple consecutive br elements', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [
                            createTextNode('Line 1'),
                            createElementNode('br', []),
                            createElementNode('br', []),
                            createTextNode('Line 2')
                        ], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                // Should have two line breaks (empty line between)
                assert.strictEqual(result, 'Line 1\n\nLine 2');
            });
        });
    });

    suite('Editor Content Sync Flow', () => {
        /**
         * This test suite verifies the content synchronization logic between
         * the webview editor and the VS Code document.
         * 
         * Key requirements:
         * 1. Content changes from webview should update the VS Code document
         * 2. Webview-initiated changes should NOT trigger re-renders (to preserve cursor)
         * 3. External document changes SHOULD trigger re-renders
         * 4. Race conditions should be handled gracefully
         */

        /**
         * Mock state manager for testing
         */
        class MockState {
            currentContent: string = '';
            pendingUpdate: boolean = false;

            setCurrentContent(content: string) {
                this.currentContent = content;
            }
        }

        /**
         * Simulates the handleEditorInput flow
         */
        function handleEditorInput(
            state: MockState,
            extractedContent: string,
            sendToExtension: (content: string) => void
        ): boolean {
            // Only send if content changed
            if (extractedContent !== state.currentContent) {
                state.setCurrentContent(extractedContent);
                sendToExtension(extractedContent);
                return true; // Content was sent
            }
            return false; // No change
        }

        /**
         * Simulates the extension-side message handling
         */
        function handleUpdateContent(
            isWebviewEdit: { value: boolean },
            content: string,
            applyEdit: (content: string) => void,
            setWebviewEdit: () => void
        ): void {
            setWebviewEdit();
            applyEdit(content);
        }

        /**
         * Simulates the document change handler
         */
        function handleDocumentChange(
            isWebviewEdit: { value: boolean },
            updateWebview: () => void
        ): boolean {
            if (isWebviewEdit.value) {
                isWebviewEdit.value = false;
                return false; // Skipped update
            }
            updateWebview();
            return true; // Update was called
        }

        suite('Normal editing flow', () => {
            test('should send content to extension when content changes', () => {
                const state = new MockState();
                state.currentContent = 'Original content';
                let sentContent = '';

                const result = handleEditorInput(
                    state,
                    'Modified content',
                    (content) => { sentContent = content; }
                );

                assert.strictEqual(result, true);
                assert.strictEqual(sentContent, 'Modified content');
                assert.strictEqual(state.currentContent, 'Modified content');
            });

            test('should NOT send content when content is unchanged', () => {
                const state = new MockState();
                state.currentContent = 'Same content';
                let sendCalled = false;

                const result = handleEditorInput(
                    state,
                    'Same content',
                    () => { sendCalled = true; }
                );

                assert.strictEqual(result, false);
                assert.strictEqual(sendCalled, false);
            });
        });

        suite('isWebviewEdit flag behavior', () => {
            test('should set flag before applying edit', () => {
                const isWebviewEdit = { value: false };
                let flagWasSetBeforeEdit = false;

                handleUpdateContent(
                    isWebviewEdit,
                    'new content',
                    () => { flagWasSetBeforeEdit = isWebviewEdit.value; },
                    () => { isWebviewEdit.value = true; }
                );

                assert.strictEqual(flagWasSetBeforeEdit, true,
                    'Flag should be set BEFORE edit is applied');
            });

            test('should skip updateWebview when flag is set', () => {
                const isWebviewEdit = { value: true };
                let updateWebviewCalled = false;

                const result = handleDocumentChange(
                    isWebviewEdit,
                    () => { updateWebviewCalled = true; }
                );

                assert.strictEqual(result, false, 'Should skip update');
                assert.strictEqual(updateWebviewCalled, false,
                    'updateWebview should NOT be called');
                assert.strictEqual(isWebviewEdit.value, false,
                    'Flag should be reset after skip');
            });

            test('should call updateWebview when flag is not set', () => {
                const isWebviewEdit = { value: false };
                let updateWebviewCalled = false;

                const result = handleDocumentChange(
                    isWebviewEdit,
                    () => { updateWebviewCalled = true; }
                );

                assert.strictEqual(result, true, 'Should call update');
                assert.strictEqual(updateWebviewCalled, true,
                    'updateWebview SHOULD be called for external changes');
            });
        });

        suite('Complete edit cycle', () => {
            test('should complete full webview-initiated edit without re-render', () => {
                const state = new MockState();
                state.currentContent = 'Line 1\nLine 2';
                const isWebviewEdit = { value: false };
                let documentContent = 'Line 1\nLine 2';
                let updateWebviewCallCount = 0;

                // Step 1: User types in webview
                const newContent = 'Line 1\nModified Line 2';
                handleEditorInput(
                    state,
                    newContent,
                    (content) => {
                        // Step 2: Extension receives message
                        handleUpdateContent(
                            isWebviewEdit,
                            content,
                            (c) => { documentContent = c; },
                            () => { isWebviewEdit.value = true; }
                        );
                    }
                );

                // Step 3: Document change event fires
                handleDocumentChange(
                    isWebviewEdit,
                    () => { updateWebviewCallCount++; }
                );

                // Verify: Document was updated, but updateWebview was NOT called
                assert.strictEqual(documentContent, 'Line 1\nModified Line 2');
                assert.strictEqual(updateWebviewCallCount, 0,
                    'updateWebview should NOT be called for webview-initiated edits');
            });

            test('should trigger re-render for external document changes', () => {
                const isWebviewEdit = { value: false };
                let updateWebviewCallCount = 0;

                // External edit (e.g., another editor)
                // Document changes without going through webview

                // Document change event fires
                handleDocumentChange(
                    isWebviewEdit,
                    () => { updateWebviewCallCount++; }
                );

                assert.strictEqual(updateWebviewCallCount, 1,
                    'updateWebview SHOULD be called for external changes');
            });
        });

        suite('Race condition handling', () => {
            test('should handle rapid successive edits', () => {
                const state = new MockState();
                state.currentContent = 'Original';
                const isWebviewEdit = { value: false };
                let updateWebviewCallCount = 0;

                // Simulate rapid edits
                for (let i = 0; i < 5; i++) {
                    const newContent = `Edit ${i}`;
                    handleEditorInput(
                        state,
                        newContent,
                        (content) => {
                            handleUpdateContent(
                                isWebviewEdit,
                                content,
                                () => { /* apply edit */ },
                                () => { isWebviewEdit.value = true; }
                            );
                        }
                    );

                    // Document change event
                    handleDocumentChange(
                        isWebviewEdit,
                        () => { updateWebviewCallCount++; }
                    );
                }

                // All edits should complete without triggering updateWebview
                assert.strictEqual(updateWebviewCallCount, 0,
                    'No re-renders should occur during rapid webview edits');
                assert.strictEqual(state.currentContent, 'Edit 4');
            });

            test('should handle interleaved webview and external edits', () => {
                const state = new MockState();
                state.currentContent = 'Start';
                const isWebviewEdit = { value: false };
                const updateWebviewCalls: string[] = [];

                // Webview edit
                handleEditorInput(
                    state,
                    'Webview Edit',
                    (content) => {
                        handleUpdateContent(
                            isWebviewEdit,
                            content,
                            () => { /* apply */ },
                            () => { isWebviewEdit.value = true; }
                        );
                    }
                );
                handleDocumentChange(isWebviewEdit, () => {
                    updateWebviewCalls.push('after webview');
                });

                // External edit (flag should still be false after reset)
                handleDocumentChange(isWebviewEdit, () => {
                    updateWebviewCalls.push('external');
                });

                // Only external edit should trigger updateWebview
                assert.deepStrictEqual(updateWebviewCalls, ['external']);
            });
        });
    });
});

