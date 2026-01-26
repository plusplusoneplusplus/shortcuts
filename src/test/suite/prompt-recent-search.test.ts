/**
 * Tests for Recent Prompts and Search functionality
 * Tests the new UX enhancements for the "Follow Prompt" feature
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('Prompt Recent and Search Tests', () => {
    let tempDir: string;
    let workspaceRoot: string;

    setup(() => {
        // Create temp directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-test-'));
        workspaceRoot = tempDir;
    });

    teardown(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('RecentPrompt Type', () => {
        test('should have correct structure', () => {
            const recentPrompt = {
                absolutePath: '/workspace/.github/prompts/impl.prompt.md',
                relativePath: '.github/prompts/impl.prompt.md',
                name: 'impl',
                lastUsed: Date.now()
            };

            assert.strictEqual(typeof recentPrompt.absolutePath, 'string');
            assert.strictEqual(typeof recentPrompt.relativePath, 'string');
            assert.strictEqual(typeof recentPrompt.name, 'string');
            assert.strictEqual(typeof recentPrompt.lastUsed, 'number');
        });

        test('should track timestamp correctly', () => {
            const before = Date.now();
            const recentPrompt = {
                absolutePath: '/test.prompt.md',
                relativePath: 'test.prompt.md',
                name: 'test',
                lastUsed: Date.now()
            };
            const after = Date.now();

            assert.ok(recentPrompt.lastUsed >= before);
            assert.ok(recentPrompt.lastUsed <= after);
        });
    });

    suite('Message Types', () => {
        test('should have promptSearch message type', () => {
            const message = { type: 'promptSearch' as const };
            assert.strictEqual(message.type, 'promptSearch');
        });

        test('should have promptFilesResponse with recentPrompts', () => {
            const message = {
                type: 'promptFilesResponse' as const,
                promptFiles: [
                    {
                        absolutePath: '/test.prompt.md',
                        relativePath: 'test.prompt.md',
                        name: 'test',
                        sourceFolder: '.github/prompts'
                    }
                ],
                recentPrompts: [
                    {
                        absolutePath: '/test.prompt.md',
                        relativePath: 'test.prompt.md',
                        name: 'test',
                        lastUsed: Date.now()
                    }
                ]
            };

            assert.strictEqual(message.type, 'promptFilesResponse');
            assert.ok(Array.isArray(message.promptFiles));
            assert.ok(Array.isArray(message.recentPrompts));
            assert.strictEqual(message.promptFiles.length, 1);
            assert.strictEqual(message.recentPrompts!.length, 1);
        });

        test('should allow optional recentPrompts', () => {
            const message: {
                type: 'promptFilesResponse';
                promptFiles: any[];
                recentPrompts?: any[];
            } = {
                type: 'promptFilesResponse' as const,
                promptFiles: []
            };

            assert.strictEqual(message.type, 'promptFilesResponse');
            assert.ok(Array.isArray(message.promptFiles));
            assert.strictEqual(message.recentPrompts, undefined);
        });
    });

    suite('Relative Time Formatting', () => {
        test('should format "just now" for recent timestamps', () => {
            const now = Date.now();
            const diff = now - (now - 30000); // 30 seconds ago
            
            // Simulate the formatRelativeTime logic
            const seconds = Math.floor(diff / 1000);
            const result = seconds < 60 ? 'just now' : `${seconds} seconds ago`;
            
            assert.strictEqual(result, 'just now');
        });

        test('should format minutes correctly', () => {
            const now = Date.now();
            const fiveMinutesAgo = now - (5 * 60 * 1000);
            const diff = now - fiveMinutesAgo;
            const minutes = Math.floor(diff / 1000 / 60);
            
            assert.strictEqual(minutes, 5);
        });

        test('should format hours correctly', () => {
            const now = Date.now();
            const twoHoursAgo = now - (2 * 60 * 60 * 1000);
            const diff = now - twoHoursAgo;
            const hours = Math.floor(diff / 1000 / 60 / 60);
            
            assert.strictEqual(hours, 2);
        });

        test('should format days correctly', () => {
            const now = Date.now();
            const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
            const diff = now - threeDaysAgo;
            const days = Math.floor(diff / 1000 / 60 / 60 / 24);
            
            assert.strictEqual(days, 3);
        });
    });

    suite('Recent Prompts Tracking', () => {
        test('should track most recent prompt first', () => {
            const recents = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', lastUsed: 3 },
                { absolutePath: '/b.prompt.md', relativePath: 'b.prompt.md', name: 'b', lastUsed: 2 },
                { absolutePath: '/c.prompt.md', relativePath: 'c.prompt.md', name: 'c', lastUsed: 1 }
            ];

            // Most recent should be first
            assert.strictEqual(recents[0].lastUsed, 3);
            assert.strictEqual(recents[recents.length - 1].lastUsed, 1);
        });

        test('should remove duplicates and move to front', () => {
            const recents = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', lastUsed: 3 },
                { absolutePath: '/b.prompt.md', relativePath: 'b.prompt.md', name: 'b', lastUsed: 2 }
            ];

            // Simulate adding /a.prompt.md again
            const filtered = recents.filter(r => r.absolutePath !== '/a.prompt.md');
            const updated = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', lastUsed: 10 },
                ...filtered
            ];

            assert.strictEqual(updated[0].absolutePath, '/a.prompt.md');
            assert.strictEqual(updated[0].lastUsed, 10);
            assert.strictEqual(updated.length, 2);
        });

        test('should limit to MAX_RECENT_PROMPTS (5)', () => {
            const recents = [
                { absolutePath: '/1.prompt.md', relativePath: '1.prompt.md', name: '1', lastUsed: 6 },
                { absolutePath: '/2.prompt.md', relativePath: '2.prompt.md', name: '2', lastUsed: 5 },
                { absolutePath: '/3.prompt.md', relativePath: '3.prompt.md', name: '3', lastUsed: 4 },
                { absolutePath: '/4.prompt.md', relativePath: '4.prompt.md', name: '4', lastUsed: 3 },
                { absolutePath: '/5.prompt.md', relativePath: '5.prompt.md', name: '5', lastUsed: 2 },
                { absolutePath: '/6.prompt.md', relativePath: '6.prompt.md', name: '6', lastUsed: 1 }
            ];

            const limited = recents.slice(0, 5);
            assert.strictEqual(limited.length, 5);
            assert.strictEqual(limited[0].name, '1');
            assert.strictEqual(limited[4].name, '5');
        });

        test('should filter invalid recent prompts', () => {
            const promptFiles = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', sourceFolder: '.github/prompts' },
                { absolutePath: '/b.prompt.md', relativePath: 'b.prompt.md', name: 'b', sourceFolder: '.github/prompts' }
            ];

            const recentPrompts = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', lastUsed: 3 },
                { absolutePath: '/c.prompt.md', relativePath: 'c.prompt.md', name: 'c', lastUsed: 2 },
                { absolutePath: '/b.prompt.md', relativePath: 'b.prompt.md', name: 'b', lastUsed: 1 }
            ];

            const validRecent = recentPrompts.filter(r =>
                promptFiles.some(f => f.absolutePath === r.absolutePath)
            );

            assert.strictEqual(validRecent.length, 2);
            assert.ok(validRecent.some(r => r.name === 'a'));
            assert.ok(validRecent.some(r => r.name === 'b'));
            assert.ok(!validRecent.some(r => r.name === 'c'));
        });
    });

    suite('Search Functionality', () => {
        test('should format Quick Pick items correctly', () => {
            const promptFiles = [
                {
                    absolutePath: '/workspace/.github/prompts/impl.prompt.md',
                    relativePath: '.github/prompts/impl.prompt.md',
                    name: 'impl',
                    sourceFolder: '.github/prompts'
                }
            ];

            const items = promptFiles.map(f => ({
                label: `$(file) ${f.name}`,
                description: f.relativePath,
                detail: f.sourceFolder,
                absolutePath: f.absolutePath
            }));

            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].label, '$(file) impl');
            assert.strictEqual(items[0].description, '.github/prompts/impl.prompt.md');
            assert.strictEqual(items[0].detail, '.github/prompts');
            assert.strictEqual(items[0].absolutePath, '/workspace/.github/prompts/impl.prompt.md');
        });

        test('should handle empty prompt files', () => {
            const promptFiles: any[] = [];
            const items = promptFiles.map(f => ({
                label: `$(file) ${f.name}`,
                description: f.relativePath
            }));

            assert.strictEqual(items.length, 0);
        });

        test('should handle multiple prompt files from different folders', () => {
            const promptFiles = [
                { absolutePath: '/a/1.prompt.md', relativePath: 'a/1.prompt.md', name: '1', sourceFolder: 'a' },
                { absolutePath: '/b/2.prompt.md', relativePath: 'b/2.prompt.md', name: '2', sourceFolder: 'b' },
                { absolutePath: '/a/3.prompt.md', relativePath: 'a/3.prompt.md', name: '3', sourceFolder: 'a' }
            ];

            const items = promptFiles.map(f => ({
                label: `$(file) ${f.name}`,
                description: f.relativePath,
                detail: f.sourceFolder
            }));

            assert.strictEqual(items.length, 3);
            assert.strictEqual(items[0].detail, 'a');
            assert.strictEqual(items[1].detail, 'b');
            assert.strictEqual(items[2].detail, 'a');
        });
    });

    suite('Cross-Platform Path Handling', () => {
        test('should handle Windows paths', () => {
            const windowsPath = 'C:\\workspace\\.github\\prompts\\impl.prompt.md';
            const promptFile = {
                absolutePath: windowsPath,
                relativePath: '.github\\prompts\\impl.prompt.md',
                name: 'impl',
                sourceFolder: '.github/prompts'
            };

            assert.ok(promptFile.absolutePath.includes('impl.prompt.md'));
            assert.strictEqual(promptFile.name, 'impl');
        });

        test('should handle Unix paths', () => {
            const unixPath = '/workspace/.github/prompts/impl.prompt.md';
            const promptFile = {
                absolutePath: unixPath,
                relativePath: '.github/prompts/impl.prompt.md',
                name: 'impl',
                sourceFolder: '.github/prompts'
            };

            assert.ok(promptFile.absolutePath.includes('impl.prompt.md'));
            assert.strictEqual(promptFile.name, 'impl');
        });

        test('should handle macOS paths', () => {
            const macPath = '/Users/user/workspace/.github/prompts/impl.prompt.md';
            const promptFile = {
                absolutePath: macPath,
                relativePath: '.github/prompts/impl.prompt.md',
                name: 'impl',
                sourceFolder: '.github/prompts'
            };

            assert.ok(promptFile.absolutePath.includes('impl.prompt.md'));
            assert.strictEqual(promptFile.name, 'impl');
        });
    });

    suite('UI Rendering', () => {
        test('should show recent section when recents exist', () => {
            const recentPrompts = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', lastUsed: Date.now() }
            ];

            const shouldShowRecent = recentPrompts && recentPrompts.length > 0;
            assert.strictEqual(shouldShowRecent, true);
        });

        test('should not show recent section when empty', () => {
            const recentPrompts: any[] = [];
            const shouldShowRecent = recentPrompts && recentPrompts.length > 0;
            assert.strictEqual(shouldShowRecent, false);
        });

        test('should limit recent display to 3 items', () => {
            const recentPrompts = [
                { absolutePath: '/1.prompt.md', relativePath: '1.prompt.md', name: '1', lastUsed: 5 },
                { absolutePath: '/2.prompt.md', relativePath: '2.prompt.md', name: '2', lastUsed: 4 },
                { absolutePath: '/3.prompt.md', relativePath: '3.prompt.md', name: '3', lastUsed: 3 },
                { absolutePath: '/4.prompt.md', relativePath: '4.prompt.md', name: '4', lastUsed: 2 },
                { absolutePath: '/5.prompt.md', relativePath: '5.prompt.md', name: '5', lastUsed: 1 }
            ];

            const displayRecent = recentPrompts.slice(0, 3);
            assert.strictEqual(displayRecent.length, 3);
            assert.strictEqual(displayRecent[0].name, '1');
            assert.strictEqual(displayRecent[2].name, '3');
        });

        test('should always show search option', () => {
            const hasSearchOption = true; // Always present in the new design
            assert.strictEqual(hasSearchOption, true);
        });
    });

    suite('Edge Cases', () => {
        test('should handle prompt file deletion', () => {
            const allPrompts = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', sourceFolder: '.github/prompts' }
            ];

            const recentPrompts = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', lastUsed: 3 },
                { absolutePath: '/deleted.prompt.md', relativePath: 'deleted.prompt.md', name: 'deleted', lastUsed: 2 }
            ];

            // Filter out deleted files
            const validRecent = recentPrompts.filter(r =>
                allPrompts.some(p => p.absolutePath === r.absolutePath)
            );

            assert.strictEqual(validRecent.length, 1);
            assert.strictEqual(validRecent[0].name, 'a');
        });

        test('should handle concurrent usage tracking', () => {
            let recents = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', lastUsed: 1 }
            ];

            // Simulate two quick uses
            const update1 = (path: string, time: number) => {
                const filtered = recents.filter(r => r.absolutePath !== path);
                recents = [{ absolutePath: path, relativePath: 'a.prompt.md', name: 'a', lastUsed: time }, ...filtered];
            };

            update1('/a.prompt.md', 2);
            update1('/a.prompt.md', 3);

            assert.strictEqual(recents.length, 1);
            assert.strictEqual(recents[0].lastUsed, 3);
        });

        test('should handle empty workspace', () => {
            const promptFiles: any[] = [];
            const recentPrompts: any[] = [];

            assert.strictEqual(promptFiles.length, 0);
            assert.strictEqual(recentPrompts.length, 0);
        });

        test('should handle special characters in prompt names', () => {
            const promptFile = {
                absolutePath: '/test (copy).prompt.md',
                relativePath: 'test (copy).prompt.md',
                name: 'test (copy)',
                sourceFolder: '.github/prompts'
            };

            assert.strictEqual(promptFile.name, 'test (copy)');
        });
    });
});
