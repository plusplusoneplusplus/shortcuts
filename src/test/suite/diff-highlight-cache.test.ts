/**
 * Tests for diff highlight cache behavior
 * Ensures that the highlight cache correctly detects content changes when switching files
 */

import * as assert from 'assert';

/**
 * Simple hash function for content comparison (mirrors the implementation in diff-renderer.ts)
 * Uses a combination of length and sampled characters for fast comparison
 */
function hashContent(content: string): string {
    const len = content.length;
    const first = content.slice(0, 100);
    const last = content.slice(-100);
    const mid = len > 200 ? content.slice(Math.floor(len / 2) - 50, Math.floor(len / 2) + 50) : '';
    return `${len}:${first}:${mid}:${last}`;
}

/**
 * Cache for highlighted lines (mirrors the interface in diff-renderer.ts)
 */
interface HighlightedLinesCache {
    oldLines: string[];
    newLines: string[];
    language: string;
    oldContentHash: string;
    newContentHash: string;
}

/**
 * Simulates the cache validation logic from diff-renderer.ts
 */
function shouldUseCache(
    cache: HighlightedLinesCache | null,
    language: string,
    oldContent: string,
    newContent: string
): boolean {
    if (!cache) {
        return false;
    }
    const oldContentHash = hashContent(oldContent);
    const newContentHash = hashContent(newContent);

    return cache.language === language &&
           cache.oldContentHash === oldContentHash &&
           cache.newContentHash === newContentHash;
}

suite('Diff Highlight Cache Tests', () => {

    suite('hashContent Function', () => {
        test('should generate unique hash for different content', () => {
            const hash1 = hashContent('Hello World');
            const hash2 = hashContent('Goodbye World');

            assert.notStrictEqual(hash1, hash2);
        });

        test('should generate same hash for identical content', () => {
            const content = 'function test() { return true; }';
            const hash1 = hashContent(content);
            const hash2 = hashContent(content);

            assert.strictEqual(hash1, hash2);
        });

        test('should detect changes in short content', () => {
            const hash1 = hashContent('short');
            const hash2 = hashContent('shorts');

            assert.notStrictEqual(hash1, hash2);
        });

        test('should detect changes in long content', () => {
            const content1 = 'A'.repeat(500);
            const content2 = 'A'.repeat(500) + 'B';

            const hash1 = hashContent(content1);
            const hash2 = hashContent(content2);

            // Length difference should be detected
            assert.notStrictEqual(hash1, hash2);
        });

        test('should detect changes in middle of long content', () => {
            const base = 'A'.repeat(150);
            const content1 = base + 'X'.repeat(100) + base;
            const content2 = base + 'Y'.repeat(100) + base;

            const hash1 = hashContent(content1);
            const hash2 = hashContent(content2);

            // Middle section difference should be detected
            assert.notStrictEqual(hash1, hash2);
        });

        test('should handle empty content', () => {
            const hash = hashContent('');

            assert.strictEqual(typeof hash, 'string');
            assert.ok(hash.length > 0);
        });

        test('should handle content with special characters', () => {
            const hash1 = hashContent('<div class="test">Content & More</div>');
            const hash2 = hashContent('<div class="test">Different & More</div>');

            assert.notStrictEqual(hash1, hash2);
        });

        test('should handle multiline content', () => {
            const content1 = 'line1\nline2\nline3';
            const content2 = 'line1\nline2\nline4';

            const hash1 = hashContent(content1);
            const hash2 = hashContent(content2);

            assert.notStrictEqual(hash1, hash2);
        });

        test('should handle content with Windows line endings', () => {
            const content1 = 'line1\r\nline2\r\nline3';
            const content2 = 'line1\r\nline2\r\nline4';

            const hash1 = hashContent(content1);
            const hash2 = hashContent(content2);

            assert.notStrictEqual(hash1, hash2);
        });
    });

    suite('Cache Validation Logic', () => {
        const createCache = (language: string, oldContent: string, newContent: string): HighlightedLinesCache => ({
            oldLines: ['<span>old line</span>'],
            newLines: ['<span>new line</span>'],
            language,
            oldContentHash: hashContent(oldContent),
            newContentHash: hashContent(newContent)
        });

        test('should use cache when content and language match', () => {
            const cache = createCache('typescript', 'old content', 'new content');

            const result = shouldUseCache(cache, 'typescript', 'old content', 'new content');

            assert.strictEqual(result, true);
        });

        test('should not use cache when null', () => {
            const result = shouldUseCache(null, 'typescript', 'old content', 'new content');

            assert.strictEqual(result, false);
        });

        test('should not use cache when language differs', () => {
            const cache = createCache('typescript', 'old content', 'new content');

            const result = shouldUseCache(cache, 'javascript', 'old content', 'new content');

            assert.strictEqual(result, false);
        });

        test('should not use cache when old content differs', () => {
            const cache = createCache('typescript', 'old content A', 'new content');

            const result = shouldUseCache(cache, 'typescript', 'old content B', 'new content');

            assert.strictEqual(result, false);
        });

        test('should not use cache when new content differs', () => {
            const cache = createCache('typescript', 'old content', 'new content A');

            const result = shouldUseCache(cache, 'typescript', 'old content', 'new content B');

            assert.strictEqual(result, false);
        });

        test('should not use cache when switching files with same language', () => {
            // Simulates the bug scenario: switching from file A to file B with same language
            const fileAOldContent = 'function fileA() { return "A"; }';
            const fileANewContent = 'function fileA() { return "A modified"; }';
            const fileBOldContent = 'function fileB() { return "B"; }';
            const fileBNewContent = 'function fileB() { return "B modified"; }';

            // Cache was created for file A
            const cache = createCache('typescript', fileAOldContent, fileANewContent);

            // Should NOT use cache for file B (different content, same language)
            const result = shouldUseCache(cache, 'typescript', fileBOldContent, fileBNewContent);

            assert.strictEqual(result, false, 'Cache should not be used when content differs even if language matches');
        });

        test('should correctly handle empty old content (new file)', () => {
            const cache = createCache('typescript', '', 'new file content');

            const result = shouldUseCache(cache, 'typescript', '', 'new file content');

            assert.strictEqual(result, true);
        });

        test('should correctly handle empty new content (deleted file)', () => {
            const cache = createCache('typescript', 'deleted file content', '');

            const result = shouldUseCache(cache, 'typescript', 'deleted file content', '');

            assert.strictEqual(result, true);
        });

        test('should detect subtle changes in content', () => {
            // Content that differs only by a single character
            const cache = createCache('typescript', 'const x = 1;', 'const x = 2;');

            const result = shouldUseCache(cache, 'typescript', 'const x = 1;', 'const x = 3;');

            assert.strictEqual(result, false);
        });
    });

    suite('Real-World Scenarios', () => {
        test('scenario: rapid file switching in preview mode', () => {
            const files = [
                { old: 'file1 old', new: 'file1 new', lang: 'typescript' },
                { old: 'file2 old', new: 'file2 new', lang: 'typescript' },
                { old: 'file3 old', new: 'file3 new', lang: 'typescript' }
            ];

            // Start with file1 cached
            let cache: HighlightedLinesCache | null = {
                oldLines: ['file1 highlighted'],
                newLines: ['file1 highlighted'],
                language: files[0].lang,
                oldContentHash: hashContent(files[0].old),
                newContentHash: hashContent(files[0].new)
            };

            // Switch to file2 - cache should be invalid
            const useForFile2 = shouldUseCache(cache, files[1].lang, files[1].old, files[1].new);
            assert.strictEqual(useForFile2, false, 'Should not use file1 cache for file2');

            // Update cache for file2
            cache = {
                oldLines: ['file2 highlighted'],
                newLines: ['file2 highlighted'],
                language: files[1].lang,
                oldContentHash: hashContent(files[1].old),
                newContentHash: hashContent(files[1].new)
            };

            // Switch to file3 - cache should be invalid
            const useForFile3 = shouldUseCache(cache, files[2].lang, files[2].old, files[2].new);
            assert.strictEqual(useForFile3, false, 'Should not use file2 cache for file3');

            // Switch back to file2 - cache should still be invalid (was updated for file3)
            cache = {
                oldLines: ['file3 highlighted'],
                newLines: ['file3 highlighted'],
                language: files[2].lang,
                oldContentHash: hashContent(files[2].old),
                newContentHash: hashContent(files[2].new)
            };

            const useForFile2Again = shouldUseCache(cache, files[1].lang, files[1].old, files[1].new);
            assert.strictEqual(useForFile2Again, false, 'Should not use file3 cache when switching back to file2');
        });

        test('scenario: viewing same file multiple times', () => {
            const fileContent = { old: 'same old', new: 'same new', lang: 'typescript' };

            // Create cache for file
            const cache: HighlightedLinesCache = {
                oldLines: ['highlighted old'],
                newLines: ['highlighted new'],
                language: fileContent.lang,
                oldContentHash: hashContent(fileContent.old),
                newContentHash: hashContent(fileContent.new)
            };

            // View same file again - should use cache
            const result = shouldUseCache(cache, fileContent.lang, fileContent.old, fileContent.new);

            assert.strictEqual(result, true, 'Should use cache for same file');
        });

        test('scenario: file modified while viewing another file', () => {
            const file1V1 = { old: 'v1 old', new: 'v1 new', lang: 'typescript' };
            const file1V2 = { old: 'v1 old', new: 'v1 new modified', lang: 'typescript' };

            // Create cache for file1 v1
            const cache: HighlightedLinesCache = {
                oldLines: ['v1 highlighted'],
                newLines: ['v1 highlighted'],
                language: file1V1.lang,
                oldContentHash: hashContent(file1V1.old),
                newContentHash: hashContent(file1V1.new)
            };

            // File1 was modified while viewing another file
            // When returning to file1, cache should be invalid
            const result = shouldUseCache(cache, file1V2.lang, file1V2.old, file1V2.new);

            assert.strictEqual(result, false, 'Should not use cache when file content changed');
        });

        test('scenario: switching between TypeScript and JavaScript files', () => {
            const tsFile = { old: 'const x: number = 1;', new: 'const x: number = 2;', lang: 'typescript' };
            const jsFile = { old: 'const x = 1;', new: 'const x = 2;', lang: 'javascript' };

            // Create cache for TS file
            const cache: HighlightedLinesCache = {
                oldLines: ['ts highlighted'],
                newLines: ['ts highlighted'],
                language: tsFile.lang,
                oldContentHash: hashContent(tsFile.old),
                newContentHash: hashContent(tsFile.new)
            };

            // Switch to JS file - cache should be invalid due to language
            const result = shouldUseCache(cache, jsFile.lang, jsFile.old, jsFile.new);

            assert.strictEqual(result, false, 'Should not use TypeScript cache for JavaScript file');
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should handle Unix-style paths in content', () => {
            const content1 = 'import { foo } from "/path/to/file.ts";';
            const content2 = 'import { foo } from "/different/path/file.ts";';

            const hash1 = hashContent(content1);
            const hash2 = hashContent(content2);

            assert.notStrictEqual(hash1, hash2);
        });

        test('should handle Windows-style paths in content', () => {
            const content1 = 'import { foo } from "C:\\path\\to\\file.ts";';
            const content2 = 'import { foo } from "C:\\different\\path\\file.ts";';

            const hash1 = hashContent(content1);
            const hash2 = hashContent(content2);

            assert.notStrictEqual(hash1, hash2);
        });

        test('should handle mixed line endings', () => {
            // Same content with different line endings
            const unixContent = 'line1\nline2\nline3';
            const windowsContent = 'line1\r\nline2\r\nline3';
            const mixedContent = 'line1\nline2\r\nline3';

            const hashUnix = hashContent(unixContent);
            const hashWindows = hashContent(windowsContent);
            const hashMixed = hashContent(mixedContent);

            // All should be different since line endings differ
            // (Note: The diff-content-provider normalizes line endings before reaching the cache,
            //  but the cache itself should still detect differences)
            assert.notStrictEqual(hashUnix, hashWindows);
            assert.notStrictEqual(hashUnix, hashMixed);
            assert.notStrictEqual(hashWindows, hashMixed);
        });

        test('should handle Unicode content', () => {
            const content1 = 'const greeting = "Hello, 世界!";';
            const content2 = 'const greeting = "Hello, 世界！";';

            const hash1 = hashContent(content1);
            const hash2 = hashContent(content2);

            // Different punctuation (halfwidth vs fullwidth exclamation)
            assert.notStrictEqual(hash1, hash2);
        });

        test('should handle emoji in content', () => {
            const content1 = '// TODO: Fix this 🐛';
            const content2 = '// TODO: Fix this 🔧';

            const hash1 = hashContent(content1);
            const hash2 = hashContent(content2);

            assert.notStrictEqual(hash1, hash2);
        });
    });
});
