/**
 * Run Command Persistence Tests
 *
 * Tests for persisting pipeline execution results to the FileProcessStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executeRun } from '../../src/commands/run';
import type { RunCommandOptions } from '../../src/commands/run';
import { setColorEnabled } from '../../src/logger';

describe('Run Command Persistence', () => {
    let tmpDir: string;
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;

    const basePipelineYaml = `
name: "Persistence Test"
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
`;

    function makeOptions(overrides: Partial<RunCommandOptions> = {}): RunCommandOptions {
        return {
            output: 'json',
            params: {},
            verbose: false,
            dryRun: true,
            noColor: true,
            approvePermissions: false,
            persist: true,
            dataDir: path.join(tmpDir, 'store'),
            ...overrides,
        };
    }

    function createPipeline(yaml: string): string {
        const dir = path.join(tmpDir, 'pipeline');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pipeline.yaml'), yaml);
        return path.join(dir, 'pipeline.yaml');
    }

    function readProcesses(): unknown[] {
        const processesFile = path.join(tmpDir, 'store', 'processes.json');
        if (!fs.existsSync(processesFile)) {
            return [];
        }
        return JSON.parse(fs.readFileSync(processesFile, 'utf-8'));
    }

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-persist-'));
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
    // Persistence on successful run
    // ========================================================================

    it('should create process entry in store', async () => {
        const yamlPath = createPipeline(basePipelineYaml);
        const exitCode = await executeRun(yamlPath, makeOptions());
        expect(exitCode).toBe(0);

        const entries = readProcesses();
        expect(entries.length).toBe(1);

        const entry = entries[0] as Record<string, unknown>;
        const proc = entry.process as Record<string, unknown>;
        expect(proc.type).toBe('pipeline-execution');
    });

    // ========================================================================
    // --no-persist flag
    // ========================================================================

    it('should skip store write when persist is false', async () => {
        const yamlPath = createPipeline(basePipelineYaml);
        const exitCode = await executeRun(yamlPath, makeOptions({ persist: false }));
        expect(exitCode).toBe(0);

        const entries = readProcesses();
        expect(entries.length).toBe(0);
    });

    // ========================================================================
    // Correct metadata
    // ========================================================================

    it('should store correct metadata in process entry', async () => {
        const yamlPath = createPipeline(basePipelineYaml);
        const before = Date.now();
        const exitCode = await executeRun(yamlPath, makeOptions());
        const after = Date.now();

        expect(exitCode).toBe(0);

        const entries = readProcesses();
        expect(entries.length).toBe(1);

        const entry = entries[0] as Record<string, unknown>;
        const proc = entry.process as Record<string, unknown>;

        // Verify metadata
        const metadata = proc.metadata as Record<string, unknown>;
        expect(metadata.type).toBe('cli-pipeline');
        expect(metadata.pipelineName).toBe('Persistence Test');
        expect(metadata.itemCount).toBe(2);
        expect(metadata.successCount).toBe(2);
        expect(metadata.failCount).toBe(0);

        // Verify status
        expect(proc.status).toBe('completed');

        // Verify timing
        const startTime = new Date(proc.startTime as string).getTime();
        const endTime = new Date(proc.endTime as string).getTime();
        expect(startTime).toBeGreaterThanOrEqual(before);
        expect(endTime).toBeLessThanOrEqual(after + 1000);
        expect(startTime).toBeLessThanOrEqual(endTime);

        // Verify prompt fields
        expect(proc.promptPreview).toBe('Persistence Test');
        expect((proc.fullPrompt as string)).toContain('pipeline.yaml');
    });

    // ========================================================================
    // Config persist: false
    // ========================================================================

    it('should respect config persist: false (no store write)', async () => {
        const yamlPath = createPipeline(basePipelineYaml);
        const exitCode = await executeRun(yamlPath, makeOptions({ persist: false }));
        expect(exitCode).toBe(0);

        const processesFile = path.join(tmpDir, 'store', 'processes.json');
        expect(fs.existsSync(processesFile)).toBe(false);
    });

    // ========================================================================
    // Persistence failure does not break run
    // ========================================================================

    it('should not fail the run when persistence throws', async () => {
        const yamlPath = createPipeline(basePipelineYaml);
        // Use an invalid dataDir that will cause the store to fail
        const exitCode = await executeRun(yamlPath, makeOptions({
            dataDir: '/dev/null/impossible-path',
        }));
        // Run should still succeed
        expect(exitCode).toBe(0);
        // stdout should still have output
        expect(stdoutSpy).toHaveBeenCalled();
    });

    // ========================================================================
    // Stdout output unchanged with persistence
    // ========================================================================

    it('should not affect stdout output when persistence is enabled', async () => {
        const yamlPath = createPipeline(basePipelineYaml);

        // Run without persistence
        const exitCode1 = await executeRun(yamlPath, makeOptions({ persist: false }));
        const output1 = (stdoutSpy.mock.calls as unknown[][])
            .map(c => String(c[0]))
            .join('');

        stdoutSpy.mockClear();

        // Run with persistence
        const exitCode2 = await executeRun(yamlPath, makeOptions({ persist: true }));
        const output2 = (stdoutSpy.mock.calls as unknown[][])
            .map(c => String(c[0]))
            .join('');

        expect(exitCode1).toBe(0);
        expect(exitCode2).toBe(0);
        expect(output1).toBe(output2);
    });
});
