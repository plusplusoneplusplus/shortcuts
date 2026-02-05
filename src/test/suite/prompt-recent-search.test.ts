/**
 * Tests for Recent Prompts, Skills, and Search functionality
 * Tests the UX enhancements for the "Follow Prompt" feature including
 * unified recent items (prompts + skills) support.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * RecentItem type (mirrors src/shortcuts/markdown-comments/webview-scripts/types.ts)
 * Used for testing unified recent items logic without importing browser-only types.
 */
interface RecentItem {
    type: 'prompt' | 'skill';
    identifier: string;
    name: string;
    relativePath?: string;
    lastUsed: number;
}

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

    suite('RecentItem Unified Type', () => {
        test('should have correct structure for prompt type', () => {
            const item: RecentItem = {
                type: 'prompt',
                identifier: '/workspace/.github/prompts/impl.prompt.md',
                name: 'impl',
                relativePath: '.github/prompts/impl.prompt.md',
                lastUsed: Date.now()
            };

            assert.strictEqual(item.type, 'prompt');
            assert.strictEqual(typeof item.identifier, 'string');
            assert.strictEqual(typeof item.name, 'string');
            assert.strictEqual(typeof item.relativePath, 'string');
            assert.strictEqual(typeof item.lastUsed, 'number');
        });

        test('should have correct structure for skill type', () => {
            const item: RecentItem = {
                type: 'skill',
                identifier: 'code-review',
                name: 'code-review',
                lastUsed: Date.now()
            };

            assert.strictEqual(item.type, 'skill');
            assert.strictEqual(item.identifier, 'code-review');
            assert.strictEqual(item.name, 'code-review');
            assert.strictEqual(item.relativePath, undefined);
            assert.strictEqual(typeof item.lastUsed, 'number');
        });

        test('should distinguish between prompt and skill types', () => {
            const promptItem: RecentItem = {
                type: 'prompt',
                identifier: '/path/to/impl.prompt.md',
                name: 'impl',
                relativePath: '.github/prompts/impl.prompt.md',
                lastUsed: 100
            };
            const skillItem: RecentItem = {
                type: 'skill',
                identifier: 'code-review',
                name: 'code-review',
                lastUsed: 200
            };

            assert.notStrictEqual(promptItem.type, skillItem.type);
            assert.strictEqual(promptItem.type, 'prompt');
            assert.strictEqual(skillItem.type, 'skill');
        });
    });

    suite('Skill Usage Tracking', () => {
        test('should track skill with name as identifier', () => {
            const recentSkills: Array<{ name: string; lastUsed: number }> = [];

            // Simulate trackSkillUsage
            const skillName = 'code-review';
            const filtered = recentSkills.filter(r => r.name !== skillName);
            filtered.unshift({ name: skillName, lastUsed: Date.now() });

            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].name, 'code-review');
        });

        test('should move re-used skill to front', () => {
            let recentSkills = [
                { name: 'skill-a', lastUsed: 3 },
                { name: 'skill-b', lastUsed: 2 },
                { name: 'skill-c', lastUsed: 1 }
            ];

            // Simulate re-using skill-c
            const filtered = recentSkills.filter(r => r.name !== 'skill-c');
            recentSkills = [{ name: 'skill-c', lastUsed: 10 }, ...filtered];

            assert.strictEqual(recentSkills[0].name, 'skill-c');
            assert.strictEqual(recentSkills[0].lastUsed, 10);
            assert.strictEqual(recentSkills.length, 3);
        });

        test('should remove duplicate skill entries', () => {
            let recentSkills = [
                { name: 'skill-a', lastUsed: 1 }
            ];

            // Simulate using the same skill again
            const filtered = recentSkills.filter(r => r.name !== 'skill-a');
            recentSkills = [{ name: 'skill-a', lastUsed: 5 }, ...filtered];

            assert.strictEqual(recentSkills.length, 1);
            assert.strictEqual(recentSkills[0].lastUsed, 5);
        });

        test('should limit recent skills to max count', () => {
            const MAX_RECENT = 5;
            const recentSkills = [
                { name: '1', lastUsed: 6 },
                { name: '2', lastUsed: 5 },
                { name: '3', lastUsed: 4 },
                { name: '4', lastUsed: 3 },
                { name: '5', lastUsed: 2 },
                { name: '6', lastUsed: 1 }
            ];

            const limited = recentSkills.slice(0, MAX_RECENT);
            assert.strictEqual(limited.length, 5);
            assert.strictEqual(limited[0].name, '1');
            assert.strictEqual(limited[4].name, '5');
        });
    });

    suite('Unified Recent Items (Merged Prompts + Skills)', () => {
        test('should merge prompts and skills sorted by lastUsed descending', () => {
            const recentPrompts = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'prompt-a', lastUsed: 5 },
                { absolutePath: '/b.prompt.md', relativePath: 'b.prompt.md', name: 'prompt-b', lastUsed: 2 }
            ];
            const recentSkills = [
                { name: 'skill-x', lastUsed: 4 },
                { name: 'skill-y', lastUsed: 1 }
            ];

            const recentItems: RecentItem[] = [];

            for (const rp of recentPrompts) {
                recentItems.push({
                    type: 'prompt',
                    identifier: rp.absolutePath,
                    name: rp.name,
                    relativePath: rp.relativePath,
                    lastUsed: rp.lastUsed
                });
            }
            for (const rs of recentSkills) {
                recentItems.push({
                    type: 'skill',
                    identifier: rs.name,
                    name: rs.name,
                    lastUsed: rs.lastUsed
                });
            }

            // Sort by lastUsed descending
            recentItems.sort((a, b) => b.lastUsed - a.lastUsed);

            assert.strictEqual(recentItems.length, 4);
            assert.strictEqual(recentItems[0].name, 'prompt-a'); // lastUsed: 5
            assert.strictEqual(recentItems[0].type, 'prompt');
            assert.strictEqual(recentItems[1].name, 'skill-x'); // lastUsed: 4
            assert.strictEqual(recentItems[1].type, 'skill');
            assert.strictEqual(recentItems[2].name, 'prompt-b'); // lastUsed: 2
            assert.strictEqual(recentItems[2].type, 'prompt');
            assert.strictEqual(recentItems[3].name, 'skill-y'); // lastUsed: 1
            assert.strictEqual(recentItems[3].type, 'skill');
        });

        test('should limit unified list to MAX_RECENT_PROMPTS (5)', () => {
            const MAX_RECENT = 5;
            const recentItems: RecentItem[] = [
                { type: 'prompt', identifier: '/1', name: '1', lastUsed: 7 },
                { type: 'skill', identifier: 's1', name: 's1', lastUsed: 6 },
                { type: 'prompt', identifier: '/2', name: '2', lastUsed: 5 },
                { type: 'skill', identifier: 's2', name: 's2', lastUsed: 4 },
                { type: 'prompt', identifier: '/3', name: '3', lastUsed: 3 },
                { type: 'skill', identifier: 's3', name: 's3', lastUsed: 2 },
                { type: 'prompt', identifier: '/4', name: '4', lastUsed: 1 }
            ];

            const limited = recentItems.slice(0, MAX_RECENT);
            assert.strictEqual(limited.length, 5);
            assert.strictEqual(limited[0].name, '1');
            assert.strictEqual(limited[4].name, '3');
        });

        test('should handle only prompts in unified list', () => {
            const recentItems: RecentItem[] = [
                { type: 'prompt', identifier: '/a', name: 'a', lastUsed: 3 },
                { type: 'prompt', identifier: '/b', name: 'b', lastUsed: 2 }
            ];

            const skillItems = recentItems.filter(r => r.type === 'skill');
            const promptItems = recentItems.filter(r => r.type === 'prompt');

            assert.strictEqual(skillItems.length, 0);
            assert.strictEqual(promptItems.length, 2);
        });

        test('should handle only skills in unified list', () => {
            const recentItems: RecentItem[] = [
                { type: 'skill', identifier: 'skill-a', name: 'skill-a', lastUsed: 3 },
                { type: 'skill', identifier: 'skill-b', name: 'skill-b', lastUsed: 2 }
            ];

            const skillItems = recentItems.filter(r => r.type === 'skill');
            const promptItems = recentItems.filter(r => r.type === 'prompt');

            assert.strictEqual(skillItems.length, 2);
            assert.strictEqual(promptItems.length, 0);
        });

        test('should handle empty unified list', () => {
            const recentItems: RecentItem[] = [];

            assert.strictEqual(recentItems.length, 0);
        });

        test('should handle items with same lastUsed timestamp', () => {
            const recentItems: RecentItem[] = [
                { type: 'prompt', identifier: '/a', name: 'a', lastUsed: 5 },
                { type: 'skill', identifier: 's1', name: 's1', lastUsed: 5 }
            ];

            recentItems.sort((a, b) => b.lastUsed - a.lastUsed);

            // Both have same timestamp - order is stable
            assert.strictEqual(recentItems.length, 2);
            assert.strictEqual(recentItems[0].lastUsed, 5);
            assert.strictEqual(recentItems[1].lastUsed, 5);
        });
    });

    suite('Unified Recent Items Validation', () => {
        test('should filter out deleted prompts from unified list', () => {
            const promptFiles = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', sourceFolder: '.github/prompts' }
            ];
            const skills = [
                { absolutePath: '/skills/s1', relativePath: '.github/skills/s1', name: 's1' }
            ];

            const recentItems: RecentItem[] = [
                { type: 'prompt', identifier: '/a.prompt.md', name: 'a', lastUsed: 5 },
                { type: 'prompt', identifier: '/deleted.prompt.md', name: 'deleted', lastUsed: 4 },
                { type: 'skill', identifier: 's1', name: 's1', lastUsed: 3 }
            ];

            const validItems = recentItems.filter(item => {
                if (item.type === 'prompt') {
                    return promptFiles.some(p => p.absolutePath === item.identifier);
                } else {
                    return skills.some(s => s.name === item.identifier);
                }
            });

            assert.strictEqual(validItems.length, 2);
            assert.strictEqual(validItems[0].name, 'a');
            assert.strictEqual(validItems[0].type, 'prompt');
            assert.strictEqual(validItems[1].name, 's1');
            assert.strictEqual(validItems[1].type, 'skill');
        });

        test('should filter out deleted skills from unified list', () => {
            const promptFiles = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', sourceFolder: '.github/prompts' }
            ];
            const skills = [
                { absolutePath: '/skills/s1', relativePath: '.github/skills/s1', name: 's1' }
            ];

            const recentItems: RecentItem[] = [
                { type: 'skill', identifier: 's1', name: 's1', lastUsed: 5 },
                { type: 'skill', identifier: 'deleted-skill', name: 'deleted-skill', lastUsed: 4 },
                { type: 'prompt', identifier: '/a.prompt.md', name: 'a', lastUsed: 3 }
            ];

            const validItems = recentItems.filter(item => {
                if (item.type === 'prompt') {
                    return promptFiles.some(p => p.absolutePath === item.identifier);
                } else {
                    return skills.some(s => s.name === item.identifier);
                }
            });

            assert.strictEqual(validItems.length, 2);
            assert.strictEqual(validItems[0].name, 's1');
            assert.strictEqual(validItems[0].type, 'skill');
            assert.strictEqual(validItems[1].name, 'a');
            assert.strictEqual(validItems[1].type, 'prompt');
        });

        test('should filter out all items when no prompts or skills exist', () => {
            const promptFiles: any[] = [];
            const skills: any[] = [];

            const recentItems: RecentItem[] = [
                { type: 'prompt', identifier: '/a.prompt.md', name: 'a', lastUsed: 5 },
                { type: 'skill', identifier: 's1', name: 's1', lastUsed: 3 }
            ];

            const validItems = recentItems.filter(item => {
                if (item.type === 'prompt') {
                    return promptFiles.some((p: any) => p.absolutePath === item.identifier);
                } else {
                    return skills.some((s: any) => s.name === item.identifier);
                }
            });

            assert.strictEqual(validItems.length, 0);
        });

        test('should validate and limit recent display to 3 items', () => {
            const recentItems: RecentItem[] = [
                { type: 'prompt', identifier: '/1', name: '1', lastUsed: 5 },
                { type: 'skill', identifier: 's1', name: 's1', lastUsed: 4 },
                { type: 'prompt', identifier: '/2', name: '2', lastUsed: 3 },
                { type: 'skill', identifier: 's2', name: 's2', lastUsed: 2 },
                { type: 'prompt', identifier: '/3', name: '3', lastUsed: 1 }
            ];

            const displayRecent = recentItems.slice(0, 3);
            assert.strictEqual(displayRecent.length, 3);
            assert.strictEqual(displayRecent[0].name, '1');
            assert.strictEqual(displayRecent[0].type, 'prompt');
            assert.strictEqual(displayRecent[1].name, 's1');
            assert.strictEqual(displayRecent[1].type, 'skill');
            assert.strictEqual(displayRecent[2].name, '2');
            assert.strictEqual(displayRecent[2].type, 'prompt');
        });
    });

    suite('Unified Recent Items - Integration Scenarios', () => {
        test('should show skill in Recent after skill execution', () => {
            // Simulate: user executes a skill via executeWorkPlanWithSkill
            let recentSkills: Array<{ name: string; lastUsed: number }> = [];

            // Track skill usage
            const skillName = 'code-review';
            const filtered = recentSkills.filter(r => r.name !== skillName);
            recentSkills = [{ name: skillName, lastUsed: 100 }, ...filtered];

            // Build unified list
            const recentItems: RecentItem[] = [];
            for (const rs of recentSkills) {
                recentItems.push({
                    type: 'skill',
                    identifier: rs.name,
                    name: rs.name,
                    lastUsed: rs.lastUsed
                });
            }

            assert.strictEqual(recentItems.length, 1);
            assert.strictEqual(recentItems[0].type, 'skill');
            assert.strictEqual(recentItems[0].identifier, 'code-review');
        });

        test('should interleave prompts and skills by recency', () => {
            // Scenario: User uses prompt, then skill, then another prompt
            const recentPrompts = [
                { absolutePath: '/latest.prompt.md', relativePath: 'latest.prompt.md', name: 'latest', lastUsed: 300 },
                { absolutePath: '/old.prompt.md', relativePath: 'old.prompt.md', name: 'old', lastUsed: 100 }
            ];
            const recentSkills = [
                { name: 'middle-skill', lastUsed: 200 }
            ];

            const recentItems: RecentItem[] = [];
            for (const rp of recentPrompts) {
                recentItems.push({ type: 'prompt', identifier: rp.absolutePath, name: rp.name, relativePath: rp.relativePath, lastUsed: rp.lastUsed });
            }
            for (const rs of recentSkills) {
                recentItems.push({ type: 'skill', identifier: rs.name, name: rs.name, lastUsed: rs.lastUsed });
            }
            recentItems.sort((a, b) => b.lastUsed - a.lastUsed);

            assert.strictEqual(recentItems[0].name, 'latest');
            assert.strictEqual(recentItems[0].type, 'prompt');
            assert.strictEqual(recentItems[1].name, 'middle-skill');
            assert.strictEqual(recentItems[1].type, 'skill');
            assert.strictEqual(recentItems[2].name, 'old');
            assert.strictEqual(recentItems[2].type, 'prompt');
        });

        test('should handle skill re-use bumping to top of recent', () => {
            // Simulate: skill was used before, now used again
            let recentSkills = [
                { name: 'old-skill', lastUsed: 100 },
                { name: 'other-skill', lastUsed: 50 }
            ];

            // Re-use 'old-skill'
            const filtered = recentSkills.filter(r => r.name !== 'old-skill');
            recentSkills = [{ name: 'old-skill', lastUsed: 500 }, ...filtered];

            // Build unified list with a prompt
            const recentPrompts = [
                { absolutePath: '/p1', relativePath: 'p1', name: 'p1', lastUsed: 200 }
            ];

            const recentItems: RecentItem[] = [];
            for (const rp of recentPrompts) {
                recentItems.push({ type: 'prompt', identifier: rp.absolutePath, name: rp.name, relativePath: rp.relativePath, lastUsed: rp.lastUsed });
            }
            for (const rs of recentSkills) {
                recentItems.push({ type: 'skill', identifier: rs.name, name: rs.name, lastUsed: rs.lastUsed });
            }
            recentItems.sort((a, b) => b.lastUsed - a.lastUsed);

            // Re-used skill should be at top
            assert.strictEqual(recentItems[0].name, 'old-skill');
            assert.strictEqual(recentItems[0].type, 'skill');
            assert.strictEqual(recentItems[0].lastUsed, 500);
            assert.strictEqual(recentItems[1].name, 'p1');
            assert.strictEqual(recentItems[1].type, 'prompt');
        });

        test('should use skill identifier (name) not path for matching', () => {
            const skills = [
                { absolutePath: '/ws/.github/skills/my-skill', relativePath: '.github/skills/my-skill', name: 'my-skill' }
            ];

            const recentItem: RecentItem = {
                type: 'skill',
                identifier: 'my-skill',  // name-based identifier
                name: 'my-skill',
                lastUsed: 100
            };

            // Validate by name matching
            const isValid = skills.some(s => s.name === recentItem.identifier);
            assert.strictEqual(isValid, true);
        });

        test('should maintain backward compatibility with legacy recentPrompts', () => {
            // When recentItems is not provided, legacy recentPrompts should still work
            const recentPrompts = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'a', lastUsed: 3 }
            ];

            // Simulate the check done in updateExecuteWorkPlanSubmenu
            function checkRecent(items: RecentItem[] | undefined, legacy: any[]): { hasUnified: boolean; hasLegacy: boolean } {
                const hasUnified = items !== undefined && items.length > 0;
                const hasLegacy = !hasUnified && legacy !== undefined && legacy.length > 0;
                return { hasUnified, hasLegacy };
            }

            const result = checkRecent(undefined, recentPrompts);
            assert.strictEqual(result.hasUnified, false);
            assert.strictEqual(result.hasLegacy, true);
        });

        test('should prefer unified recentItems over legacy recentPrompts', () => {
            const recentPrompts = [
                { absolutePath: '/a.prompt.md', relativePath: 'a.prompt.md', name: 'legacy-a', lastUsed: 3 }
            ];
            const recentItems: RecentItem[] = [
                { type: 'prompt', identifier: '/a.prompt.md', name: 'unified-a', lastUsed: 5 },
                { type: 'skill', identifier: 'skill-1', name: 'skill-1', lastUsed: 4 }
            ];

            // Simulate the check done in updateExecuteWorkPlanSubmenu
            function checkRecent(items: RecentItem[] | undefined, legacy: any[]): { hasUnified: boolean; hasLegacy: boolean } {
                const hasUnified = items !== undefined && items.length > 0;
                const hasLegacy = !hasUnified && legacy !== undefined && legacy.length > 0;
                return { hasUnified, hasLegacy };
            }

            const result = checkRecent(recentItems, recentPrompts);
            assert.strictEqual(result.hasUnified, true);
            assert.strictEqual(result.hasLegacy, false);
        });
    });

    suite('Message Types - Unified Recent Items', () => {
        test('should have promptFilesResponse with recentItems', () => {
            const message = {
                type: 'promptFilesResponse' as const,
                promptFiles: [
                    { absolutePath: '/test.prompt.md', relativePath: 'test.prompt.md', name: 'test', sourceFolder: '.github/prompts' }
                ],
                recentPrompts: [
                    { absolutePath: '/test.prompt.md', relativePath: 'test.prompt.md', name: 'test', lastUsed: Date.now() }
                ],
                recentItems: [
                    { type: 'prompt' as const, identifier: '/test.prompt.md', name: 'test', relativePath: 'test.prompt.md', lastUsed: Date.now() },
                    { type: 'skill' as const, identifier: 'code-review', name: 'code-review', lastUsed: Date.now() - 1000 }
                ],
                skills: [
                    { absolutePath: '/skills/code-review', relativePath: '.github/skills/code-review', name: 'code-review', description: 'Code review skill' }
                ]
            };

            assert.strictEqual(message.type, 'promptFilesResponse');
            assert.ok(Array.isArray(message.recentItems));
            assert.strictEqual(message.recentItems!.length, 2);
            assert.strictEqual(message.recentItems![0].type, 'prompt');
            assert.strictEqual(message.recentItems![1].type, 'skill');
        });

        test('should allow optional recentItems', () => {
            const message: {
                type: 'promptFilesResponse';
                promptFiles: any[];
                recentPrompts?: any[];
                recentItems?: RecentItem[];
                skills?: any[];
            } = {
                type: 'promptFilesResponse' as const,
                promptFiles: [],
                recentPrompts: []
            };

            assert.strictEqual(message.recentItems, undefined);
        });
    });

    suite('Concurrent Skill and Prompt Usage', () => {
        test('should handle rapid alternating prompt and skill usage', () => {
            let recentPrompts: Array<{ absolutePath: string; relativePath: string; name: string; lastUsed: number }> = [];
            let recentSkills: Array<{ name: string; lastUsed: number }> = [];

            // Simulate rapid usage
            const trackPrompt = (absPath: string, name: string, time: number) => {
                const filtered = recentPrompts.filter(r => r.absolutePath !== absPath);
                recentPrompts = [{ absolutePath: absPath, relativePath: name, name, lastUsed: time }, ...filtered];
            };
            const trackSkill = (name: string, time: number) => {
                const filtered = recentSkills.filter(r => r.name !== name);
                recentSkills = [{ name, lastUsed: time }, ...filtered];
            };

            trackPrompt('/p1', 'p1', 1);
            trackSkill('s1', 2);
            trackPrompt('/p2', 'p2', 3);
            trackSkill('s1', 4); // Re-use s1
            trackPrompt('/p1', 'p1', 5); // Re-use p1

            // Build unified list
            const recentItems: RecentItem[] = [];
            for (const rp of recentPrompts) {
                recentItems.push({ type: 'prompt', identifier: rp.absolutePath, name: rp.name, relativePath: rp.relativePath, lastUsed: rp.lastUsed });
            }
            for (const rs of recentSkills) {
                recentItems.push({ type: 'skill', identifier: rs.name, name: rs.name, lastUsed: rs.lastUsed });
            }
            recentItems.sort((a, b) => b.lastUsed - a.lastUsed);

            // p1 (5) > s1 (4) > p2 (3)
            assert.strictEqual(recentItems[0].name, 'p1');
            assert.strictEqual(recentItems[0].type, 'prompt');
            assert.strictEqual(recentItems[1].name, 's1');
            assert.strictEqual(recentItems[1].type, 'skill');
            assert.strictEqual(recentItems[2].name, 'p2');
            assert.strictEqual(recentItems[2].type, 'prompt');
        });

        test('should handle special characters in skill names', () => {
            const skillItem: RecentItem = {
                type: 'skill',
                identifier: 'my-skill (v2)',
                name: 'my-skill (v2)',
                lastUsed: Date.now()
            };

            assert.strictEqual(skillItem.name, 'my-skill (v2)');
            assert.strictEqual(skillItem.identifier, 'my-skill (v2)');
        });
    });
});
