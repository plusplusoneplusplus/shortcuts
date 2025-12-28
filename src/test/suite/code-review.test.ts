/**
 * Code Review Feature Tests
 * 
 * Tests for the code review functionality that reviews Git diffs
 * against code rule files.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    CodeReviewConfig,
    CodeReviewMetadata,
    CodeRule,
    DEFAULT_CODE_REVIEW_CONFIG,
    DiffStats,
    LARGE_DIFF_THRESHOLD
} from '../../shortcuts/code-review/types';
import { glob, getFilesWithExtension } from '../../shortcuts/shared/glob-utils';

suite('Code Review Types', () => {
    test('DEFAULT_CODE_REVIEW_CONFIG has correct default values', () => {
        assert.strictEqual(DEFAULT_CODE_REVIEW_CONFIG.rulesFolder, '.github/cr-rules');
        assert.strictEqual(DEFAULT_CODE_REVIEW_CONFIG.rulesPattern, '**/*.md');
        assert.strictEqual(DEFAULT_CODE_REVIEW_CONFIG.outputMode, 'aiProcess');
        assert.ok(DEFAULT_CODE_REVIEW_CONFIG.promptTemplate.includes('Review'));
    });

    test('LARGE_DIFF_THRESHOLD is 50KB', () => {
        assert.strictEqual(LARGE_DIFF_THRESHOLD, 50 * 1024);
    });
});

suite('Glob Utilities', () => {
    let testDir: string;

    setup(() => {
        // Create a temporary test directory
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-test-'));
    });

    teardown(() => {
        // Clean up test directory
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('glob finds markdown files', () => {
        // Create test files
        fs.writeFileSync(path.join(testDir, 'rule1.md'), '# Rule 1');
        fs.writeFileSync(path.join(testDir, 'rule2.md'), '# Rule 2');
        fs.writeFileSync(path.join(testDir, 'other.txt'), 'Not a rule');

        const files = glob('**/*.md', testDir);
        
        assert.strictEqual(files.length, 2);
        assert.ok(files.some(f => f.endsWith('rule1.md')));
        assert.ok(files.some(f => f.endsWith('rule2.md')));
    });

    test('glob finds files in subdirectories', () => {
        // Create nested structure
        const subDir = path.join(testDir, 'subdir');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(testDir, 'root.md'), '# Root');
        fs.writeFileSync(path.join(subDir, 'nested.md'), '# Nested');

        const files = glob('**/*.md', testDir);
        
        assert.strictEqual(files.length, 2);
        assert.ok(files.some(f => f.endsWith('root.md')));
        assert.ok(files.some(f => f.endsWith('nested.md')));
    });

    test('glob returns empty array for empty directory', () => {
        const files = glob('**/*.md', testDir);
        assert.strictEqual(files.length, 0);
    });

    test('glob skips hidden directories', () => {
        // Create hidden directory with files
        const hiddenDir = path.join(testDir, '.hidden');
        fs.mkdirSync(hiddenDir);
        fs.writeFileSync(path.join(hiddenDir, 'secret.md'), '# Secret');
        fs.writeFileSync(path.join(testDir, 'visible.md'), '# Visible');

        const files = glob('**/*.md', testDir);
        
        assert.strictEqual(files.length, 1);
        assert.ok(files[0].endsWith('visible.md'));
    });

    test('getFilesWithExtension works correctly', () => {
        fs.writeFileSync(path.join(testDir, 'file1.md'), '# File 1');
        fs.writeFileSync(path.join(testDir, 'file2.txt'), 'File 2');

        const mdFiles = getFilesWithExtension(testDir, '.md');
        const txtFiles = getFilesWithExtension(testDir, '.txt');

        assert.strictEqual(mdFiles.length, 1);
        assert.strictEqual(txtFiles.length, 1);
    });
});

suite('Code Review Prompt Construction', () => {
    test('builds prompt with correct structure', () => {
        const rules: CodeRule[] = [
            { filename: 'naming.md', path: '/rules/naming.md', content: '# Naming Rules\nUse camelCase' },
            { filename: 'security.md', path: '/rules/security.md', content: '# Security\nValidate inputs' }
        ];

        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc1234567890',
            commitMessage: 'feat: add login',
            rulesUsed: ['naming.md', 'security.md']
        };

        const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,5 @@
+import { auth } from './auth';
 export function main() {
+  auth.login();
 }`;

        // Simulate prompt building
        const parts: string[] = [];
        parts.push(DEFAULT_CODE_REVIEW_CONFIG.promptTemplate);
        parts.push('');
        parts.push('---');
        parts.push('');
        parts.push('# Coding Rules');
        parts.push('');
        for (const rule of rules) {
            parts.push(`## ${rule.filename}`);
            parts.push(rule.content);
            parts.push('');
        }
        parts.push('---');
        parts.push('');
        parts.push('# Code Changes');
        parts.push('');
        parts.push(`Commit: ${metadata.commitSha}`);
        parts.push(`Message: ${metadata.commitMessage}`);
        parts.push('');
        parts.push(diff);

        const prompt = parts.join('\n');

        // Verify structure
        assert.ok(prompt.includes('Review the following code changes'));
        assert.ok(prompt.includes('# Coding Rules'));
        assert.ok(prompt.includes('## naming.md'));
        assert.ok(prompt.includes('## security.md'));
        assert.ok(prompt.includes('# Code Changes'));
        assert.ok(prompt.includes('Commit: abc1234567890'));
        assert.ok(prompt.includes('feat: add login'));
        assert.ok(prompt.includes('diff --git'));
    });

    test('builds prompt for pending changes', () => {
        const metadata: CodeReviewMetadata = {
            type: 'pending',
            rulesUsed: []
        };

        const parts: string[] = [];
        parts.push('# Code Changes');
        parts.push('');
        parts.push('Type: Pending Changes (staged + unstaged)');

        const prompt = parts.join('\n');

        assert.ok(prompt.includes('Pending Changes'));
    });

    test('builds prompt for staged changes', () => {
        const metadata: CodeReviewMetadata = {
            type: 'staged',
            rulesUsed: []
        };

        const parts: string[] = [];
        parts.push('# Code Changes');
        parts.push('');
        parts.push('Type: Staged Changes');

        const prompt = parts.join('\n');

        assert.ok(prompt.includes('Staged Changes'));
    });
});

suite('Diff Statistics Parsing', () => {
    function parseDiffStats(diff: string): DiffStats {
        const lines = diff.split('\n');
        let files = 0;
        let additions = 0;
        let deletions = 0;

        for (const line of lines) {
            if (line.startsWith('diff --git')) {
                files++;
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                additions++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                deletions++;
            }
        }

        return { files, additions, deletions };
    }

    test('parses single file diff correctly', () => {
        const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,5 @@
+import { auth } from './auth';
 export function main() {
+  auth.login();
 }`;

        const stats = parseDiffStats(diff);
        assert.strictEqual(stats.files, 1);
        assert.strictEqual(stats.additions, 2);
        assert.strictEqual(stats.deletions, 0);
    });

    test('parses multiple file diff correctly', () => {
        const diff = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,3 @@
+// New comment
 export const a = 1;
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1,3 +1,2 @@
-// Old comment
 export const b = 2;`;

        const stats = parseDiffStats(diff);
        assert.strictEqual(stats.files, 2);
        assert.strictEqual(stats.additions, 1);
        assert.strictEqual(stats.deletions, 1);
    });

    test('handles empty diff', () => {
        const stats = parseDiffStats('');
        assert.strictEqual(stats.files, 0);
        assert.strictEqual(stats.additions, 0);
        assert.strictEqual(stats.deletions, 0);
    });
});

suite('Large Diff Detection', () => {
    function isDiffLarge(diff: string): boolean {
        return Buffer.byteLength(diff, 'utf-8') > LARGE_DIFF_THRESHOLD;
    }

    test('detects small diff as not large', () => {
        const smallDiff = 'diff --git a/file.ts b/file.ts\n+line';
        assert.strictEqual(isDiffLarge(smallDiff), false);
    });

    test('detects large diff correctly', () => {
        // Create a diff larger than 50KB
        const largeDiff = 'diff --git a/file.ts b/file.ts\n' + '+'.repeat(60 * 1024);
        assert.strictEqual(isDiffLarge(largeDiff), true);
    });

    test('threshold is exactly 50KB', () => {
        // Create a diff exactly at threshold
        const atThreshold = 'x'.repeat(LARGE_DIFF_THRESHOLD);
        const justOver = 'x'.repeat(LARGE_DIFF_THRESHOLD + 1);

        assert.strictEqual(isDiffLarge(atThreshold), false);
        assert.strictEqual(isDiffLarge(justOver), true);
    });
});

suite('Process Title Generation', () => {
    function createProcessTitle(metadata: CodeReviewMetadata): string {
        if (metadata.type === 'commit' && metadata.commitSha) {
            const shortHash = metadata.commitSha.substring(0, 7);
            return `Review: ${shortHash}`;
        } else if (metadata.type === 'pending') {
            return 'Review: pending';
        } else {
            return 'Review: staged';
        }
    }

    test('creates title for commit review', () => {
        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc1234567890',
            commitMessage: 'feat: add login',
            rulesUsed: []
        };

        const title = createProcessTitle(metadata);
        assert.strictEqual(title, 'Review: abc1234');
    });

    test('creates title for pending changes review', () => {
        const metadata: CodeReviewMetadata = {
            type: 'pending',
            rulesUsed: []
        };

        const title = createProcessTitle(metadata);
        assert.strictEqual(title, 'Review: pending');
    });

    test('creates title for staged changes review', () => {
        const metadata: CodeReviewMetadata = {
            type: 'staged',
            rulesUsed: []
        };

        const title = createProcessTitle(metadata);
        assert.strictEqual(title, 'Review: staged');
    });
});

suite('Configuration Validation', () => {
    let testDir: string;

    setup(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-config-test-'));
    });

    teardown(() => {
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('validates folder exists', () => {
        const rulesFolder = path.join(testDir, '.github', 'cr-rules');
        
        // Folder doesn't exist
        assert.strictEqual(fs.existsSync(rulesFolder), false);

        // Create folder
        fs.mkdirSync(rulesFolder, { recursive: true });
        assert.strictEqual(fs.existsSync(rulesFolder), true);
    });

    test('validates folder is directory', () => {
        const filePath = path.join(testDir, 'not-a-folder');
        fs.writeFileSync(filePath, 'content');

        const stat = fs.statSync(filePath);
        assert.strictEqual(stat.isDirectory(), false);
    });

    test('validates rules exist in folder', () => {
        const rulesFolder = path.join(testDir, '.github', 'cr-rules');
        fs.mkdirSync(rulesFolder, { recursive: true });

        // No rules initially
        let files = glob('**/*.md', rulesFolder);
        assert.strictEqual(files.length, 0);

        // Add a rule
        fs.writeFileSync(path.join(rulesFolder, '01-naming.md'), '# Naming');
        files = glob('**/*.md', rulesFolder);
        assert.strictEqual(files.length, 1);
    });
});

suite('Rule Loading', () => {
    let testDir: string;

    setup(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-rules-test-'));
    });

    teardown(() => {
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('loads rules in alphabetical order', () => {
        fs.writeFileSync(path.join(testDir, '03-security.md'), '# Security');
        fs.writeFileSync(path.join(testDir, '01-naming.md'), '# Naming');
        fs.writeFileSync(path.join(testDir, '02-formatting.md'), '# Formatting');

        const files = glob('**/*.md', testDir);
        files.sort();

        assert.strictEqual(files.length, 3);
        assert.ok(files[0].endsWith('01-naming.md'));
        assert.ok(files[1].endsWith('02-formatting.md'));
        assert.ok(files[2].endsWith('03-security.md'));
    });

    test('loads rule content correctly', () => {
        const content = '# Naming Conventions\n\nUse camelCase for variables.';
        fs.writeFileSync(path.join(testDir, 'naming.md'), content);

        const files = glob('**/*.md', testDir);
        assert.strictEqual(files.length, 1);

        const loadedContent = fs.readFileSync(files[0], 'utf-8');
        assert.strictEqual(loadedContent, content);
    });

    test('handles nested rule files', () => {
        const subDir = path.join(testDir, 'category');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(testDir, 'general.md'), '# General');
        fs.writeFileSync(path.join(subDir, 'specific.md'), '# Specific');

        const files = glob('**/*.md', testDir);
        files.sort();

        assert.strictEqual(files.length, 2);
    });
});

suite('Metadata Types', () => {
    test('CodeReviewMetadata for commit has all fields', () => {
        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc123',
            commitMessage: 'test commit',
            rulesUsed: ['rule1.md', 'rule2.md'],
            diffStats: { files: 1, additions: 10, deletions: 5 }
        };

        assert.strictEqual(metadata.type, 'commit');
        assert.strictEqual(metadata.commitSha, 'abc123');
        assert.strictEqual(metadata.commitMessage, 'test commit');
        assert.strictEqual(metadata.rulesUsed.length, 2);
        assert.ok(metadata.diffStats);
        assert.strictEqual(metadata.diffStats.files, 1);
    });

    test('CodeReviewMetadata for pending has minimal fields', () => {
        const metadata: CodeReviewMetadata = {
            type: 'pending',
            rulesUsed: []
        };

        assert.strictEqual(metadata.type, 'pending');
        assert.strictEqual(metadata.commitSha, undefined);
        assert.strictEqual(metadata.commitMessage, undefined);
        assert.strictEqual(metadata.rulesUsed.length, 0);
    });
});

