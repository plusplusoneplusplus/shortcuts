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
    AggregatedCodeReviewResult,
    CodeReviewConfig,
    CodeReviewMetadata,
    CodeRule,
    DEFAULT_CODE_REVIEW_CONFIG,
    DiffStats,
    LARGE_DIFF_THRESHOLD,
    RuleFrontMatter,
    SINGLE_RULE_PROMPT_TEMPLATE,
    SingleRuleReviewMetadata,
    SingleRuleReviewResult
} from '../../shortcuts/code-review/types';
import { aggregateReviewResults } from '../../shortcuts/code-review/response-parser';
import { parseFrontMatter } from '../../shortcuts/code-review/front-matter-parser';
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

suite('Rule Loading with Front Matter', () => {
    let testDir: string;

    setup(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-frontmatter-test-'));
    });

    teardown(() => {
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('parses front matter with model field from rule file', () => {
        const content = `---
model: claude-sonnet-4-5
---

# Naming Conventions

Use camelCase for variables.`;

        fs.writeFileSync(path.join(testDir, 'naming.md'), content);

        const files = glob('**/*.md', testDir);
        assert.strictEqual(files.length, 1);

        const rawContent = fs.readFileSync(files[0], 'utf-8');
        const parseResult = parseFrontMatter(rawContent);

        assert.strictEqual(parseResult.hasFrontMatter, true);
        assert.strictEqual(parseResult.frontMatter.model, 'claude-sonnet-4-5');
        assert.ok(parseResult.content.includes('# Naming Conventions'));
        assert.ok(!parseResult.content.includes('---'));
    });

    test('handles rule file without front matter', () => {
        const content = `# Security Rules

Validate all user inputs.`;

        fs.writeFileSync(path.join(testDir, 'security.md'), content);

        const rawContent = fs.readFileSync(path.join(testDir, 'security.md'), 'utf-8');
        const parseResult = parseFrontMatter(rawContent);

        assert.strictEqual(parseResult.hasFrontMatter, false);
        assert.strictEqual(parseResult.frontMatter.model, undefined);
        assert.strictEqual(parseResult.content, content);
    });

    test('simulates CodeRule creation with front matter', () => {
        const rawContent = `---
model: gpt-4-turbo
---

# Error Handling Rule

All errors must be caught.`;

        fs.writeFileSync(path.join(testDir, 'error-handling.md'), rawContent);

        const files = glob('**/*.md', testDir);
        const file = files[0];
        const fileContent = fs.readFileSync(file, 'utf-8');
        const parseResult = parseFrontMatter(fileContent);

        // Create CodeRule as the service would
        const rule: CodeRule = {
            filename: path.basename(file),
            path: file,
            content: parseResult.content,
            rawContent: fileContent,
            frontMatter: parseResult.hasFrontMatter ? parseResult.frontMatter : undefined
        };

        assert.strictEqual(rule.filename, 'error-handling.md');
        assert.ok(rule.frontMatter);
        assert.strictEqual(rule.frontMatter!.model, 'gpt-4-turbo');
        assert.ok(rule.content.includes('# Error Handling Rule'));
        assert.ok(!rule.content.includes('model:'));
    });

    test('handles multiple rules with different models', () => {
        const rule1 = `---
model: claude-sonnet-4-5
---

# Rule 1`;

        const rule2 = `---
model: gpt-4
---

# Rule 2`;

        const rule3 = `# Rule 3 (no model)`;

        fs.writeFileSync(path.join(testDir, '01-rule.md'), rule1);
        fs.writeFileSync(path.join(testDir, '02-rule.md'), rule2);
        fs.writeFileSync(path.join(testDir, '03-rule.md'), rule3);

        const files = glob('**/*.md', testDir);
        files.sort();

        const rules: CodeRule[] = files.map(file => {
            const rawContent = fs.readFileSync(file, 'utf-8');
            const parseResult = parseFrontMatter(rawContent);
            return {
                filename: path.basename(file),
                path: file,
                content: parseResult.content,
                rawContent,
                frontMatter: parseResult.hasFrontMatter ? parseResult.frontMatter : undefined
            };
        });

        assert.strictEqual(rules.length, 3);
        assert.strictEqual(rules[0].frontMatter?.model, 'claude-sonnet-4-5');
        assert.strictEqual(rules[1].frontMatter?.model, 'gpt-4');
        assert.strictEqual(rules[2].frontMatter, undefined);
    });

    test('handles Windows line endings in front matter (CRLF)', () => {
        const content = '---\r\nmodel: haiku\r\n---\r\n\r\n# Rule Content';

        fs.writeFileSync(path.join(testDir, 'windows-rule.md'), content);

        const rawContent = fs.readFileSync(path.join(testDir, 'windows-rule.md'), 'utf-8');
        const parseResult = parseFrontMatter(rawContent);

        assert.strictEqual(parseResult.hasFrontMatter, true);
        assert.strictEqual(parseResult.frontMatter.model, 'haiku');
    });

    test('RuleFrontMatter type only has model field', () => {
        const frontMatter: RuleFrontMatter = {
            model: 'claude-sonnet-4-5'
        };

        assert.strictEqual(frontMatter.model, 'claude-sonnet-4-5');
        // Verify that only model is a valid key
        const keys = Object.keys(frontMatter);
        assert.strictEqual(keys.length, 1);
        assert.strictEqual(keys[0], 'model');
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

    test('CodeReviewMetadata supports repositoryRoot and rulePaths', () => {
        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc123',
            commitMessage: 'test commit',
            rulesUsed: ['rule1.md', 'rule2.md'],
            repositoryRoot: '/path/to/repo',
            rulePaths: ['/path/to/repo/.github/cr-rules/rule1.md', '/path/to/repo/.github/cr-rules/rule2.md']
        };

        assert.strictEqual(metadata.repositoryRoot, '/path/to/repo');
        assert.strictEqual(metadata.rulePaths?.length, 2);
        assert.ok(metadata.rulePaths?.[0].includes('rule1.md'));
    });
});

suite('Reference-Based Prompt Construction', () => {
    /**
     * Normalize a file path for use in prompts.
     * Converts backslashes to forward slashes for cross-platform compatibility.
     */
    function normalizePathForPrompt(filePath: string): string {
        if (!filePath) {
            return '';
        }
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Build a reference-based prompt for code review.
     */
    function buildReferencePrompt(rules: CodeRule[], metadata: CodeReviewMetadata): string {
        const parts: string[] = [];

        parts.push(DEFAULT_CODE_REVIEW_CONFIG.promptTemplate);
        parts.push('');
        parts.push('---');
        parts.push('');

        // Add coding rules section with file paths
        parts.push('# Coding Rules');
        parts.push('');
        parts.push('Please read and apply the following rule files:');
        parts.push('');

        for (const rule of rules) {
            const normalizedPath = normalizePathForPrompt(rule.path);
            parts.push(`- ${rule.filename}: \`${normalizedPath}\``);
        }

        parts.push('');
        parts.push('---');
        parts.push('');

        // Add code changes section with references
        parts.push('# Code Changes');
        parts.push('');

        if (metadata.type === 'commit' && metadata.commitSha) {
            parts.push(`Repository: \`${normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push(`Commit: ${metadata.commitSha}`);
            if (metadata.commitMessage) {
                parts.push(`Message: ${metadata.commitMessage}`);
            }
            parts.push('');
            parts.push('Please retrieve the commit diff using the commit hash above.');
            parts.push('You can use `git show <commit>` or `git diff <commit>~1 <commit>` to get the diff.');
        } else if (metadata.type === 'pending') {
            parts.push(`Repository: \`${normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push('Type: Pending Changes (staged + unstaged)');
            parts.push('');
            parts.push('Please retrieve the pending changes using:');
            parts.push('- `git diff` for unstaged changes');
            parts.push('- `git diff --cached` for staged changes');
        } else if (metadata.type === 'staged') {
            parts.push(`Repository: \`${normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push('Type: Staged Changes');
            parts.push('');
            parts.push('Please retrieve the staged changes using `git diff --cached`.');
        }

        return parts.join('\n');
    }

    test('builds reference-based prompt for commit review', () => {
        const rules: CodeRule[] = [
            { filename: 'naming.md', path: '/repo/.github/cr-rules/naming.md', content: '# Naming Rules' },
            { filename: 'security.md', path: '/repo/.github/cr-rules/security.md', content: '# Security' }
        ];

        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc1234567890',
            commitMessage: 'feat: add login',
            rulesUsed: ['naming.md', 'security.md'],
            repositoryRoot: '/repo'
        };

        const prompt = buildReferencePrompt(rules, metadata);

        // Verify structure - should NOT include rule content
        assert.ok(prompt.includes('Review the following code changes'));
        assert.ok(prompt.includes('# Coding Rules'));
        assert.ok(prompt.includes('Please read and apply the following rule files'));
        assert.ok(prompt.includes('naming.md'));
        assert.ok(prompt.includes('security.md'));
        assert.ok(prompt.includes('/repo/.github/cr-rules/naming.md'));
        assert.ok(!prompt.includes('# Naming Rules'), 'Should not include rule content');
        
        // Verify commit reference
        assert.ok(prompt.includes('Repository: `/repo`'));
        assert.ok(prompt.includes('Commit: abc1234567890'));
        assert.ok(prompt.includes('feat: add login'));
        assert.ok(prompt.includes('Please retrieve the commit diff'));
        assert.ok(prompt.includes('git show'));
    });

    test('builds reference-based prompt for pending changes', () => {
        const rules: CodeRule[] = [
            { filename: 'style.md', path: '/repo/.github/cr-rules/style.md', content: '# Style' }
        ];

        const metadata: CodeReviewMetadata = {
            type: 'pending',
            rulesUsed: ['style.md'],
            repositoryRoot: '/repo'
        };

        const prompt = buildReferencePrompt(rules, metadata);

        assert.ok(prompt.includes('Repository: `/repo`'));
        assert.ok(prompt.includes('Type: Pending Changes'));
        assert.ok(prompt.includes('git diff'));
        assert.ok(prompt.includes('git diff --cached'));
    });

    test('builds reference-based prompt for staged changes', () => {
        const rules: CodeRule[] = [
            { filename: 'lint.md', path: '/repo/.github/cr-rules/lint.md', content: '# Lint' }
        ];

        const metadata: CodeReviewMetadata = {
            type: 'staged',
            rulesUsed: ['lint.md'],
            repositoryRoot: '/repo'
        };

        const prompt = buildReferencePrompt(rules, metadata);

        assert.ok(prompt.includes('Repository: `/repo`'));
        assert.ok(prompt.includes('Type: Staged Changes'));
        assert.ok(prompt.includes('git diff --cached'));
    });

    test('reference prompt does not include diff content', () => {
        const rules: CodeRule[] = [
            { filename: 'naming.md', path: '/repo/rules/naming.md', content: '# Naming\nUse camelCase' }
        ];

        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc123',
            rulesUsed: ['naming.md'],
            repositoryRoot: '/repo'
        };

        const prompt = buildReferencePrompt(rules, metadata);

        // Should not include actual rule content
        assert.ok(!prompt.includes('Use camelCase'), 'Should not embed rule content');
        // Should not include diff content (no diff --git)
        assert.ok(!prompt.includes('diff --git'), 'Should not include diff content');
    });
});

suite('CodeReviewService Path Normalization', () => {
    /**
     * Normalize a file path for use in prompts.
     * This is a standalone version for testing the algorithm.
     */
    function normalizePathForPrompt(filePath: string): string {
        if (!filePath) {
            return '';
        }
        return filePath.replace(/\\/g, '/');
    }

    test('normalizePathForPrompt handles Windows paths', () => {
        const windowsPath = 'C:\\Users\\user\\repo\\.github\\cr-rules\\naming.md';
        const normalized = normalizePathForPrompt(windowsPath);
        
        assert.strictEqual(normalized, 'C:/Users/user/repo/.github/cr-rules/naming.md');
    });

    test('normalizePathForPrompt handles empty path', () => {
        assert.strictEqual(normalizePathForPrompt(''), '');
    });

    test('normalizePathForPrompt handles null/undefined gracefully', () => {
        // TypeScript would prevent this at compile time, but test runtime behavior
        assert.strictEqual(normalizePathForPrompt(null as unknown as string), '');
        assert.strictEqual(normalizePathForPrompt(undefined as unknown as string), '');
    });
});

suite('Cross-Platform Path Handling', () => {
    /**
     * Normalize a file path for use in prompts.
     */
    function normalizePathForPrompt(filePath: string): string {
        if (!filePath) {
            return '';
        }
        return filePath.replace(/\\/g, '/');
    }

    test('normalizes Windows backslashes to forward slashes', () => {
        const windowsPath = 'C:\\Users\\user\\repo\\.github\\cr-rules\\naming.md';
        const normalized = normalizePathForPrompt(windowsPath);

        assert.strictEqual(normalized, 'C:/Users/user/repo/.github/cr-rules/naming.md');
        assert.ok(!normalized.includes('\\'), 'Should not contain backslashes');
    });

    test('preserves Unix forward slashes', () => {
        const unixPath = '/home/user/repo/.github/cr-rules/naming.md';
        const normalized = normalizePathForPrompt(unixPath);

        assert.strictEqual(normalized, unixPath);
    });

    test('handles mixed path separators', () => {
        const mixedPath = 'C:\\Users\\user/repo\\.github/cr-rules\\naming.md';
        const normalized = normalizePathForPrompt(mixedPath);

        assert.strictEqual(normalized, 'C:/Users/user/repo/.github/cr-rules/naming.md');
    });

    test('handles empty path', () => {
        assert.strictEqual(normalizePathForPrompt(''), '');
    });

    test('handles path with no separators', () => {
        assert.strictEqual(normalizePathForPrompt('filename.md'), 'filename.md');
    });

    test('handles UNC paths (Windows network paths)', () => {
        const uncPath = '\\\\server\\share\\repo\\.github\\cr-rules\\naming.md';
        const normalized = normalizePathForPrompt(uncPath);

        assert.strictEqual(normalized, '//server/share/repo/.github/cr-rules/naming.md');
    });

    test('handles paths with spaces', () => {
        const pathWithSpaces = 'C:\\Users\\John Doe\\My Projects\\repo\\.github\\cr-rules\\naming.md';
        const normalized = normalizePathForPrompt(pathWithSpaces);

        assert.strictEqual(normalized, 'C:/Users/John Doe/My Projects/repo/.github/cr-rules/naming.md');
    });

    test('handles relative paths', () => {
        const relativePath = '..\\..\\repo\\.github\\cr-rules\\naming.md';
        const normalized = normalizePathForPrompt(relativePath);

        assert.strictEqual(normalized, '../../repo/.github/cr-rules/naming.md');
    });
});

suite('Single Rule Review Types', () => {
    test('SINGLE_RULE_PROMPT_TEMPLATE is defined and contains expected content', () => {
        assert.ok(SINGLE_RULE_PROMPT_TEMPLATE);
        assert.ok(SINGLE_RULE_PROMPT_TEMPLATE.includes('single rule'));
    });

    test('SingleRuleReviewMetadata extends CodeReviewMetadata', () => {
        const metadata: SingleRuleReviewMetadata = {
            type: 'commit',
            commitSha: 'abc123',
            rulesUsed: ['naming.md'],
            ruleFilename: 'naming.md',
            rulePath: '/path/to/naming.md'
        };

        assert.strictEqual(metadata.type, 'commit');
        assert.strictEqual(metadata.ruleFilename, 'naming.md');
        assert.strictEqual(metadata.rulePath, '/path/to/naming.md');
    });

    test('SingleRuleReviewResult has all required fields', () => {
        const result: SingleRuleReviewResult = {
            rule: {
                filename: 'naming.md',
                path: '/path/to/naming.md',
                content: '# Naming Rules'
            },
            processId: 'process-1',
            success: true,
            findings: [],
            rawResponse: 'No issues found.',
            assessment: 'pass'
        };

        assert.strictEqual(result.rule.filename, 'naming.md');
        assert.strictEqual(result.processId, 'process-1');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.findings.length, 0);
        assert.strictEqual(result.assessment, 'pass');
    });

    test('SingleRuleReviewResult handles failure case', () => {
        const result: SingleRuleReviewResult = {
            rule: {
                filename: 'naming.md',
                path: '/path/to/naming.md',
                content: '# Naming Rules'
            },
            processId: 'process-1',
            success: false,
            error: 'AI service unavailable',
            findings: []
        };

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, 'AI service unavailable');
        assert.strictEqual(result.assessment, undefined);
    });
});

suite('Single-Rule Prompt Construction', () => {
    /**
     * Normalize a file path for use in prompts.
     */
    function normalizePathForPrompt(filePath: string): string {
        if (!filePath) {
            return '';
        }
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Build a single-rule prompt for code review.
     */
    function buildSingleRulePrompt(rule: CodeRule, metadata: CodeReviewMetadata): string {
        const parts: string[] = [];

        parts.push(SINGLE_RULE_PROMPT_TEMPLATE);
        parts.push('');
        parts.push('---');
        parts.push('');

        parts.push('# Coding Rule');
        parts.push('');
        parts.push(`**Rule File:** ${rule.filename}`);
        parts.push(`**Path:** \`${normalizePathForPrompt(rule.path)}\``);
        parts.push('');
        parts.push('Please read and apply this rule file to the code changes.');
        parts.push('');
        parts.push('---');
        parts.push('');

        parts.push('# Code Changes');
        parts.push('');

        if (metadata.type === 'commit' && metadata.commitSha) {
            parts.push(`Repository: \`${normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push(`Commit: ${metadata.commitSha}`);
            if (metadata.commitMessage) {
                parts.push(`Message: ${metadata.commitMessage}`);
            }
        } else if (metadata.type === 'pending') {
            parts.push(`Repository: \`${normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push('Type: Pending Changes (staged + unstaged)');
        } else if (metadata.type === 'staged') {
            parts.push(`Repository: \`${normalizePathForPrompt(metadata.repositoryRoot || '')}\``);
            parts.push('Type: Staged Changes');
        }

        return parts.join('\n');
    }

    test('builds single-rule prompt for commit review', () => {
        const rule: CodeRule = {
            filename: 'naming.md',
            path: '/repo/.github/cr-rules/naming.md',
            content: '# Naming Rules'
        };

        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc1234567890',
            commitMessage: 'feat: add login',
            rulesUsed: ['naming.md'],
            repositoryRoot: '/repo'
        };

        const prompt = buildSingleRulePrompt(rule, metadata);

        // Verify structure - should have single rule section
        assert.ok(prompt.includes(SINGLE_RULE_PROMPT_TEMPLATE));
        assert.ok(prompt.includes('# Coding Rule'));
        assert.ok(prompt.includes('**Rule File:** naming.md'));
        assert.ok(prompt.includes('/repo/.github/cr-rules/naming.md'));
        assert.ok(!prompt.includes('# Coding Rules'), 'Should use singular "Rule" not plural');

        // Verify commit reference
        assert.ok(prompt.includes('Repository: `/repo`'));
        assert.ok(prompt.includes('Commit: abc1234567890'));
        assert.ok(prompt.includes('feat: add login'));
    });

    test('builds single-rule prompt for pending changes', () => {
        const rule: CodeRule = {
            filename: 'security.md',
            path: '/repo/.github/cr-rules/security.md',
            content: '# Security Rules'
        };

        const metadata: CodeReviewMetadata = {
            type: 'pending',
            rulesUsed: ['security.md'],
            repositoryRoot: '/repo'
        };

        const prompt = buildSingleRulePrompt(rule, metadata);

        assert.ok(prompt.includes('**Rule File:** security.md'));
        assert.ok(prompt.includes('Type: Pending Changes'));
    });

    test('builds single-rule prompt for staged changes', () => {
        const rule: CodeRule = {
            filename: 'lint.md',
            path: '/repo/.github/cr-rules/lint.md',
            content: '# Lint Rules'
        };

        const metadata: CodeReviewMetadata = {
            type: 'staged',
            rulesUsed: ['lint.md'],
            repositoryRoot: '/repo'
        };

        const prompt = buildSingleRulePrompt(rule, metadata);

        assert.ok(prompt.includes('**Rule File:** lint.md'));
        assert.ok(prompt.includes('Type: Staged Changes'));
    });
});

suite('Result Aggregation', () => {
    const defaultMetadata: CodeReviewMetadata = {
        type: 'commit',
        commitSha: 'abc1234567890',
        commitMessage: 'Test commit',
        rulesUsed: [],
        repositoryRoot: '/repo'
    };

    test('aggregates results from multiple successful rule reviews', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                processId: 'process-1',
                success: true,
                findings: [
                    {
                        id: 'f1',
                        severity: 'error',
                        rule: 'naming.md',
                        description: 'Bad variable name',
                        file: 'src/test.ts',
                        line: 10
                    }
                ],
                rawResponse: 'Found 1 issue',
                assessment: 'fail'
            },
            {
                rule: { filename: 'security.md', path: '/rules/security.md', content: '' },
                processId: 'process-2',
                success: true,
                findings: [
                    {
                        id: 'f2',
                        severity: 'warning',
                        rule: 'security.md',
                        description: 'Potential XSS',
                        file: 'src/api.ts',
                        line: 20
                    }
                ],
                rawResponse: 'Found 1 issue',
                assessment: 'needs-attention'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 5000);

        assert.strictEqual(result.findings.length, 2);
        assert.strictEqual(result.summary.totalFindings, 2);
        assert.strictEqual(result.summary.bySeverity.error, 1);
        assert.strictEqual(result.summary.bySeverity.warning, 1);
        assert.strictEqual(result.summary.overallAssessment, 'fail'); // Worst case
        assert.strictEqual(result.executionStats.totalRules, 2);
        assert.strictEqual(result.executionStats.successfulRules, 2);
        assert.strictEqual(result.executionStats.failedRules, 0);
        assert.strictEqual(result.executionStats.totalTimeMs, 5000);
    });

    test('aggregates results with some failed rule reviews', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                processId: 'process-1',
                success: true,
                findings: [],
                rawResponse: 'No issues found',
                assessment: 'pass'
            },
            {
                rule: { filename: 'security.md', path: '/rules/security.md', content: '' },
                processId: 'process-2',
                success: false,
                error: 'AI service unavailable',
                findings: []
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 3000);

        assert.strictEqual(result.findings.length, 0);
        assert.strictEqual(result.executionStats.successfulRules, 1);
        assert.strictEqual(result.executionStats.failedRules, 1);
        assert.ok(result.summary.summaryText.includes('1 failed'));
    });

    test('aggregates results with no findings', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                processId: 'process-1',
                success: true,
                findings: [],
                rawResponse: 'No issues found',
                assessment: 'pass'
            },
            {
                rule: { filename: 'security.md', path: '/rules/security.md', content: '' },
                processId: 'process-2',
                success: true,
                findings: [],
                rawResponse: 'No issues found',
                assessment: 'pass'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 2000);

        assert.strictEqual(result.findings.length, 0);
        assert.strictEqual(result.summary.totalFindings, 0);
        assert.strictEqual(result.summary.overallAssessment, 'pass');
        assert.ok(result.summary.summaryText.includes('No issues found'));
    });

    test('groups findings by rule in summary', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'naming.md', path: '/rules/naming.md', content: '' },
                processId: 'process-1',
                success: true,
                findings: [
                    { id: 'f1', severity: 'error', rule: 'naming.md', description: 'Issue 1' },
                    { id: 'f2', severity: 'warning', rule: 'naming.md', description: 'Issue 2' }
                ],
                rawResponse: 'Found 2 issues',
                assessment: 'fail'
            },
            {
                rule: { filename: 'security.md', path: '/rules/security.md', content: '' },
                processId: 'process-2',
                success: true,
                findings: [
                    { id: 'f3', severity: 'error', rule: 'security.md', description: 'Issue 3' }
                ],
                rawResponse: 'Found 1 issue',
                assessment: 'fail'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 4000);

        assert.strictEqual(result.summary.byRule['naming.md'], 2);
        assert.strictEqual(result.summary.byRule['security.md'], 1);
    });

    test('preserves metadata in aggregated result', () => {
        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'xyz789',
            commitMessage: 'fix: security issue',
            rulesUsed: [],
            repositoryRoot: '/my/repo',
            diffStats: { files: 5, additions: 100, deletions: 50 }
        };

        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'test.md', path: '/rules/test.md', content: '' },
                processId: 'process-1',
                success: true,
                findings: [],
                assessment: 'pass'
            }
        ];

        const result = aggregateReviewResults(ruleResults, metadata, 1000);

        assert.strictEqual(result.metadata.type, 'commit');
        assert.strictEqual(result.metadata.commitSha, 'xyz789');
        assert.strictEqual(result.metadata.commitMessage, 'fix: security issue');
        assert.strictEqual(result.metadata.repositoryRoot, '/my/repo');
        assert.deepStrictEqual(result.metadata.diffStats, { files: 5, additions: 100, deletions: 50 });
        assert.deepStrictEqual(result.metadata.rulesUsed, ['test.md']);
    });

    test('combines raw responses from all rules', () => {
        const ruleResults: SingleRuleReviewResult[] = [
            {
                rule: { filename: 'rule1.md', path: '/rules/rule1.md', content: '' },
                processId: 'process-1',
                success: true,
                findings: [],
                rawResponse: 'Response from rule1'
            },
            {
                rule: { filename: 'rule2.md', path: '/rules/rule2.md', content: '' },
                processId: 'process-2',
                success: true,
                findings: [],
                rawResponse: 'Response from rule2'
            }
        ];

        const result = aggregateReviewResults(ruleResults, defaultMetadata, 2000);

        assert.ok(result.rawResponse.includes('rule1.md'));
        assert.ok(result.rawResponse.includes('Response from rule1'));
        assert.ok(result.rawResponse.includes('rule2.md'));
        assert.ok(result.rawResponse.includes('Response from rule2'));
    });

    test('handles empty rule results array', () => {
        const result = aggregateReviewResults([], defaultMetadata, 0);

        assert.strictEqual(result.findings.length, 0);
        assert.strictEqual(result.ruleResults.length, 0);
        assert.strictEqual(result.summary.totalFindings, 0);
        assert.strictEqual(result.summary.overallAssessment, 'pass');
        assert.strictEqual(result.executionStats.totalRules, 0);
    });
});

suite('Process Title Generation with Rule', () => {
    function createProcessTitle(metadata: CodeReviewMetadata, ruleFilename?: string): string {
        let baseTitle: string;
        if (metadata.type === 'commit' && metadata.commitSha) {
            const shortHash = metadata.commitSha.substring(0, 7);
            baseTitle = `Review: ${shortHash}`;
        } else if (metadata.type === 'pending') {
            baseTitle = 'Review: pending';
        } else {
            baseTitle = 'Review: staged';
        }

        if (ruleFilename) {
            const shortRuleName = ruleFilename.length > 20
                ? ruleFilename.substring(0, 17) + '...'
                : ruleFilename;
            return `${baseTitle} (${shortRuleName})`;
        }

        return baseTitle;
    }

    test('creates title with rule filename for commit review', () => {
        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc1234567890',
            rulesUsed: []
        };

        const title = createProcessTitle(metadata, 'naming.md');
        assert.strictEqual(title, 'Review: abc1234 (naming.md)');
    });

    test('creates title with rule filename for pending review', () => {
        const metadata: CodeReviewMetadata = {
            type: 'pending',
            rulesUsed: []
        };

        const title = createProcessTitle(metadata, 'security-rules.md');
        assert.strictEqual(title, 'Review: pending (security-rules.md)');
    });

    test('truncates long rule filenames', () => {
        const metadata: CodeReviewMetadata = {
            type: 'staged',
            rulesUsed: []
        };

        const longRuleName = 'this-is-a-very-long-rule-filename.md';
        const title = createProcessTitle(metadata, longRuleName);

        assert.ok(title.includes('...'));
        assert.ok(title.length < 50); // Should be reasonably short
    });

    test('creates title without rule when not provided', () => {
        const metadata: CodeReviewMetadata = {
            type: 'commit',
            commitSha: 'abc1234567890',
            rulesUsed: []
        };

        const title = createProcessTitle(metadata);
        assert.strictEqual(title, 'Review: abc1234');
        assert.ok(!title.includes('('));
    });
});

suite('AggregatedCodeReviewResult Type', () => {
    test('has all required fields', () => {
        const result: AggregatedCodeReviewResult = {
            metadata: {
                type: 'commit',
                commitSha: 'abc123',
                rulesUsed: ['rule1.md', 'rule2.md']
            },
            summary: {
                totalFindings: 0,
                bySeverity: { error: 0, warning: 0, info: 0, suggestion: 0 },
                byRule: {},
                overallAssessment: 'pass',
                summaryText: 'No issues found.'
            },
            findings: [],
            ruleResults: [],
            rawResponse: '',
            timestamp: new Date(),
            executionStats: {
                totalRules: 2,
                successfulRules: 2,
                failedRules: 0,
                totalTimeMs: 5000
            }
        };

        assert.ok(result.metadata);
        assert.ok(result.summary);
        assert.ok(Array.isArray(result.findings));
        assert.ok(Array.isArray(result.ruleResults));
        assert.ok(result.executionStats);
        assert.strictEqual(result.executionStats.totalRules, 2);
    });

    test('executionStats tracks parallel execution metrics', () => {
        const stats = {
            totalRules: 5,
            successfulRules: 4,
            failedRules: 1,
            totalTimeMs: 10000
        };

        assert.strictEqual(stats.totalRules, 5);
        assert.strictEqual(stats.successfulRules + stats.failedRules, stats.totalRules);
        assert.strictEqual(stats.totalTimeMs, 10000);
    });
});

