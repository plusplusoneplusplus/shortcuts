/**
 * Run Command Tests
 *
 * Tests for pipeline execution, progress handling, and result formatting.
 * Note: These tests use dry-run mode since actual AI is not available in test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executeRun } from '../../src/commands/run';
import type { RunCommandOptions } from '../../src/commands/run';
import { setColorEnabled } from '../../src/logger';

// Mock process.exit to prevent tests from actually exiting
const originalExit = process.exit;

describe('Run Command', () => {
    let tmpDir: string;
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;

    const defaultOptions: RunCommandOptions = {
        output: 'json',
        params: {},
        verbose: false,
        dryRun: true, // Always dry-run in tests
        noColor: true,
        approvePermissions: false,
    };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-cli-run-'));
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        setColorEnabled(false);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        stderrSpy.mockRestore();
        stdoutSpy.mockRestore();
        setColorEnabled(true);
    });

    // ========================================================================
    // Helper
    // ========================================================================

    function createPipeline(yaml: string, files?: Record<string, string>): string {
        const dir = path.join(tmpDir, 'pipeline');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pipeline.yaml'), yaml);
        if (files) {
            for (const [name, content] of Object.entries(files)) {
                fs.writeFileSync(path.join(dir, name), content);
            }
        }
        return path.join(dir, 'pipeline.yaml');
    }

    // ========================================================================
    // Path Resolution
    // ========================================================================

    describe('Path resolution', () => {
        it('should return 2 for non-existent pipeline file', async () => {
            const exitCode = await executeRun(
                path.join(tmpDir, 'nonexistent.yaml'),
                defaultOptions
            );
            expect(exitCode).toBe(2);
        });

        it('should resolve directory to pipeline.yaml', async () => {
            const dir = path.join(tmpDir, 'pipeline');
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'pipeline.yaml'), `
name: "Test"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const exitCode = await executeRun(dir, defaultOptions);
            expect(exitCode).toBe(0);
        });
    });

    // ========================================================================
    // YAML Parsing
    // ========================================================================

    describe('YAML parsing', () => {
        it('should return 2 for invalid YAML', async () => {
            const yamlPath = path.join(tmpDir, 'invalid.yaml');
            fs.writeFileSync(yamlPath, '{{invalid yaml');
            const exitCode = await executeRun(yamlPath, defaultOptions);
            expect(exitCode).toBe(2);
        });

        it('should parse valid pipeline', async () => {
            const yamlPath = createPipeline(`
name: "Valid Pipeline"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const exitCode = await executeRun(yamlPath, defaultOptions);
            expect(exitCode).toBe(0);
        });
    });

    // ========================================================================
    // Dry Run
    // ========================================================================

    describe('Dry run', () => {
        it('should execute in dry-run mode without AI', async () => {
            const yamlPath = createPipeline(`
name: "Dry Run"
input:
  items:
    - title: "Item 1"
    - title: "Item 2"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const exitCode = await executeRun(yamlPath, {
                ...defaultOptions,
                dryRun: true,
            });
            expect(exitCode).toBe(0);
        });

        it('should output results to stdout', async () => {
            const yamlPath = createPipeline(`
name: "Output Test"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            await executeRun(yamlPath, defaultOptions);
            expect(stdoutSpy).toHaveBeenCalled();
        });
    });

    // ========================================================================
    // CLI Overrides
    // ========================================================================

    describe('CLI overrides', () => {
        it('should override model', async () => {
            const yamlPath = createPipeline(`
name: "Model Override"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const exitCode = await executeRun(yamlPath, {
                ...defaultOptions,
                model: 'gpt-4',
            });
            expect(exitCode).toBe(0);
        });

        it('should override parallel', async () => {
            const yamlPath = createPipeline(`
name: "Parallel Override"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const exitCode = await executeRun(yamlPath, {
                ...defaultOptions,
                parallel: 10,
            });
            expect(exitCode).toBe(0);
        });

        it('should add parameters', async () => {
            const yamlPath = createPipeline(`
name: "Params"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Review by {{reviewer}}: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const exitCode = await executeRun(yamlPath, {
                ...defaultOptions,
                params: { reviewer: 'Alice' },
            });
            expect(exitCode).toBe(0);
        });
    });

    // ========================================================================
    // Output File
    // ========================================================================

    describe('Output file', () => {
        it('should write results to output file', async () => {
            const yamlPath = createPipeline(`
name: "File Output"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const outputFile = path.join(tmpDir, 'output', 'results.json');
            const exitCode = await executeRun(yamlPath, {
                ...defaultOptions,
                outputFile,
            });
            expect(exitCode).toBe(0);
            expect(fs.existsSync(outputFile)).toBe(true);
        });

        it('should create output directory if needed', async () => {
            const yamlPath = createPipeline(`
name: "Create Dir"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const outputFile = path.join(tmpDir, 'deep', 'nested', 'results.json');
            const exitCode = await executeRun(yamlPath, {
                ...defaultOptions,
                outputFile,
            });
            expect(exitCode).toBe(0);
            expect(fs.existsSync(outputFile)).toBe(true);
        });
    });

    // ========================================================================
    // Output Formats
    // ========================================================================

    describe('Output formats', () => {
        const pipelineYaml = `
name: "Format Test"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`;

        it('should output json format', async () => {
            const yamlPath = createPipeline(pipelineYaml);
            await executeRun(yamlPath, { ...defaultOptions, output: 'json' });
            expect(stdoutSpy).toHaveBeenCalled();
        });

        it('should output table format', async () => {
            const yamlPath = createPipeline(pipelineYaml);
            await executeRun(yamlPath, { ...defaultOptions, output: 'table' });
            expect(stdoutSpy).toHaveBeenCalled();
        });

        it('should output csv format', async () => {
            const yamlPath = createPipeline(pipelineYaml);
            await executeRun(yamlPath, { ...defaultOptions, output: 'csv' });
            expect(stdoutSpy).toHaveBeenCalled();
        });

        it('should output markdown format', async () => {
            const yamlPath = createPipeline(pipelineYaml);
            await executeRun(yamlPath, { ...defaultOptions, output: 'markdown' });
            expect(stdoutSpy).toHaveBeenCalled();
        });
    });

    // ========================================================================
    // CSV Input
    // ========================================================================

    describe('CSV input', () => {
        it('should execute pipeline with CSV input', async () => {
            const yamlPath = createPipeline(`
name: "CSV Pipeline"
input:
  from:
    type: csv
    path: "data.csv"
map:
  prompt: "Analyze: {{title}}"
  output:
    - severity
reduce:
  type: json
`, { 'data.csv': 'title,description\nBug 1,Fix it\nBug 2,Patch it\n' });

            const exitCode = await executeRun(yamlPath, defaultOptions);
            expect(exitCode).toBe(0);
        });
    });
});
