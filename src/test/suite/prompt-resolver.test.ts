import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    resolvePromptFile,
    resolvePromptFileSync,
    resolvePromptFileWithDetails,
    resolvePromptPath,
    getSearchPaths,
    extractPromptContent,
    promptFileExists,
    validatePromptFile,
    PromptResolverError
} from '@plusplusoneplusplus/pipeline-core';

suite('Prompt Resolver Tests', () => {
    let tempDir: string;
    let pipelineDir: string;
    let pipelinesRoot: string;

    setup(() => {
        // Create temporary directory structure for testing
        // .vscode/pipelines/
        // ├── run-tests/                    # Pipeline package (pipelineDir)
        // │   ├── pipeline.yaml
        // │   ├── analyze.prompt.md         # Prompt in same folder
        // │   └── prompts/                  # Prompts subfolder
        // │       ├── map.prompt.md
        // │       └── reduce.prompt.md
        // ├── shared/                       # Shared across pipelines
        // │   └── prompts/
        // │       └── common-analysis.prompt.md
        // └── prompts/                      # Shared prompts folder at root
        //     └── global.prompt.md

        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-prompt-test-'));
        pipelinesRoot = path.join(tempDir, '.vscode', 'pipelines');
        pipelineDir = path.join(pipelinesRoot, 'run-tests');

        // Create directory structure
        fs.mkdirSync(path.join(pipelineDir, 'prompts'), { recursive: true });
        fs.mkdirSync(path.join(pipelinesRoot, 'shared', 'prompts'), { recursive: true });
        fs.mkdirSync(path.join(pipelinesRoot, 'prompts'), { recursive: true });

        // Create prompt files
        fs.writeFileSync(
            path.join(pipelineDir, 'analyze.prompt.md'),
            'Analyze this bug report:\n\nTitle: {{title}}\nDescription: {{description}}\n\nReturn JSON with severity and category.',
            'utf8'
        );

        fs.writeFileSync(
            path.join(pipelineDir, 'prompts', 'map.prompt.md'),
            'Map prompt content with {{variable}}',
            'utf8'
        );

        fs.writeFileSync(
            path.join(pipelineDir, 'prompts', 'reduce.prompt.md'),
            'Reduce prompt content with {{RESULTS}}',
            'utf8'
        );

        fs.writeFileSync(
            path.join(pipelinesRoot, 'shared', 'prompts', 'common-analysis.prompt.md'),
            'Shared analysis prompt with {{input}}',
            'utf8'
        );

        fs.writeFileSync(
            path.join(pipelinesRoot, 'prompts', 'global.prompt.md'),
            'Global shared prompt',
            'utf8'
        );

        // Create prompt with frontmatter
        fs.writeFileSync(
            path.join(pipelineDir, 'with-frontmatter.prompt.md'),
            `---
version: 1.0
description: Bug analysis prompt
variables: [title, description, priority]
---

Analyze this bug report:

Title: {{title}}
Description: {{description}}
Priority: {{priority}}

Return JSON with severity and category.`,
            'utf8'
        );

        // Create empty prompt file (after frontmatter stripping)
        fs.writeFileSync(
            path.join(pipelineDir, 'empty-after-frontmatter.prompt.md'),
            `---
version: 1.0
---
`,
            'utf8'
        );

        // Create completely empty file
        fs.writeFileSync(
            path.join(pipelineDir, 'empty.prompt.md'),
            '',
            'utf8'
        );
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('getSearchPaths', () => {
        test('should return correct search paths for bare filename', () => {
            const paths = getSearchPaths('analyze.prompt.md', pipelineDir);

            assert.strictEqual(paths.length, 3);
            // 1. Pipeline directory
            assert.strictEqual(paths[0], path.join(pipelineDir, 'analyze.prompt.md'));
            // 2. prompts/ subfolder
            assert.strictEqual(paths[1], path.join(pipelineDir, 'prompts', 'analyze.prompt.md'));
            // 3. Shared prompts at pipelines root
            assert.strictEqual(paths[2], path.join(pipelinesRoot, 'prompts', 'analyze.prompt.md'));
        });

        test('should handle Windows-style paths', () => {
            const paths = getSearchPaths('test.prompt.md', pipelineDir);
            // All paths should be valid for the current platform
            for (const p of paths) {
                assert.ok(path.isAbsolute(p), `Path should be absolute: ${p}`);
            }
        });
    });

    suite('extractPromptContent', () => {
        test('should extract content without frontmatter', () => {
            const content = 'Simple prompt content\nwith multiple lines';
            const result = extractPromptContent(content);

            assert.strictEqual(result.content, content);
            assert.strictEqual(result.hadFrontmatter, false);
        });

        test('should strip frontmatter and extract content', () => {
            const content = `---
version: 1.0
description: Test prompt
---

Actual prompt content here.`;

            const result = extractPromptContent(content);

            assert.strictEqual(result.content, 'Actual prompt content here.');
            assert.strictEqual(result.hadFrontmatter, true);
        });

        test('should handle frontmatter with various YAML content', () => {
            const content = `---
version: 1.0
description: Bug analysis prompt
variables:
  - title
  - description
  - priority
tags: [bug, analysis]
---

Multi-line
prompt
content`;

            const result = extractPromptContent(content);

            assert.strictEqual(result.content, 'Multi-line\nprompt\ncontent');
            assert.strictEqual(result.hadFrontmatter, true);
        });

        test('should handle Windows line endings in frontmatter', () => {
            const content = '---\r\nversion: 1.0\r\n---\r\n\r\nPrompt content';
            const result = extractPromptContent(content);

            assert.strictEqual(result.content, 'Prompt content');
            assert.strictEqual(result.hadFrontmatter, true);
        });

        test('should not strip incomplete frontmatter', () => {
            const content = `---
version: 1.0
This is not valid frontmatter because it doesn't close

Actual content`;

            const result = extractPromptContent(content);

            // Should return trimmed original content since frontmatter is not properly closed
            assert.strictEqual(result.hadFrontmatter, false);
        });

        test('should handle empty content', () => {
            const result = extractPromptContent('');
            assert.strictEqual(result.content, '');
            assert.strictEqual(result.hadFrontmatter, false);
        });

        test('should handle whitespace-only content', () => {
            const result = extractPromptContent('   \n\n   ');
            assert.strictEqual(result.content, '');
            assert.strictEqual(result.hadFrontmatter, false);
        });
    });

    suite('resolvePromptPath', () => {
        test('should resolve bare filename from pipeline directory', () => {
            const resolved = resolvePromptPath('analyze.prompt.md', pipelineDir);
            assert.strictEqual(resolved, path.join(pipelineDir, 'analyze.prompt.md'));
        });

        test('should resolve bare filename from prompts subfolder', () => {
            const resolved = resolvePromptPath('map.prompt.md', pipelineDir);
            assert.strictEqual(resolved, path.join(pipelineDir, 'prompts', 'map.prompt.md'));
        });

        test('should resolve bare filename from shared prompts folder', () => {
            const resolved = resolvePromptPath('global.prompt.md', pipelineDir);
            assert.strictEqual(resolved, path.join(pipelinesRoot, 'prompts', 'global.prompt.md'));
        });

        test('should resolve relative path with subfolder', () => {
            const resolved = resolvePromptPath('prompts/map.prompt.md', pipelineDir);
            assert.strictEqual(resolved, path.join(pipelineDir, 'prompts', 'map.prompt.md'));
        });

        test('should resolve parent path to shared folder', () => {
            const resolved = resolvePromptPath('../shared/prompts/common-analysis.prompt.md', pipelineDir);
            assert.strictEqual(resolved, path.join(pipelinesRoot, 'shared', 'prompts', 'common-analysis.prompt.md'));
        });

        test('should resolve absolute path', () => {
            const absolutePath = path.join(pipelineDir, 'analyze.prompt.md');
            const resolved = resolvePromptPath(absolutePath, pipelineDir);
            assert.strictEqual(resolved, absolutePath);
        });

        test('should throw for non-existent bare filename', () => {
            assert.throws(
                () => resolvePromptPath('nonexistent.prompt.md', pipelineDir),
                (error: PromptResolverError) => {
                    assert.ok(error instanceof PromptResolverError);
                    assert.ok(error.message.includes('not found'));
                    assert.ok(error.searchedPaths);
                    assert.strictEqual(error.searchedPaths!.length, 3);
                    return true;
                }
            );
        });

        test('should throw for non-existent relative path', () => {
            assert.throws(
                () => resolvePromptPath('prompts/nonexistent.prompt.md', pipelineDir),
                (error: PromptResolverError) => {
                    assert.ok(error instanceof PromptResolverError);
                    assert.ok(error.message.includes('not found'));
                    return true;
                }
            );
        });

        test('should throw for non-existent absolute path', () => {
            const absolutePath = '/nonexistent/path/prompt.md';
            assert.throws(
                () => resolvePromptPath(absolutePath, pipelineDir),
                (error: PromptResolverError) => {
                    assert.ok(error instanceof PromptResolverError);
                    assert.ok(error.message.includes('not found'));
                    return true;
                }
            );
        });

        test('should use first match when file exists in multiple locations', () => {
            // Create a file in both pipeline dir and prompts subfolder
            const duplicateFilename = 'duplicate.prompt.md';
            fs.writeFileSync(path.join(pipelineDir, duplicateFilename), 'Pipeline dir content', 'utf8');
            fs.writeFileSync(path.join(pipelineDir, 'prompts', duplicateFilename), 'Prompts subfolder content', 'utf8');

            const resolved = resolvePromptPath(duplicateFilename, pipelineDir);
            // Should resolve to pipeline directory (first in search order)
            assert.strictEqual(resolved, path.join(pipelineDir, duplicateFilename));
        });
    });

    suite('resolvePromptFile (async)', () => {
        test('should load prompt content from file', async () => {
            const content = await resolvePromptFile('analyze.prompt.md', pipelineDir);
            assert.ok(content.includes('Analyze this bug report'));
            assert.ok(content.includes('{{title}}'));
        });

        test('should strip frontmatter when loading', async () => {
            const content = await resolvePromptFile('with-frontmatter.prompt.md', pipelineDir);
            assert.ok(!content.includes('---'));
            assert.ok(!content.includes('version: 1.0'));
            assert.ok(content.includes('Analyze this bug report'));
        });

        test('should throw for empty file', async () => {
            await assert.rejects(
                async () => await resolvePromptFile('empty.prompt.md', pipelineDir),
                (error: PromptResolverError) => {
                    assert.ok(error instanceof PromptResolverError);
                    assert.ok(error.message.includes('empty'));
                    return true;
                }
            );
        });

        test('should throw for file empty after frontmatter stripping', async () => {
            await assert.rejects(
                async () => await resolvePromptFile('empty-after-frontmatter.prompt.md', pipelineDir),
                (error: PromptResolverError) => {
                    assert.ok(error instanceof PromptResolverError);
                    assert.ok(error.message.includes('empty'));
                    return true;
                }
            );
        });

        test('should load from prompts subfolder', async () => {
            const content = await resolvePromptFile('prompts/map.prompt.md', pipelineDir);
            assert.ok(content.includes('Map prompt content'));
        });

        test('should load from shared folder using parent path', async () => {
            const content = await resolvePromptFile('../shared/prompts/common-analysis.prompt.md', pipelineDir);
            assert.ok(content.includes('Shared analysis prompt'));
        });
    });

    suite('resolvePromptFileSync', () => {
        test('should load prompt content synchronously', () => {
            const content = resolvePromptFileSync('analyze.prompt.md', pipelineDir);
            assert.ok(content.includes('Analyze this bug report'));
        });

        test('should strip frontmatter when loading synchronously', () => {
            const content = resolvePromptFileSync('with-frontmatter.prompt.md', pipelineDir);
            assert.ok(!content.includes('---'));
            assert.ok(content.includes('Analyze this bug report'));
        });

        test('should throw for empty file synchronously', () => {
            assert.throws(
                () => resolvePromptFileSync('empty.prompt.md', pipelineDir),
                (error: PromptResolverError) => {
                    assert.ok(error instanceof PromptResolverError);
                    assert.ok(error.message.includes('empty'));
                    return true;
                }
            );
        });
    });

    suite('resolvePromptFileWithDetails', () => {
        test('should return full details including resolved path', async () => {
            const result = await resolvePromptFileWithDetails('analyze.prompt.md', pipelineDir);

            assert.ok(result.content.includes('Analyze this bug report'));
            assert.strictEqual(result.resolvedPath, path.join(pipelineDir, 'analyze.prompt.md'));
            assert.strictEqual(result.hadFrontmatter, false);
        });

        test('should indicate when frontmatter was stripped', async () => {
            const result = await resolvePromptFileWithDetails('with-frontmatter.prompt.md', pipelineDir);

            assert.ok(!result.content.includes('---'));
            assert.strictEqual(result.hadFrontmatter, true);
        });
    });

    suite('promptFileExists', () => {
        test('should return true for existing file', () => {
            assert.strictEqual(promptFileExists('analyze.prompt.md', pipelineDir), true);
        });

        test('should return true for file in prompts subfolder', () => {
            assert.strictEqual(promptFileExists('map.prompt.md', pipelineDir), true);
        });

        test('should return false for non-existent file', () => {
            assert.strictEqual(promptFileExists('nonexistent.prompt.md', pipelineDir), false);
        });

        test('should return true for relative path', () => {
            assert.strictEqual(promptFileExists('prompts/map.prompt.md', pipelineDir), true);
        });

        test('should return true for parent path', () => {
            assert.strictEqual(promptFileExists('../shared/prompts/common-analysis.prompt.md', pipelineDir), true);
        });
    });

    suite('validatePromptFile', () => {
        test('should return valid for existing file', () => {
            const result = validatePromptFile('analyze.prompt.md', pipelineDir);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.error, undefined);
        });

        test('should return invalid with error for non-existent file', () => {
            const result = validatePromptFile('nonexistent.prompt.md', pipelineDir);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error);
            assert.ok(result.error.includes('not found'));
            assert.ok(result.searchedPaths);
            assert.strictEqual(result.searchedPaths!.length, 3);
        });

        test('should return valid for relative path', () => {
            const result = validatePromptFile('prompts/map.prompt.md', pipelineDir);
            assert.strictEqual(result.valid, true);
        });
    });

    suite('Cross-platform Path Handling', () => {
        test('should handle forward slashes in paths', () => {
            const resolved = resolvePromptPath('prompts/map.prompt.md', pipelineDir);
            assert.ok(fs.existsSync(resolved));
        });

        test('should handle mixed path separators', () => {
            // Create a path with forward slashes (common in YAML)
            const promptFile = 'prompts/reduce.prompt.md';
            const resolved = resolvePromptPath(promptFile, pipelineDir);
            assert.ok(fs.existsSync(resolved));
        });

        test('should work with paths containing spaces', () => {
            // Create directory and file with spaces
            const spacedDir = path.join(pipelineDir, 'my prompts');
            fs.mkdirSync(spacedDir, { recursive: true });
            fs.writeFileSync(path.join(spacedDir, 'spaced prompt.md'), 'Content with spaces', 'utf8');

            const resolved = resolvePromptPath('my prompts/spaced prompt.md', pipelineDir);
            assert.strictEqual(resolved, path.join(pipelineDir, 'my prompts', 'spaced prompt.md'));
        });
    });

    suite('Integration with Pipeline Execution', () => {
        test('should resolve prompt for typical pipeline structure', async () => {
            // Simulate typical pipeline structure
            const testPipelineDir = path.join(pipelinesRoot, 'test-pipeline');
            fs.mkdirSync(path.join(testPipelineDir, 'prompts'), { recursive: true });

            // Create pipeline.yaml (just for structure, not parsed here)
            fs.writeFileSync(
                path.join(testPipelineDir, 'pipeline.yaml'),
                'name: Test Pipeline\nmap:\n  promptFile: "analyze.prompt.md"',
                'utf8'
            );

            // Create prompt file
            fs.writeFileSync(
                path.join(testPipelineDir, 'analyze.prompt.md'),
                'Analyze {{item}} and return results.',
                'utf8'
            );

            const content = await resolvePromptFile('analyze.prompt.md', testPipelineDir);
            assert.ok(content.includes('Analyze {{item}}'));
        });

        test('should resolve shared prompt across pipelines', async () => {
            // Create two pipelines that share a prompt
            const pipeline1Dir = path.join(pipelinesRoot, 'pipeline1');
            const pipeline2Dir = path.join(pipelinesRoot, 'pipeline2');
            fs.mkdirSync(pipeline1Dir, { recursive: true });
            fs.mkdirSync(pipeline2Dir, { recursive: true });

            // Both should be able to access the shared prompt
            const content1 = await resolvePromptFile('../shared/prompts/common-analysis.prompt.md', pipeline1Dir);
            const content2 = await resolvePromptFile('../shared/prompts/common-analysis.prompt.md', pipeline2Dir);

            assert.strictEqual(content1, content2);
            assert.ok(content1.includes('Shared analysis prompt'));
        });
    });

    suite('Error Messages', () => {
        test('should provide helpful error message with searched paths', () => {
            try {
                resolvePromptPath('missing.prompt.md', pipelineDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof PromptResolverError);
                const message = error.message;
                assert.ok(message.includes('missing.prompt.md'));
                assert.ok(message.includes('Searched paths'));
                // Should list all three search locations
                assert.ok(error.searchedPaths!.length === 3);
            }
        });

        test('should provide clear error for empty file', async () => {
            try {
                await resolvePromptFile('empty.prompt.md', pipelineDir);
                assert.fail('Should have thrown');
            } catch (error) {
                assert.ok(error instanceof PromptResolverError);
                assert.ok(error.message.includes('empty'));
            }
        });
    });
});
