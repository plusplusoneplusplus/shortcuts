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
            const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const lines = normalized.split('\n');
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

        test('should handle CRLF line endings without leaving carriage returns in extracted code', () => {
            const content = '```cpp\r\nline1\r\nline2\r\n```';
            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].code, 'line1\nline2');
            assert.ok(!blocks[0].code.includes('\r'));
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
            const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const lines = normalized.split('\n');
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

            test('should parse tables with CRLF line endings', () => {
                const content = '| A | B |\r\n|---|---|\r\n| 1 | 2 |';
                const tables = parseTables(content);
                assert.strictEqual(tables.length, 1);
                assert.deepStrictEqual(tables[0].headers, ['A', 'B']);
                assert.strictEqual(tables[0].rows.length, 1);
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

            function processNode(node: MockNode, isFirstChild: boolean = false, insideLineContent: boolean = false): void {
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

                    // Handle line breaks
                    if (tag === 'br') {
                        // Only create a new line if we're NOT inside a line-content element
                        // or if there's actual content after the br (simplified for tests)
                        if (!insideLineContent) {
                            lines.push('');
                        }
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
                        // Process children - mark that we're inside line-content
                        let childIndex = 0;
                        el.childNodes.forEach(child => {
                            processNode(child, childIndex === 0, true);
                            childIndex++;
                        });
                        return;
                    }

                    // For line-row elements, just process children
                    if (el.classList?.contains('line-row') || el.classList?.contains('block-row')) {
                        let childIndex = 0;
                        el.childNodes.forEach(child => {
                            processNode(child, childIndex === 0, insideLineContent);
                            childIndex++;
                        });
                        return;
                    }

                    // For other block elements created by contenteditable
                    if (isBlockElement) {
                        if (insideLineContent) {
                            // Inside line-content, block elements should create a new line
                            // but only if there's content in the current line
                            if (lines.length > 0 && lines[lines.length - 1] !== '') {
                                lines.push('');
                            }
                        } else if (lines.length > 0 && lines[lines.length - 1] !== '' && !isFirstChild) {
                            lines.push('');
                        }
                    }

                    // Process children
                    let childIndex = 0;
                    el.childNodes.forEach(child => {
                        processNode(child, childIndex === 0, insideLineContent);
                        childIndex++;
                    });
                }
            }

            processNode(editorWrapper, true, false);

            // Clean up: strip editor placeholder artifacts (NBSP at boundaries)
            function normalizeExtractedLine(line: string): string {
                if (!line) return line;
                if (!line.includes('\u00a0')) return line;
                return line.replace(/^\u00a0+/, '').replace(/\u00a0+$/, '');
            }

            return lines.map(normalizeExtractedLine).join('\n');
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

            test('should handle empty lines rendered as <br> placeholders', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Text')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row']),
                    createElementNode('div', [
                        createElementNode('div', [createElementNode('br', [])], ['line-content'], { 'data-line': '2' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, 'Text\n');
            });

            test('should strip leading NBSP artifacts from extracted lines', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('\u00a0Hello')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, 'Hello');
            });

            test('should strip trailing NBSP artifacts from extracted lines', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Hello\u00a0')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, 'Hello');
            });

            test('should preserve interior NBSP characters', () => {
                const wrapper = createElementNode('div', [
                    createElementNode('div', [
                        createElementNode('div', [createTextNode('Hello\u00a0World')], ['line-content'], { 'data-line': '1' })
                    ], ['line-row'])
                ], ['editor-wrapper']);

                const result = getPlainTextContent(wrapper);
                assert.strictEqual(result, 'Hello\u00a0World');
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
                // Inside line-content, br elements are NOT treated as line breaks
                // (they're browser artifacts from contenteditable)
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
                // Inside line-content, br doesn't create a new line - content stays on same line
                assert.strictEqual(result, 'Line 1Line 2');
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

            test('broken implementation concatenates content same as correct for br inside line-content', () => {
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

                // Both implementations now concatenate br inside line-content
                // (br inside line-content is ignored to prevent extra blank lines)
                assert.strictEqual(correctResult, 'BeforeAfter');
                assert.strictEqual(brokenResult, 'BeforeAfter');
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
                // Inside line-content, br elements are ignored to prevent extra blank lines
                assert.strictEqual(result, 'Line 1Line 2');
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

    suite('Enter Key Handling Logic (handleEnterKey)', () => {
        /**
         * This test suite verifies the Enter key handling logic that was introduced
         * to fix layout issues in the contenteditable editor.
         * 
         * The browser's default Enter key behavior creates DOM elements (<div>) that
         * become flex siblings in line-row containers, causing text to appear
         * side-by-side instead of on new lines.
         * 
         * The fix: Custom Enter key handler that manipulates content directly and
         * re-renders, avoiding browser-created DOM elements.
         * 
         * Commit: 76fb003d9195089b666e2380c8a06d6b3869c298
         */

        interface SelectionInfo {
            startLine: number;
            startColumn: number;
            endLine: number;
            endColumn: number;
        }

        /**
         * Pure function implementation of Enter key content manipulation.
         * This mirrors the handleEnterKey logic in dom-handlers.ts.
         */
        function handleEnterKeyContent(
            content: string,
            selectionInfo: SelectionInfo
        ): { newContent: string; newCursorLine: number; newCursorColumn: number } {
            const lines = content.split('\n');

            // Calculate the position to insert the newline
            // selectionInfo uses 1-based line numbers and 1-based columns
            const lineIndex = selectionInfo.startLine - 1;
            const columnIndex = selectionInfo.startColumn - 1;

            // Handle invalid line
            if (lineIndex < 0 || lineIndex >= lines.length) {
                // In actual code, this would fall back to execCommand
                return { newContent: content, newCursorLine: 1, newCursorColumn: 1 };
            }

            // If there's a selection (not collapsed), delete the selected text first
            if (selectionInfo.startLine !== selectionInfo.endLine ||
                selectionInfo.startColumn !== selectionInfo.endColumn) {
                const startLineIdx = selectionInfo.startLine - 1;
                const endLineIdx = selectionInfo.endLine - 1;
                const startCol = selectionInfo.startColumn - 1;
                const endCol = selectionInfo.endColumn - 1;

                if (startLineIdx === endLineIdx) {
                    // Single line selection
                    const line = lines[startLineIdx];
                    lines[startLineIdx] = line.substring(0, startCol) + line.substring(endCol);
                } else {
                    // Multi-line selection
                    const startLine = lines[startLineIdx];
                    const endLine = lines[endLineIdx];
                    lines[startLineIdx] = startLine.substring(0, startCol) + endLine.substring(endCol);
                    lines.splice(startLineIdx + 1, endLineIdx - startLineIdx);
                }
            }

            // Now insert the newline at the cursor position
            const currentLine = lines[lineIndex] || '';
            const beforeCursor = currentLine.substring(0, columnIndex);
            const afterCursor = currentLine.substring(columnIndex);

            // Split the line at cursor position
            lines[lineIndex] = beforeCursor;
            lines.splice(lineIndex + 1, 0, afterCursor);

            // Calculate new cursor position (start of the new line)
            const newCursorLine = selectionInfo.startLine + 1;
            const newCursorColumn = 1;

            return {
                newContent: lines.join('\n'),
                newCursorLine,
                newCursorColumn
            };
        }

        suite('Basic Enter key insertion', () => {
            test('should insert newline at end of line', () => {
                const content = 'Hello World';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 12, // After "Hello World"
                    endLine: 1,
                    endColumn: 12
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, 'Hello World\n');
                assert.strictEqual(result.newCursorLine, 2);
                assert.strictEqual(result.newCursorColumn, 1);
            });

            test('should insert newline at beginning of line', () => {
                const content = 'Hello World';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 1, // At start
                    endLine: 1,
                    endColumn: 1
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, '\nHello World');
                assert.strictEqual(result.newCursorLine, 2);
                assert.strictEqual(result.newCursorColumn, 1);
            });

            test('should insert newline in middle of line', () => {
                const content = 'Hello World';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 6, // After "Hello"
                    endLine: 1,
                    endColumn: 6
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, 'Hello\n World');
                assert.strictEqual(result.newCursorLine, 2);
                assert.strictEqual(result.newCursorColumn, 1);
            });

            test('should handle empty line', () => {
                const content = '';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 1,
                    endLine: 1,
                    endColumn: 1
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, '\n');
                assert.strictEqual(result.newCursorLine, 2);
                assert.strictEqual(result.newCursorColumn, 1);
            });
        });

        suite('Multi-line content handling', () => {
            test('should insert newline in middle line of multi-line content', () => {
                const content = 'Line 1\nLine 2\nLine 3';
                const selection: SelectionInfo = {
                    startLine: 2,
                    startColumn: 5, // After "Line"
                    endLine: 2,
                    endColumn: 5
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, 'Line 1\nLine\n 2\nLine 3');
                assert.strictEqual(result.newCursorLine, 3);
            });

            test('should insert newline at end of last line', () => {
                const content = 'Line 1\nLine 2\nLine 3';
                const selection: SelectionInfo = {
                    startLine: 3,
                    startColumn: 7, // End of "Line 3"
                    endLine: 3,
                    endColumn: 7
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, 'Line 1\nLine 2\nLine 3\n');
                assert.strictEqual(result.newCursorLine, 4);
            });

            test('should preserve line count after multiple enters', () => {
                let content = 'A\nB\nC';
                let selection: SelectionInfo = {
                    startLine: 2,
                    startColumn: 2,
                    endLine: 2,
                    endColumn: 2
                };

                const result1 = handleEnterKeyContent(content, selection);
                assert.strictEqual(result1.newContent.split('\n').length, 4);

                // Simulate another Enter
                selection = {
                    startLine: 3,
                    startColumn: 1,
                    endLine: 3,
                    endColumn: 1
                };
                const result2 = handleEnterKeyContent(result1.newContent, selection);
                assert.strictEqual(result2.newContent.split('\n').length, 5);
            });
        });

        suite('Selection deletion before Enter', () => {
            test('should delete single-line selection and insert newline', () => {
                const content = 'Hello World';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 1,
                    endLine: 1,
                    endColumn: 6 // Select "Hello"
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, '\n World');
                assert.strictEqual(result.newCursorLine, 2);
            });

            test('should delete entire line content and insert newline', () => {
                const content = 'Delete me';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 1,
                    endLine: 1,
                    endColumn: 10 // Select entire line
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, '\n');
            });

            test('should handle selection in middle of line', () => {
                const content = 'ABC DEF GHI';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 5, // After "ABC "
                    endLine: 1,
                    endColumn: 8 // Before " GHI"
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, 'ABC \n GHI');
            });
        });

        suite('Multi-line selection handling', () => {
            test('should delete multi-line selection and insert newline', () => {
                const content = 'Line 1\nLine 2\nLine 3';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 5, // Middle of "Line 1"
                    endLine: 2,
                    endColumn: 5 // Middle of "Line 2"
                };

                const result = handleEnterKeyContent(content, selection);
                // "Line" from Line 1 + " 2" from Line 2 should be joined first, then newline inserted
                assert.ok(result.newContent.includes('Line'));
                assert.strictEqual(result.newCursorLine, 2);
            });

            test('should handle selection spanning all lines', () => {
                const content = 'First\nSecond\nThird';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 1,
                    endLine: 3,
                    endColumn: 6 // End of "Third"
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, '\n');
            });

            test('should preserve content before and after multi-line selection', () => {
                const content = 'AAA BBB\nCCC DDD\nEEE FFF';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 5, // After "AAA "
                    endLine: 3,
                    endColumn: 4 // Before " FFF"
                };

                const result = handleEnterKeyContent(content, selection);
                const lines = result.newContent.split('\n');
                assert.ok(lines[0] === 'AAA ');
                assert.ok(lines[1] === ' FFF');
            });
        });

        suite('Edge cases', () => {
            test('should handle invalid line number gracefully', () => {
                const content = 'Hello';
                const selection: SelectionInfo = {
                    startLine: 5, // Invalid - only 1 line
                    startColumn: 1,
                    endLine: 5,
                    endColumn: 1
                };

                const result = handleEnterKeyContent(content, selection);
                // Should return unchanged content (fallback behavior)
                assert.strictEqual(result.newContent, content);
            });

            test('should handle column beyond line length', () => {
                const content = 'Short';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 100, // Beyond line length
                    endLine: 1,
                    endColumn: 100
                };

                const result = handleEnterKeyContent(content, selection);
                // Should insert at end of line
                assert.strictEqual(result.newContent, 'Short\n');
            });

            test('should handle content with special characters', () => {
                const content = 'const x = { foo: "bar" };';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 11, // After "const x = "
                    endLine: 1,
                    endColumn: 11
                };

                const result = handleEnterKeyContent(content, selection);
                assert.strictEqual(result.newContent, 'const x = \n{ foo: "bar" };');
            });

            test('should handle content with unicode', () => {
                const content = 'Hello 🌍 World';
                const selection: SelectionInfo = {
                    startLine: 1,
                    startColumn: 9, // After emoji
                    endLine: 1,
                    endColumn: 9
                };

                const result = handleEnterKeyContent(content, selection);
                // Note: Unicode handling might vary based on how columns are counted
                assert.ok(result.newContent.includes('\n'));
                assert.ok(result.newContent.includes('🌍'));
            });
        });
    });

    suite('Timestamp-based Webview Edit Tracking', () => {
        /**
         * This test suite verifies the timestamp-based approach for tracking
         * webview-initiated edits.
         * 
         * The problem: Using a boolean flag `isWebviewEdit = true` doesn't work
         * because multiple document change events can fire for a single edit
         * operation, and the flag gets reset after the first event.
         * 
         * The solution: Use a timestamp window (100ms) during which we ignore
         * document change events, allowing all related events to complete.
         * 
         * Commit: 76fb003d9195089b666e2380c8a06d6b3869c298
         */

        /**
         * Simulates the timestamp-based edit tracking logic
         */
        class WebviewEditTracker {
            private webviewEditUntil: number = 0;

            /**
             * Mark that a webview edit is in progress.
             * Sets a 100ms window during which we ignore document changes.
             */
            markWebviewEdit(): void {
                this.webviewEditUntil = Date.now() + 100;
            }

            /**
             * Check if we're within the webview edit window.
             * Returns true if we should skip the document change event.
             */
            isWebviewEditInProgress(): boolean {
                return Date.now() < this.webviewEditUntil;
            }

            /**
             * Get time remaining in the edit window (for debugging)
             */
            getTimeRemaining(): number {
                return this.webviewEditUntil - Date.now();
            }
        }

        let tracker: WebviewEditTracker;

        setup(() => {
            tracker = new WebviewEditTracker();
        });

        test('should return false when no edit is in progress', () => {
            assert.strictEqual(tracker.isWebviewEditInProgress(), false);
        });

        test('should return true immediately after marking edit', () => {
            tracker.markWebviewEdit();
            assert.strictEqual(tracker.isWebviewEditInProgress(), true);
        });

        test('should return true for multiple checks within window', () => {
            tracker.markWebviewEdit();

            // Simulate multiple document change events
            assert.strictEqual(tracker.isWebviewEditInProgress(), true);
            assert.strictEqual(tracker.isWebviewEditInProgress(), true);
            assert.strictEqual(tracker.isWebviewEditInProgress(), true);
        });

        test('should have positive time remaining after marking', () => {
            tracker.markWebviewEdit();
            const remaining = tracker.getTimeRemaining();
            assert.ok(remaining > 0, `Time remaining should be positive, got ${remaining}`);
            assert.ok(remaining <= 100, `Time remaining should be <= 100ms, got ${remaining}`);
        });

        test('should allow re-marking to extend the window', () => {
            tracker.markWebviewEdit();
            const firstRemaining = tracker.getTimeRemaining();

            // Re-mark after some time
            tracker.markWebviewEdit();
            const secondRemaining = tracker.getTimeRemaining();

            // Second marking should reset the window
            assert.ok(secondRemaining >= firstRemaining - 10,
                'Re-marking should reset/extend the window');
        });

        suite('Comparison with boolean flag approach', () => {
            /**
             * Demonstrates why the boolean flag approach fails
             */
            class BooleanFlagTracker {
                private isWebviewEdit: boolean = false;

                markWebviewEdit(): void {
                    this.isWebviewEdit = true;
                }

                checkAndReset(): boolean {
                    const wasEdit = this.isWebviewEdit;
                    this.isWebviewEdit = false;
                    return wasEdit;
                }
            }

            test('boolean flag fails with multiple document change events', () => {
                const booleanTracker = new BooleanFlagTracker();
                booleanTracker.markWebviewEdit();

                // First event - handled correctly
                assert.strictEqual(booleanTracker.checkAndReset(), true);

                // Second event - INCORRECTLY returns false!
                assert.strictEqual(booleanTracker.checkAndReset(), false);

                // Third event - also returns false
                assert.strictEqual(booleanTracker.checkAndReset(), false);
            });

            test('timestamp approach handles multiple document change events', () => {
                tracker.markWebviewEdit();

                // All events within the window are correctly identified
                assert.strictEqual(tracker.isWebviewEditInProgress(), true);
                assert.strictEqual(tracker.isWebviewEditInProgress(), true);
                assert.strictEqual(tracker.isWebviewEditInProgress(), true);
            });
        });

        suite('Integration scenario simulation', () => {
            /**
             * Simulates the actual flow when a user types in the webview
             */

            interface MockDocument {
                content: string;
                version: number;
            }

            class MockExtensionHandler {
                webviewEditUntil: number = 0;
                updateWebviewCallCount: number = 0;
                document: MockDocument = { content: '', version: 0 };

                handleWebviewMessage(newContent: string): void {
                    // Mark edit window
                    this.webviewEditUntil = Date.now() + 100;
                    // Apply edit to document
                    this.document.content = newContent;
                    this.document.version++;
                }

                handleDocumentChange(): void {
                    const now = Date.now();
                    const isWebviewEdit = now < this.webviewEditUntil;

                    if (isWebviewEdit) {
                        // Skip updateWebview
                        return;
                    }

                    // External change - update webview
                    this.updateWebviewCallCount++;
                }
            }

            test('should not call updateWebview for webview-initiated edits', () => {
                const handler = new MockExtensionHandler();

                // User types in webview
                handler.handleWebviewMessage('New content');

                // Multiple document change events fire (VS Code behavior)
                handler.handleDocumentChange();
                handler.handleDocumentChange();
                handler.handleDocumentChange();

                // updateWebview should NOT have been called
                assert.strictEqual(handler.updateWebviewCallCount, 0);
            });

            test('should call updateWebview for external edits', () => {
                const handler = new MockExtensionHandler();

                // External edit (no webview message)
                handler.document.content = 'External edit';
                handler.document.version++;

                // Document change event fires
                handler.handleDocumentChange();

                // updateWebview SHOULD have been called
                assert.strictEqual(handler.updateWebviewCallCount, 1);
            });

            test('should handle interleaved webview and external edits', () => {
                const handler = new MockExtensionHandler();

                // Webview edit
                handler.handleWebviewMessage('Edit 1');
                handler.handleDocumentChange();
                handler.handleDocumentChange();
                assert.strictEqual(handler.updateWebviewCallCount, 0);

                // Wait for window to expire (simulated by setting past time)
                handler.webviewEditUntil = Date.now() - 1;

                // External edit
                handler.handleDocumentChange();
                assert.strictEqual(handler.updateWebviewCallCount, 1);

                // Another webview edit
                handler.handleWebviewMessage('Edit 2');
                handler.handleDocumentChange();
                assert.strictEqual(handler.updateWebviewCallCount, 1); // Still 1
            });
        });
    });

    suite('Cursor Position Fallback (getCursorPositionFromOffset)', () => {
        /**
         * This test suite verifies the fallback cursor position calculation
         * used when the cursor is in a browser-created element.
         * 
         * When the browser creates elements (e.g., after pressing Enter),
         * the cursor may end up in elements without data-line attributes.
         * The fallback calculates position based on character offset.
         * 
         * Commit: 76fb003d9195089b666e2380c8a06d6b3869c298
         */

        interface CursorPosition {
            line: number;
            column: number;
        }

        /**
         * Pure function implementation of offset-based cursor calculation.
         * This mirrors getCursorPositionFromOffset in render.ts.
         */
        function getCursorPositionFromOffset(textBefore: string): CursorPosition {
            const lines = textBefore.split('\n');
            return {
                line: lines.length,
                column: lines[lines.length - 1].length
            };
        }

        test('should return correct position for single line', () => {
            const textBefore = 'Hello';
            const result = getCursorPositionFromOffset(textBefore);
            assert.strictEqual(result.line, 1);
            assert.strictEqual(result.column, 5);
        });

        test('should return correct position at start of content', () => {
            const textBefore = '';
            const result = getCursorPositionFromOffset(textBefore);
            assert.strictEqual(result.line, 1);
            assert.strictEqual(result.column, 0);
        });

        test('should return correct position after newline', () => {
            const textBefore = 'Line 1\n';
            const result = getCursorPositionFromOffset(textBefore);
            assert.strictEqual(result.line, 2);
            assert.strictEqual(result.column, 0);
        });

        test('should return correct position in middle of multi-line content', () => {
            const textBefore = 'Line 1\nLine 2\nLi';
            const result = getCursorPositionFromOffset(textBefore);
            assert.strictEqual(result.line, 3);
            assert.strictEqual(result.column, 2);
        });

        test('should handle multiple consecutive newlines', () => {
            const textBefore = 'Line 1\n\n\nLine 4';
            const result = getCursorPositionFromOffset(textBefore);
            assert.strictEqual(result.line, 4);
            assert.strictEqual(result.column, 6);
        });

        test('should handle cursor on empty line', () => {
            const textBefore = 'Line 1\n\n';
            const result = getCursorPositionFromOffset(textBefore);
            assert.strictEqual(result.line, 3);
            assert.strictEqual(result.column, 0);
        });

        test('should handle content with special characters', () => {
            const textBefore = 'const x = { foo: "bar"';
            const result = getCursorPositionFromOffset(textBefore);
            assert.strictEqual(result.line, 1);
            assert.strictEqual(result.column, 22);
        });

        suite('Comparison with line-based approach', () => {
            /**
             * The normal approach uses data-line attributes.
             * This fallback is used when those aren't available.
             */

            test('should match expected position for standard content', () => {
                // If content is "Line 1\nLine 2\nLine 3" and cursor is after "Line 2"
                const textBefore = 'Line 1\nLine 2';
                const result = getCursorPositionFromOffset(textBefore);

                // Expected: line 2, column 6 (end of "Line 2")
                assert.strictEqual(result.line, 2);
                assert.strictEqual(result.column, 6);
            });

            test('should handle Enter key scenario (cursor at start of new line)', () => {
                // After pressing Enter, cursor should be at start of new line
                const textBefore = 'First line\n';
                const result = getCursorPositionFromOffset(textBefore);

                assert.strictEqual(result.line, 2);
                assert.strictEqual(result.column, 0);
            });
        });
    });

    suite('Find Text Node at Column (restoreCursorToPosition helper)', () => {
        /**
         * This test suite verifies the logic for finding a text node
         * at a specific column position within a line element.
         * 
         * This is used by restoreCursorToPosition to place the cursor
         * at the correct position after re-rendering.
         * 
         * Commit: 76fb003d9195089b666e2380c8a06d6b3869c298
         */

        /**
         * Simulates the text node finding logic using a simple structure.
         * In the actual code, this uses TreeWalker on DOM nodes.
         */
        interface TextSegment {
            text: string;
            isSkipped: boolean; // e.g., comment bubbles
        }

        interface FoundNode {
            segmentIndex: number;
            offset: number;
        }

        function findTextSegmentAtColumn(
            segments: TextSegment[],
            targetColumn: number
        ): FoundNode | null {
            let currentOffset = 0;
            let lastValidIndex = -1;
            let lastValidLength = 0;

            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];

                // Skip nodes like comment bubbles
                if (segment.isSkipped) {
                    continue;
                }

                lastValidIndex = i;
                lastValidLength = segment.text.length;

                if (currentOffset + segment.text.length >= targetColumn) {
                    return {
                        segmentIndex: i,
                        offset: Math.min(targetColumn - currentOffset, segment.text.length)
                    };
                }
                currentOffset += segment.text.length;
            }

            // If target is beyond content, return last segment at end
            if (lastValidIndex >= 0) {
                return {
                    segmentIndex: lastValidIndex,
                    offset: lastValidLength
                };
            }

            return null;
        }

        test('should find position in single text segment', () => {
            const segments: TextSegment[] = [{ text: 'Hello World', isSkipped: false }];
            const result = findTextSegmentAtColumn(segments, 5);

            assert.ok(result);
            assert.strictEqual(result.segmentIndex, 0);
            assert.strictEqual(result.offset, 5);
        });

        test('should find position at start', () => {
            const segments: TextSegment[] = [{ text: 'Hello', isSkipped: false }];
            const result = findTextSegmentAtColumn(segments, 0);

            assert.ok(result);
            assert.strictEqual(result.offset, 0);
        });

        test('should find position at end of segment', () => {
            const segments: TextSegment[] = [{ text: 'Hello', isSkipped: false }];
            const result = findTextSegmentAtColumn(segments, 5);

            assert.ok(result);
            assert.strictEqual(result.offset, 5);
        });

        test('should handle multiple text segments', () => {
            const segments: TextSegment[] = [
                { text: 'Hello', isSkipped: false },
                { text: ' ', isSkipped: false },
                { text: 'World', isSkipped: false }
            ];

            // Target in first segment (column 3)
            let result = findTextSegmentAtColumn(segments, 3);
            assert.ok(result);
            assert.strictEqual(result.segmentIndex, 0);
            assert.strictEqual(result.offset, 3);

            // Target at end of first segment (column 5 = end of "Hello")
            result = findTextSegmentAtColumn(segments, 5);
            assert.ok(result);
            assert.strictEqual(result.segmentIndex, 0);
            assert.strictEqual(result.offset, 5);

            // Target in second segment (space, column 6)
            result = findTextSegmentAtColumn(segments, 6);
            assert.ok(result);
            assert.strictEqual(result.segmentIndex, 1);
            assert.strictEqual(result.offset, 1);

            // Target in third segment (column 8 = "Wo" of "World")
            result = findTextSegmentAtColumn(segments, 8);
            assert.ok(result);
            assert.strictEqual(result.segmentIndex, 2);
            assert.strictEqual(result.offset, 2);
        });

        test('should skip comment bubble segments', () => {
            const segments: TextSegment[] = [
                { text: 'Normal text', isSkipped: false },
                { text: 'Comment content', isSkipped: true }, // This should be skipped
                { text: ' more text', isSkipped: false }
            ];

            // Column 15 should be in the third segment, not the comment
            const result = findTextSegmentAtColumn(segments, 15);
            assert.ok(result);
            assert.strictEqual(result.segmentIndex, 2);
            assert.strictEqual(result.offset, 4);
        });

        test('should return last valid segment when target is beyond content', () => {
            const segments: TextSegment[] = [{ text: 'Short', isSkipped: false }];
            const result = findTextSegmentAtColumn(segments, 100);

            assert.ok(result);
            assert.strictEqual(result.segmentIndex, 0);
            assert.strictEqual(result.offset, 5); // End of "Short"
        });

        test('should return null for empty segments', () => {
            const segments: TextSegment[] = [];
            const result = findTextSegmentAtColumn(segments, 5);

            assert.strictEqual(result, null);
        });

        test('should return null when all segments are skipped', () => {
            const segments: TextSegment[] = [
                { text: 'Skipped 1', isSkipped: true },
                { text: 'Skipped 2', isSkipped: true }
            ];
            const result = findTextSegmentAtColumn(segments, 5);

            assert.strictEqual(result, null);
        });

        test('should handle segment with highlighted code spans', () => {
            // Simulates markdown rendering that creates multiple spans
            const segments: TextSegment[] = [
                { text: 'const ', isSkipped: false },
                { text: 'x', isSkipped: false },
                { text: ' = ', isSkipped: false },
                { text: '1', isSkipped: false },
                { text: ';', isSkipped: false }
            ];

            const result = findTextSegmentAtColumn(segments, 10);
            assert.ok(result);
            // Should find position in the appropriate segment
        });
    });

    suite('Code Block Content Extraction (extractBlockText)', () => {
        /**
         * This test suite verifies the extractBlockText logic that reconstructs
         * markdown code blocks from the rendered DOM.
         * 
         * Critical requirement: Code blocks without a language specifier should
         * be preserved without adding 'plaintext' as the language.
         * 
         * Original: ```\ncode\n```
         * Should stay: ```\ncode\n```
         * Should NOT become: ```plaintext\ncode\n```
         */

        interface MockCodeBlockDOM {
            language: string;
            code: string;
            dataCode?: string; // The data-code attribute on copy button
        }

        /**
         * Simulates the extractBlockText logic for code blocks
         * This mirrors the logic in dom-handlers.ts
         */
        function extractCodeBlockText(mockDom: MockCodeBlockDOM): string {
            const language = mockDom.language;
            const code = mockDom.dataCode || mockDom.code;

            // Don't include 'plaintext' in the code fence - it's our default for blocks without a language
            const fenceLanguage = language === 'plaintext' ? '' : language;

            return '```' + fenceLanguage + '\n' + code + '\n```';
        }

        test('should preserve code blocks without language specifier', () => {
            // Original markdown: ```\nsome code\n```
            // When parsed, language becomes 'plaintext'
            // When extracted, should output ``` not ```plaintext
            const mockDom: MockCodeBlockDOM = {
                language: 'plaintext',
                code: 'some code here',
                dataCode: 'some code here'
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```\nsome code here\n```');
            assert.ok(!result.includes('plaintext'), 'Should not include plaintext');
        });

        test('should preserve explicit language specifiers', () => {
            const mockDom: MockCodeBlockDOM = {
                language: 'javascript',
                code: 'const x = 1;',
                dataCode: 'const x = 1;'
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```javascript\nconst x = 1;\n```');
        });

        test('should preserve typescript language', () => {
            const mockDom: MockCodeBlockDOM = {
                language: 'typescript',
                code: 'const x: number = 1;',
                dataCode: 'const x: number = 1;'
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```typescript\nconst x: number = 1;\n```');
        });

        test('should preserve python language', () => {
            const mockDom: MockCodeBlockDOM = {
                language: 'python',
                code: 'def hello():\n    print("Hello")',
                dataCode: 'def hello():\n    print("Hello")'
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```python\ndef hello():\n    print("Hello")\n```');
        });

        test('should handle empty code blocks without language', () => {
            const mockDom: MockCodeBlockDOM = {
                language: 'plaintext',
                code: '',
                dataCode: ''
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```\n\n```');
            assert.ok(!result.includes('plaintext'), 'Should not include plaintext');
        });

        test('should handle multi-line code without language', () => {
            const mockDom: MockCodeBlockDOM = {
                language: 'plaintext',
                code: 'line 1\nline 2\nline 3',
                dataCode: 'line 1\nline 2\nline 3'
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```\nline 1\nline 2\nline 3\n```');
            assert.ok(!result.includes('plaintext'), 'Should not include plaintext');
        });

        test('should preserve mermaid language', () => {
            const mockDom: MockCodeBlockDOM = {
                language: 'mermaid',
                code: 'graph TD\nA-->B',
                dataCode: 'graph TD\nA-->B'
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```mermaid\ngraph TD\nA-->B\n```');
        });

        test('should preserve short language identifiers like js', () => {
            const mockDom: MockCodeBlockDOM = {
                language: 'js',
                code: 'let x = 1;',
                dataCode: 'let x = 1;'
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```js\nlet x = 1;\n```');
        });

        test('should preserve text language if explicitly set', () => {
            // If someone explicitly uses ```text, we should preserve it
            // (though our parser would convert it to text, not plaintext)
            const mockDom: MockCodeBlockDOM = {
                language: 'text',
                code: 'some plain text',
                dataCode: 'some plain text'
            };

            const result = extractCodeBlockText(mockDom);
            assert.strictEqual(result, '```text\nsome plain text\n```');
        });

        suite('Pre element fallback extraction', () => {
            /**
             * Tests for the fallback logic when extracting from pre elements
             * that don't have the code-block container structure
             */

            function extractPreElementText(language: string, code: string): string {
                // Mirrors the pre element extraction logic in dom-handlers.ts
                // Don't include 'plaintext' in the code fence
                const fenceLanguage = (language === 'plaintext' || language === '') ? '' : language;
                return '```' + fenceLanguage + '\n' + code + '\n```';
            }

            test('should not add plaintext for pre elements without language', () => {
                const result = extractPreElementText('plaintext', 'code here');
                assert.strictEqual(result, '```\ncode here\n```');
                assert.ok(!result.includes('plaintext'));
            });

            test('should preserve language for pre elements with language', () => {
                const result = extractPreElementText('ruby', 'puts "hello"');
                assert.strictEqual(result, '```ruby\nputs "hello"\n```');
            });

            test('should handle empty language string', () => {
                const result = extractPreElementText('', 'code');
                assert.strictEqual(result, '```\ncode\n```');
            });
        });
    });

    suite('Code Block Rendering with Collapse/Expand', () => {
        // These tests cover the renderCodeBlock output for collapse functionality

        interface CodeBlock {
            language: string;
            startLine: number;
            endLine: number;
            code: string;
            id: string;
            isMermaid: boolean;
        }

        /**
         * Simple HTML escape function for testing
         */
        function escapeHtml(text: string): string {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        /**
         * Render code block HTML - mirrors the structure from code-block-handlers.ts
         */
        function renderCodeBlock(block: CodeBlock): string {
            const codeLines = block.code.split('\n');
            const lineCount = codeLines.length;

            const linesHtml = codeLines.map((line, i) => {
                const actualLine = block.startLine + 1 + i;
                const lineContent = escapeHtml(line) || '&nbsp;';
                return '<span class="code-line" data-line="' + actualLine + '">' + lineContent + '</span>';
            }).join('');

            return '<div class="code-block" data-start-line="' + block.startLine +
                '" data-end-line="' + block.endLine + '" data-block-id="' + block.id + '">' +
                '<div class="code-block-header">' +
                '<div class="code-block-header-left">' +
                '<button class="code-action-btn code-collapse-btn" title="Collapse code block">▼</button>' +
                '<span class="code-language">' + escapeHtml(block.language) + '</span>' +
                '<span class="code-line-count">(' + lineCount + ' line' + (lineCount !== 1 ? 's' : '') + ')</span>' +
                '</div>' +
                '<div class="code-block-actions">' +
                '<button class="code-action-btn code-copy-btn" title="Copy code" data-code="' +
                encodeURIComponent(block.code) + '">📋 Copy</button>' +
                '<button class="code-action-btn code-comment-btn" title="Add comment to code block">💬</button>' +
                '</div>' +
                '</div>' +
                '<pre class="code-block-content"><code class="hljs language-' + block.language + '">' +
                linesHtml + '</code></pre>' +
                '</div>';
        }

        test('should include collapse button in rendered HTML', () => {
            const block: CodeBlock = {
                language: 'javascript',
                startLine: 1,
                endLine: 3,
                code: 'const x = 1;',
                id: 'codeblock-1',
                isMermaid: false
            };
            const html = renderCodeBlock(block);
            assert.ok(html.includes('code-collapse-btn'), 'Should include collapse button class');
            assert.ok(html.includes('title="Collapse code block"'), 'Should include collapse button title');
            assert.ok(html.includes('▼'), 'Should include collapse arrow');
        });

        test('should include line count in rendered HTML', () => {
            const block: CodeBlock = {
                language: 'javascript',
                startLine: 1,
                endLine: 5,
                code: 'line1\nline2\nline3',
                id: 'codeblock-1',
                isMermaid: false
            };
            const html = renderCodeBlock(block);
            assert.ok(html.includes('code-line-count'), 'Should include line count class');
            assert.ok(html.includes('(3 lines)'), 'Should show correct line count (plural)');
        });

        test('should use singular "line" for single line code', () => {
            const block: CodeBlock = {
                language: 'javascript',
                startLine: 1,
                endLine: 3,
                code: 'const x = 1;',
                id: 'codeblock-1',
                isMermaid: false
            };
            const html = renderCodeBlock(block);
            assert.ok(html.includes('(1 line)'), 'Should show singular line count');
            assert.ok(!html.includes('(1 lines)'), 'Should not show plural for single line');
        });

        test('should include header-left container for collapse button and language', () => {
            const block: CodeBlock = {
                language: 'python',
                startLine: 1,
                endLine: 3,
                code: 'print("hello")',
                id: 'codeblock-1',
                isMermaid: false
            };
            const html = renderCodeBlock(block);
            assert.ok(html.includes('code-block-header-left'), 'Should include header-left container');
        });

        test('should still include copy and comment buttons', () => {
            const block: CodeBlock = {
                language: 'javascript',
                startLine: 1,
                endLine: 3,
                code: 'const x = 1;',
                id: 'codeblock-1',
                isMermaid: false
            };
            const html = renderCodeBlock(block);
            assert.ok(html.includes('code-copy-btn'), 'Should include copy button');
            assert.ok(html.includes('code-comment-btn'), 'Should include comment button');
        });
    });

    suite('Mermaid Container Rendering with Collapse/Expand', () => {
        // These tests cover the renderMermaidContainer output for collapse functionality

        interface CodeBlock {
            language: string;
            startLine: number;
            endLine: number;
            code: string;
            id: string;
            isMermaid: boolean;
        }

        /**
         * Simple HTML escape function for testing
         */
        function escapeHtml(text: string): string {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        /**
         * Render mermaid container HTML - mirrors the structure from mermaid-handlers.ts
         */
        function renderMermaidContainer(block: CodeBlock): string {
            const lineCount = block.code.split('\n').length;

            return '<div class="mermaid-container" data-start-line="' + block.startLine +
                '" data-end-line="' + block.endLine + '" data-mermaid-id="' + block.id + '">' +
                '<div class="mermaid-header">' +
                '<div class="mermaid-header-left">' +
                '<button class="mermaid-action-btn mermaid-collapse-btn" title="Collapse diagram">▼</button>' +
                '<span class="mermaid-label">Mermaid Diagram</span>' +
                '<span class="mermaid-line-count">(' + lineCount + ' line' + (lineCount !== 1 ? 's' : '') + ')</span>' +
                '</div>' +
                '<div class="mermaid-zoom-controls">' +
                '<button class="mermaid-zoom-btn mermaid-zoom-out" title="Zoom out (−)">−</button>' +
                '<span class="mermaid-zoom-level">100%</span>' +
                '<button class="mermaid-zoom-btn mermaid-zoom-in" title="Zoom in (+)">+</button>' +
                '<button class="mermaid-zoom-btn mermaid-zoom-reset" title="Reset view">⟲</button>' +
                '</div>' +
                '<div class="mermaid-actions">' +
                '<button class="mermaid-action-btn mermaid-toggle-btn" title="Toggle source/preview">🔄 Toggle</button>' +
                '<button class="mermaid-action-btn mermaid-comment-btn" title="Add comment to diagram">💬</button>' +
                '</div>' +
                '</div>' +
                '<div class="mermaid-content">' +
                '<div class="mermaid-preview mermaid-loading">Loading diagram...</div>' +
                '<div class="mermaid-source" style="display: none;"><code>' + escapeHtml(block.code) + '</code></div>' +
                '</div>' +
                '</div>';
        }

        test('should include collapse button in rendered HTML', () => {
            const block: CodeBlock = {
                language: 'mermaid',
                startLine: 1,
                endLine: 5,
                code: 'graph TD\nA-->B\nB-->C',
                id: 'codeblock-1',
                isMermaid: true
            };
            const html = renderMermaidContainer(block);
            assert.ok(html.includes('mermaid-collapse-btn'), 'Should include collapse button class');
            assert.ok(html.includes('title="Collapse diagram"'), 'Should include collapse button title');
            assert.ok(html.includes('▼'), 'Should include collapse arrow');
        });

        test('should include line count in rendered HTML', () => {
            const block: CodeBlock = {
                language: 'mermaid',
                startLine: 1,
                endLine: 5,
                code: 'graph TD\nA-->B\nB-->C',
                id: 'codeblock-1',
                isMermaid: true
            };
            const html = renderMermaidContainer(block);
            assert.ok(html.includes('mermaid-line-count'), 'Should include line count class');
            assert.ok(html.includes('(3 lines)'), 'Should show correct line count (plural)');
        });

        test('should use singular "line" for single line mermaid code', () => {
            const block: CodeBlock = {
                language: 'mermaid',
                startLine: 1,
                endLine: 3,
                code: 'graph TD',
                id: 'codeblock-1',
                isMermaid: true
            };
            const html = renderMermaidContainer(block);
            assert.ok(html.includes('(1 line)'), 'Should show singular line count');
            assert.ok(!html.includes('(1 lines)'), 'Should not show plural for single line');
        });

        test('should include header-left container for collapse button and label', () => {
            const block: CodeBlock = {
                language: 'mermaid',
                startLine: 1,
                endLine: 5,
                code: 'graph TD\nA-->B',
                id: 'codeblock-1',
                isMermaid: true
            };
            const html = renderMermaidContainer(block);
            assert.ok(html.includes('mermaid-header-left'), 'Should include header-left container');
        });

        test('should include mermaid-content wrapper for collapsible content', () => {
            const block: CodeBlock = {
                language: 'mermaid',
                startLine: 1,
                endLine: 5,
                code: 'graph TD\nA-->B',
                id: 'codeblock-1',
                isMermaid: true
            };
            const html = renderMermaidContainer(block);
            assert.ok(html.includes('mermaid-content'), 'Should include content wrapper for collapse');
        });

        test('should still include zoom controls and action buttons', () => {
            const block: CodeBlock = {
                language: 'mermaid',
                startLine: 1,
                endLine: 5,
                code: 'graph TD\nA-->B',
                id: 'codeblock-1',
                isMermaid: true
            };
            const html = renderMermaidContainer(block);
            assert.ok(html.includes('mermaid-zoom-controls'), 'Should include zoom controls');
            assert.ok(html.includes('mermaid-toggle-btn'), 'Should include toggle button');
            assert.ok(html.includes('mermaid-comment-btn'), 'Should include comment button');
        });

        test('should display "Mermaid Diagram" label without emoji', () => {
            const block: CodeBlock = {
                language: 'mermaid',
                startLine: 1,
                endLine: 5,
                code: 'graph TD\nA-->B',
                id: 'codeblock-1',
                isMermaid: true
            };
            const html = renderMermaidContainer(block);
            assert.ok(html.includes('Mermaid Diagram'), 'Should include Mermaid Diagram label');
        });
    });

    suite('Mermaid Edge Selector and Metadata Extraction', () => {
        /**
         * Edge selector mapping for different diagram types
         * Mirrors EDGE_SELECTORS_BY_DIAGRAM_TYPE from mermaid-handlers.ts
         */
        const EDGE_SELECTORS_BY_DIAGRAM_TYPE: Record<string, string[]> = {
            flowchart: ['.edge', '.flowchart-link', 'path.edge-pattern'],
            sequence: ['.messageLine0', '.messageLine1', '.loopLine'],
            state: ['.transition'],
            er: ['.er.relationshipLine'],
            class: ['.relation'],
            default: ['.edge', 'path[class*="link"]', 'path[class*="edge"]']
        };

        /**
         * Get edge selectors for a diagram type
         */
        function getEdgeSelectorsForDiagram(diagramType: string): string[] {
            const normalizedType = diagramType?.toLowerCase() || 'default';
            return EDGE_SELECTORS_BY_DIAGRAM_TYPE[normalizedType] ||
                   EDGE_SELECTORS_BY_DIAGRAM_TYPE.default;
        }

        /**
         * Edge metadata interface
         */
        interface EdgeMetadata {
            edgeId: string;
            edgeLabel: string;
            sourceNode?: string;
            targetNode?: string;
        }

        /**
         * Extract edge metadata from class names (simplified version for testing)
         */
        function extractEdgeMetadataFromClassName(
            className: string,
            edgeId: string,
            labelText?: string
        ): EdgeMetadata {
            let sourceNode: string | undefined;
            let targetNode: string | undefined;
            let edgeLabel = labelText || '';

            // Match patterns like "L-A-B" or "LS-A-B" or "LE-A-B"
            const classMatch = className.match(/L[ES]?-(\w+)-(\w+)/);
            if (classMatch) {
                sourceNode = classMatch[1];
                targetNode = classMatch[2];
            }

            // Generate friendly label if none found
            if (!edgeLabel) {
                if (sourceNode && targetNode) {
                    edgeLabel = sourceNode + ' → ' + targetNode;
                } else {
                    edgeLabel = 'Edge';
                }
            }

            return {
                edgeId,
                edgeLabel,
                sourceNode,
                targetNode
            };
        }

        suite('getEdgeSelectorsForDiagram', () => {
            test('should return flowchart selectors for flowchart type', () => {
                const selectors = getEdgeSelectorsForDiagram('flowchart');
                assert.ok(selectors.includes('.edge'));
                assert.ok(selectors.includes('.flowchart-link'));
            });

            test('should return sequence diagram selectors', () => {
                const selectors = getEdgeSelectorsForDiagram('sequence');
                assert.ok(selectors.includes('.messageLine0'));
                assert.ok(selectors.includes('.messageLine1'));
            });

            test('should return state diagram selectors', () => {
                const selectors = getEdgeSelectorsForDiagram('state');
                assert.ok(selectors.includes('.transition'));
            });

            test('should return ER diagram selectors', () => {
                const selectors = getEdgeSelectorsForDiagram('er');
                assert.ok(selectors.includes('.er.relationshipLine'));
            });

            test('should return class diagram selectors', () => {
                const selectors = getEdgeSelectorsForDiagram('class');
                assert.ok(selectors.includes('.relation'));
            });

            test('should return default selectors for unknown diagram type', () => {
                const selectors = getEdgeSelectorsForDiagram('unknown');
                assert.deepStrictEqual(selectors, EDGE_SELECTORS_BY_DIAGRAM_TYPE.default);
            });

            test('should handle case-insensitive diagram types', () => {
                const selectors1 = getEdgeSelectorsForDiagram('FLOWCHART');
                const selectors2 = getEdgeSelectorsForDiagram('flowchart');
                assert.deepStrictEqual(selectors1, selectors2);
            });

            test('should return default selectors for empty string', () => {
                const selectors = getEdgeSelectorsForDiagram('');
                assert.deepStrictEqual(selectors, EDGE_SELECTORS_BY_DIAGRAM_TYPE.default);
            });

            test('should return default selectors for null/undefined', () => {
                const selectors = getEdgeSelectorsForDiagram(null as unknown as string);
                assert.deepStrictEqual(selectors, EDGE_SELECTORS_BY_DIAGRAM_TYPE.default);
            });
        });

        suite('extractEdgeMetadataFromClassName', () => {
            test('should extract source and target from L-A-B pattern', () => {
                const metadata = extractEdgeMetadataFromClassName('flowchart-link L-nodeA-nodeB', 'edge-1');
                assert.strictEqual(metadata.sourceNode, 'nodeA');
                assert.strictEqual(metadata.targetNode, 'nodeB');
                assert.strictEqual(metadata.edgeLabel, 'nodeA → nodeB');
            });

            test('should extract source and target from LS-A-B pattern', () => {
                const metadata = extractEdgeMetadataFromClassName('edge LS-start-end', 'edge-2');
                assert.strictEqual(metadata.sourceNode, 'start');
                assert.strictEqual(metadata.targetNode, 'end');
            });

            test('should extract source and target from LE-A-B pattern', () => {
                const metadata = extractEdgeMetadataFromClassName('edge LE-process-decision', 'edge-3');
                assert.strictEqual(metadata.sourceNode, 'process');
                assert.strictEqual(metadata.targetNode, 'decision');
            });

            test('should use provided label text over generated label', () => {
                const metadata = extractEdgeMetadataFromClassName('L-A-B', 'edge-4', 'Yes');
                assert.strictEqual(metadata.edgeLabel, 'Yes');
                assert.strictEqual(metadata.sourceNode, 'A');
                assert.strictEqual(metadata.targetNode, 'B');
            });

            test('should generate "Edge" label when no pattern matches', () => {
                const metadata = extractEdgeMetadataFromClassName('some-random-class', 'edge-5');
                assert.strictEqual(metadata.edgeLabel, 'Edge');
                assert.strictEqual(metadata.sourceNode, undefined);
                assert.strictEqual(metadata.targetNode, undefined);
            });

            test('should preserve edgeId', () => {
                const metadata = extractEdgeMetadataFromClassName('L-X-Y', 'my-custom-edge-id');
                assert.strictEqual(metadata.edgeId, 'my-custom-edge-id');
            });

            test('should handle empty class name', () => {
                const metadata = extractEdgeMetadataFromClassName('', 'edge-6');
                assert.strictEqual(metadata.edgeLabel, 'Edge');
                assert.strictEqual(metadata.edgeId, 'edge-6');
            });

            test('should handle class names with multiple patterns', () => {
                // Only the first match should be used
                const metadata = extractEdgeMetadataFromClassName('L-first-second L-third-fourth', 'edge-7');
                assert.strictEqual(metadata.sourceNode, 'first');
                assert.strictEqual(metadata.targetNode, 'second');
            });
        });

        suite('Edge Comment Integration', () => {
            test('should create valid edge metadata structure', () => {
                const metadata = extractEdgeMetadataFromClassName('flowchart-link L-A-B', 'edge-1', 'connects');

                // Simulate creating mermaidContext for edge comment
                const mermaidContext = {
                    diagramId: 'mermaid-1',
                    edgeId: metadata.edgeId,
                    edgeLabel: metadata.edgeLabel,
                    edgeSourceNode: metadata.sourceNode,
                    edgeTargetNode: metadata.targetNode,
                    diagramType: 'flowchart',
                    elementType: 'edge' as const
                };

                assert.strictEqual(mermaidContext.elementType, 'edge');
                assert.strictEqual(mermaidContext.edgeId, 'edge-1');
                assert.strictEqual(mermaidContext.edgeLabel, 'connects');
                assert.strictEqual(mermaidContext.edgeSourceNode, 'A');
                assert.strictEqual(mermaidContext.edgeTargetNode, 'B');
            });

            test('should generate selected text for edge comment', () => {
                const metadata = extractEdgeMetadataFromClassName('L-start-end', 'edge-2');
                const selectedText = '[Mermaid Edge: ' + metadata.edgeLabel + ']';

                assert.strictEqual(selectedText, '[Mermaid Edge: start → end]');
            });

            test('should handle edge without source/target nodes', () => {
                const metadata = extractEdgeMetadataFromClassName('generic-edge', 'edge-3');
                const selectedText = '[Mermaid Edge: ' + metadata.edgeLabel + ']';

                assert.strictEqual(selectedText, '[Mermaid Edge: Edge]');
            });
        });
    });

    suite('Comment Bubble Dimensions Calculation', () => {
        // Test the calculateBubbleDimensions logic - mirrors panel-manager.ts implementation

        interface MockComment {
            comment: string;
            selectedText: string;
        }

        /**
         * Pure function implementation for testing - mirrors calculateBubbleDimensions
         */
        function calculateBubbleDimensions(comment: MockComment): { width: number; height: number } {
            const minWidth = 280;
            const maxWidth = 600;
            const minHeight = 120;
            const maxHeight = 500;
            
            // Estimate content length
            const commentLength = comment.comment.length;
            const selectedTextLength = comment.selectedText.length;
            const totalLength = commentLength + selectedTextLength;
            
            // Check for code blocks or long lines which need more width
            const hasCodeBlocks = comment.comment.includes('```');
            const hasLongLines = comment.comment.split('\n').some(line => line.length > 60);
            const lines = comment.comment.split('\n').length;
            
            // Calculate width based on content characteristics
            let width: number;
            if (hasCodeBlocks || hasLongLines) {
                // Code blocks and long lines need more width
                width = Math.min(maxWidth, Math.max(450, minWidth));
            } else if (totalLength < 100) {
                // Short comments can be narrower
                width = minWidth;
            } else if (totalLength < 300) {
                // Medium comments
                width = Math.min(380, minWidth + (totalLength - 100) * 0.5);
            } else {
                // Longer comments get wider
                width = Math.min(maxWidth, 380 + (totalLength - 300) * 0.3);
            }
            
            // Calculate height based on content
            // Approximate: ~50px for header, ~80px for selected text, rest for comment
            const baseHeight = 130; // header + selected text area + padding
            const lineHeight = 20; // approximate line height for comment text
            const estimatedCommentLines = Math.max(lines, Math.ceil(commentLength / (width / 8)));
            let height = baseHeight + (estimatedCommentLines * lineHeight);
            
            // Clamp height
            height = Math.max(minHeight, Math.min(maxHeight, height));
            
            return { width, height };
        }

        test('should return minimum width for short comments', () => {
            const comment: MockComment = {
                comment: 'Short note',
                selectedText: 'text'
            };
            const { width } = calculateBubbleDimensions(comment);
            assert.strictEqual(width, 280);
        });

        test('should return minimum dimensions for very short comments', () => {
            const comment: MockComment = {
                comment: 'OK',
                selectedText: 'x'
            };
            const { width, height } = calculateBubbleDimensions(comment);
            assert.strictEqual(width, 280);
            assert.ok(height >= 120, 'Height should be at least minimum');
        });

        test('should increase width for medium-length comments', () => {
            // Use multi-line comment to avoid triggering long-line detection (>60 chars)
            const comment: MockComment = {
                comment: 'This is a medium length comment.\nIt provides context about the text.\nIt explains the reasoning behind it.',
                selectedText: 'some selected text'
            };
            const { width } = calculateBubbleDimensions(comment);
            assert.ok(width > 280, 'Width should be greater than minimum for medium comments');
            assert.ok(width <= 380, 'Width should not exceed 380 for medium comments');
        });

        test('should increase width for long comments', () => {
            const comment: MockComment = {
                comment: 'This is a very long comment that goes into great detail about the selected text. It provides extensive context and explanation about why this particular piece of content is important. The comment continues to elaborate on various aspects and considerations that should be taken into account when reviewing this section of the document.',
                selectedText: 'important section'
            };
            const { width } = calculateBubbleDimensions(comment);
            assert.ok(width > 380, 'Width should be greater than 380 for long comments');
            assert.ok(width <= 600, 'Width should not exceed maximum');
        });

        test('should use wider width for comments with code blocks', () => {
            const comment: MockComment = {
                comment: '```javascript\nconst x = 1;\n```',
                selectedText: 'code'
            };
            const { width } = calculateBubbleDimensions(comment);
            assert.ok(width >= 450, 'Width should be at least 450 for code blocks');
        });

        test('should use wider width for comments with long lines', () => {
            const comment: MockComment = {
                comment: 'This is a single line that is quite long and exceeds sixty characters in total length to trigger wider width.',
                selectedText: 'text'
            };
            const { width } = calculateBubbleDimensions(comment);
            assert.ok(width >= 450, 'Width should be at least 450 for long lines');
        });

        test('should increase height for multi-line comments', () => {
            const singleLine: MockComment = {
                comment: 'Single line',
                selectedText: 'text'
            };
            const multiLine: MockComment = {
                comment: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5',
                selectedText: 'text'
            };
            const singleDims = calculateBubbleDimensions(singleLine);
            const multiDims = calculateBubbleDimensions(multiLine);
            assert.ok(multiDims.height > singleDims.height, 'Multi-line should have greater height');
        });

        test('should cap height at maximum', () => {
            const veryLongComment: MockComment = {
                comment: Array(100).fill('This is a very long line of text.').join('\n'),
                selectedText: 'text'
            };
            const { height } = calculateBubbleDimensions(veryLongComment);
            assert.strictEqual(height, 500, 'Height should be capped at maximum');
        });

        test('should cap width at maximum', () => {
            // Use many short lines to get very long total without triggering long-line detection
            const veryLongComment: MockComment = {
                comment: Array(200).fill('Short text here.').join('\n'),
                selectedText: 'text'
            };
            const { width } = calculateBubbleDimensions(veryLongComment);
            assert.strictEqual(width, 600, 'Width should be capped at maximum');
        });

        test('should handle empty comment', () => {
            const comment: MockComment = {
                comment: '',
                selectedText: 'text'
            };
            const { width, height } = calculateBubbleDimensions(comment);
            assert.strictEqual(width, 280, 'Empty comment should use minimum width');
            assert.ok(height >= 120, 'Empty comment should use at least minimum height');
        });

        test('should consider selected text length in total', () => {
            const shortSelected: MockComment = {
                comment: 'Comment',
                selectedText: 'x'
            };
            const longSelected: MockComment = {
                comment: 'Comment',
                selectedText: 'This is a much longer piece of selected text that adds to the total length consideration'
            };
            const shortDims = calculateBubbleDimensions(shortSelected);
            const longDims = calculateBubbleDimensions(longSelected);
            // Both should be minimum since total is still under 100
            // But with long selected text pushing over 100, width may increase
            assert.ok(longDims.width >= shortDims.width, 'Longer selected text should not reduce width');
        });

        test('should handle markdown formatting in comments', () => {
            const comment: MockComment = {
                comment: '**Bold** and *italic* text with `inline code`',
                selectedText: 'formatted'
            };
            const { width, height } = calculateBubbleDimensions(comment);
            assert.ok(width >= 280, 'Should handle markdown formatting');
            assert.ok(height >= 120, 'Should have valid height');
        });

        test('should handle bullet lists', () => {
            const comment: MockComment = {
                comment: '- Item 1\n- Item 2\n- Item 3\n- Item 4',
                selectedText: 'list'
            };
            const { width, height } = calculateBubbleDimensions(comment);
            assert.strictEqual(width, 280, 'Short bullet lists should use minimum width');
            assert.ok(height > 120, 'Bullet lists should increase height');
        });
    });

    suite('Tab/Shift+Tab Indentation Logic', () => {
        /**
         * Pure function implementation for testing - mirrors the indentation logic
         */
        function applyIndent(lines: string[], startLineIdx: number, endLineIdx: number, isOutdent: boolean): {
            modifiedLines: string[];
            firstLineIndentChange: number;
            lastLineIndentChange: number;
        } {
            const INDENT = '    '; // 4 spaces
            const modifiedLines = [...lines];
            let firstLineIndentChange = 0;
            let lastLineIndentChange = 0;

            for (let i = startLineIdx; i <= endLineIdx; i++) {
                if (i < 0 || i >= modifiedLines.length) continue;

                const line = modifiedLines[i];
                if (isOutdent) {
                    let removed = 0;
                    if (line.startsWith('\t')) {
                        modifiedLines[i] = line.substring(1);
                        removed = 1;
                    } else {
                        let spacesToRemove = 0;
                        for (let j = 0; j < 4 && j < line.length; j++) {
                            if (line[j] === ' ') {
                                spacesToRemove++;
                            } else {
                                break;
                            }
                        }
                        if (spacesToRemove > 0) {
                            modifiedLines[i] = line.substring(spacesToRemove);
                            removed = spacesToRemove;
                        }
                    }
                    // Use (removed || 0) to avoid -0 vs 0 issues in strict equality
                    if (i === startLineIdx) firstLineIndentChange = removed > 0 ? -removed : 0;
                    if (i === endLineIdx) lastLineIndentChange = removed > 0 ? -removed : 0;
                } else {
                    modifiedLines[i] = INDENT + line;
                    if (i === startLineIdx) firstLineIndentChange = 4;
                    if (i === endLineIdx) lastLineIndentChange = 4;
                }
            }

            return { modifiedLines, firstLineIndentChange, lastLineIndentChange };
        }

        test('should indent single line with 4 spaces', () => {
            const lines = ['Hello World'];
            const result = applyIndent(lines, 0, 0, false);
            assert.strictEqual(result.modifiedLines[0], '    Hello World');
            assert.strictEqual(result.firstLineIndentChange, 4);
            assert.strictEqual(result.lastLineIndentChange, 4);
        });

        test('should indent multiple lines with 4 spaces each', () => {
            const lines = ['Line 1', 'Line 2', 'Line 3'];
            const result = applyIndent(lines, 0, 2, false);
            assert.strictEqual(result.modifiedLines[0], '    Line 1');
            assert.strictEqual(result.modifiedLines[1], '    Line 2');
            assert.strictEqual(result.modifiedLines[2], '    Line 3');
        });

        test('should indent only selected lines', () => {
            const lines = ['Line 1', 'Line 2', 'Line 3', 'Line 4'];
            const result = applyIndent(lines, 1, 2, false);
            assert.strictEqual(result.modifiedLines[0], 'Line 1');
            assert.strictEqual(result.modifiedLines[1], '    Line 2');
            assert.strictEqual(result.modifiedLines[2], '    Line 3');
            assert.strictEqual(result.modifiedLines[3], 'Line 4');
        });

        test('should outdent single line by removing up to 4 spaces', () => {
            const lines = ['    Hello World'];
            const result = applyIndent(lines, 0, 0, true);
            assert.strictEqual(result.modifiedLines[0], 'Hello World');
            assert.strictEqual(result.firstLineIndentChange, -4);
        });

        test('should outdent line with less than 4 spaces', () => {
            const lines = ['  Hello World'];
            const result = applyIndent(lines, 0, 0, true);
            assert.strictEqual(result.modifiedLines[0], 'Hello World');
            assert.strictEqual(result.firstLineIndentChange, -2);
        });

        test('should outdent line with tab character', () => {
            const lines = ['\tHello World'];
            const result = applyIndent(lines, 0, 0, true);
            assert.strictEqual(result.modifiedLines[0], 'Hello World');
            assert.strictEqual(result.firstLineIndentChange, -1);
        });

        test('should outdent multiple lines', () => {
            const lines = ['    Line 1', '    Line 2', '    Line 3'];
            const result = applyIndent(lines, 0, 2, true);
            assert.strictEqual(result.modifiedLines[0], 'Line 1');
            assert.strictEqual(result.modifiedLines[1], 'Line 2');
            assert.strictEqual(result.modifiedLines[2], 'Line 3');
        });

        test('should handle outdent on line with no leading whitespace', () => {
            const lines = ['Hello World'];
            const result = applyIndent(lines, 0, 0, true);
            assert.strictEqual(result.modifiedLines[0], 'Hello World');
            assert.strictEqual(result.firstLineIndentChange, 0);
        });

        test('should handle mixed indentation in multi-line outdent', () => {
            const lines = ['    Line 1', '  Line 2', '\tLine 3', 'Line 4'];
            const result = applyIndent(lines, 0, 3, true);
            assert.strictEqual(result.modifiedLines[0], 'Line 1');
            assert.strictEqual(result.modifiedLines[1], 'Line 2');
            assert.strictEqual(result.modifiedLines[2], 'Line 3');
            assert.strictEqual(result.modifiedLines[3], 'Line 4');
        });

        test('should preserve content after leading whitespace on outdent', () => {
            const lines = ['    Hello    World'];
            const result = applyIndent(lines, 0, 0, true);
            assert.strictEqual(result.modifiedLines[0], 'Hello    World');
        });

        test('should handle empty lines', () => {
            const lines = ['Line 1', '', 'Line 3'];
            const result = applyIndent(lines, 0, 2, false);
            assert.strictEqual(result.modifiedLines[0], '    Line 1');
            assert.strictEqual(result.modifiedLines[1], '    ');
            assert.strictEqual(result.modifiedLines[2], '    Line 3');
        });

        test('should handle outdent on empty lines', () => {
            const lines = ['    Line 1', '    ', '    Line 3'];
            const result = applyIndent(lines, 0, 2, true);
            assert.strictEqual(result.modifiedLines[0], 'Line 1');
            assert.strictEqual(result.modifiedLines[1], '');
            assert.strictEqual(result.modifiedLines[2], 'Line 3');
        });

        test('should track indent changes for first and last lines correctly', () => {
            const lines = ['    Line 1', '  Line 2', 'Line 3'];
            const result = applyIndent(lines, 0, 2, true);
            assert.strictEqual(result.firstLineIndentChange, -4);
            assert.strictEqual(result.lastLineIndentChange, 0);
        });

        test('should handle indent on already indented lines', () => {
            const lines = ['    Already indented'];
            const result = applyIndent(lines, 0, 0, false);
            assert.strictEqual(result.modifiedLines[0], '        Already indented');
        });

        test('should handle out of bounds line indices gracefully', () => {
            const lines = ['Line 1', 'Line 2'];
            const result = applyIndent(lines, -1, 5, false);
            // Should only indent lines 0 and 1
            assert.strictEqual(result.modifiedLines[0], '    Line 1');
            assert.strictEqual(result.modifiedLines[1], '    Line 2');
        });
    });

    suite('Cursor Position After Save Tests', () => {
        /**
         * Tests for cursor position preservation logic
         * These test the pure functions used in cursor restoration
         */
        
        interface SelectionInfo {
            startLine: number;
            startColumn: number;
            endLine: number;
            endColumn: number;
        }

        /**
         * Calculate new cursor position after indent operation
         */
        function calculateCursorAfterIndent(
            selection: SelectionInfo,
            firstLineIndentChange: number,
            lastLineIndentChange: number
        ): SelectionInfo {
            return {
                startLine: selection.startLine,
                startColumn: Math.max(0, selection.startColumn + firstLineIndentChange),
                endLine: selection.endLine,
                endColumn: Math.max(0, selection.endColumn + lastLineIndentChange)
            };
        }

        test('should adjust cursor position after single line indent', () => {
            const selection: SelectionInfo = {
                startLine: 1,
                startColumn: 5,
                endLine: 1,
                endColumn: 10
            };
            const result = calculateCursorAfterIndent(selection, 4, 4);
            assert.strictEqual(result.startColumn, 9);
            assert.strictEqual(result.endColumn, 14);
        });

        test('should adjust cursor position after single line outdent', () => {
            const selection: SelectionInfo = {
                startLine: 1,
                startColumn: 8,
                endLine: 1,
                endColumn: 12
            };
            const result = calculateCursorAfterIndent(selection, -4, -4);
            assert.strictEqual(result.startColumn, 4);
            assert.strictEqual(result.endColumn, 8);
        });

        test('should not allow negative column after outdent', () => {
            const selection: SelectionInfo = {
                startLine: 1,
                startColumn: 2,
                endLine: 1,
                endColumn: 5
            };
            const result = calculateCursorAfterIndent(selection, -4, -4);
            assert.strictEqual(result.startColumn, 0);
            assert.strictEqual(result.endColumn, 1);
        });

        test('should handle multi-line selection with different indent changes', () => {
            const selection: SelectionInfo = {
                startLine: 1,
                startColumn: 5,
                endLine: 3,
                endColumn: 8
            };
            const result = calculateCursorAfterIndent(selection, -4, -2);
            assert.strictEqual(result.startColumn, 1);
            assert.strictEqual(result.endColumn, 6);
        });

        test('should preserve line numbers after indent', () => {
            const selection: SelectionInfo = {
                startLine: 5,
                startColumn: 3,
                endLine: 8,
                endColumn: 10
            };
            const result = calculateCursorAfterIndent(selection, 4, 4);
            assert.strictEqual(result.startLine, 5);
            assert.strictEqual(result.endLine, 8);
        });
    });
});

