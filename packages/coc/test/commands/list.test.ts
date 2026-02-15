/**
 * List Command Tests
 *
 * Tests for pipeline package discovery and listing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    executeList,
    discoverPipelines,
} from '../../src/commands/list';
import type { PipelinePackageInfo } from '../../src/commands/list';
import { setColorEnabled } from '../../src/logger';

describe('List Command', () => {
    let tmpDir: string;
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-list-'));
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
    // Helper: create a pipeline package
    // ========================================================================

    function createPipeline(name: string, yaml: string, csvName?: string, csvContent?: string): void {
        const dir = path.join(tmpDir, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pipeline.yaml'), yaml);
        if (csvName && csvContent) {
            fs.writeFileSync(path.join(dir, csvName), csvContent);
        }
    }

    // ========================================================================
    // discoverPipelines
    // ========================================================================

    describe('discoverPipelines', () => {
        it('should return empty array for empty directory', () => {
            const result = discoverPipelines(tmpDir);
            expect(result).toEqual([]);
        });

        it('should discover a single pipeline', () => {
            createPipeline('my-pipeline', `
name: "My Pipeline"
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
            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(1);
            expect(result[0].name).toBe('my-pipeline');
            expect(result[0].description).toBe('My Pipeline');
            expect(result[0].inputType).toBe('inline');
            expect(result[0].itemCount).toBe(1);
        });

        it('should discover multiple pipelines', () => {
            createPipeline('pipeline-a', `
name: "Pipeline A"
input:
  items:
    - title: "A1"
    - title: "A2"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            createPipeline('pipeline-b', `
name: "Pipeline B"
input:
  items:
    - title: "B1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(2);
            // Should be sorted alphabetically
            expect(result[0].name).toBe('pipeline-a');
            expect(result[1].name).toBe('pipeline-b');
        });

        it('should detect CSV input with row count', () => {
            createPipeline('csv-pipeline', `
name: "CSV Pipeline"
input:
  from:
    type: csv
    path: "data.csv"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`, 'data.csv', 'title,description\nBug 1,Fix it\nBug 2,Patch it\nBug 3,Test it\n');

            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(1);
            expect(result[0].inputType).toBe('CSV');
            expect(result[0].itemCount).toBe(3);
        });

        it('should detect inline list input', () => {
            createPipeline('fanout', `
name: "Multi Model"
input:
  from:
    - model: gpt-4
    - model: claude
  parameters:
    - name: code
      value: "hello"
map:
  prompt: "Review: {{code}}"
  model: "{{model}}"
  output:
    - result
reduce:
  type: table
`);
            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(1);
            expect(result[0].inputType).toBe('list');
            expect(result[0].itemCount).toBe(2);
        });

        it('should detect generate input', () => {
            createPipeline('generated', `
name: "Generated"
input:
  generate:
    prompt: "Generate 10 test cases"
    schema:
      - testName
      - expected
map:
  prompt: "Run: {{testName}}"
  output:
    - result
reduce:
  type: json
`);
            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(1);
            expect(result[0].inputType).toBe('generate');
            expect(result[0].itemCount).toBeUndefined();
        });

        it('should skip non-directory entries', () => {
            fs.writeFileSync(path.join(tmpDir, 'not-a-dir.txt'), 'hello');
            createPipeline('real-pipeline', `
name: "Real"
input:
  items:
    - title: "Item"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(1);
            expect(result[0].name).toBe('real-pipeline');
        });

        it('should skip directories without pipeline.yaml', () => {
            fs.mkdirSync(path.join(tmpDir, 'no-yaml'));
            fs.writeFileSync(path.join(tmpDir, 'no-yaml', 'readme.md'), 'hello');
            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(0);
        });

        it('should handle invalid pipeline.yaml gracefully', () => {
            const dir = path.join(tmpDir, 'bad-pipeline');
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'pipeline.yaml'), '{{invalid yaml');
            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(1);
            expect(result[0].name).toBe('bad-pipeline');
            expect(result[0].description).toContain('invalid');
        });

        it('should handle missing CSV file gracefully', () => {
            createPipeline('missing-csv', `
name: "Missing CSV"
input:
  from:
    type: csv
    path: "nonexistent.csv"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const result = discoverPipelines(tmpDir);
            expect(result.length).toBe(1);
            expect(result[0].inputType).toBe('CSV');
            expect(result[0].itemCount).toBeUndefined();
        });

        it('should handle non-existent directory', () => {
            const result = discoverPipelines(path.join(tmpDir, 'nonexistent'));
            expect(result).toEqual([]);
        });
    });

    // ========================================================================
    // executeList
    // ========================================================================

    describe('executeList', () => {
        it('should return 0 for valid directory', () => {
            createPipeline('test', `
name: "Test"
input:
  items:
    - title: "Item"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const exitCode = executeList(tmpDir);
            expect(exitCode).toBe(0);
        });

        it('should return 2 for non-existent directory', () => {
            const exitCode = executeList(path.join(tmpDir, 'nonexistent'));
            expect(exitCode).toBe(2);
        });

        it('should return 2 for file instead of directory', () => {
            const filePath = path.join(tmpDir, 'file.txt');
            fs.writeFileSync(filePath, 'not a dir');
            const exitCode = executeList(filePath);
            expect(exitCode).toBe(2);
        });

        it('should return 0 for empty directory with warning', () => {
            const exitCode = executeList(tmpDir);
            expect(exitCode).toBe(0);
            // Should have written a warning to stderr
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should output table format by default', () => {
            createPipeline('test', `
name: "Test"
input:
  items:
    - title: "Item"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            executeList(tmpDir, 'table');
            expect(stdoutSpy).toHaveBeenCalled();
            const output = stdoutSpy.mock.calls[0][0] as string;
            expect(output).toContain('NAME');
        });

        it('should output json format', () => {
            createPipeline('test', `
name: "Test"
input:
  items:
    - title: "Item"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            executeList(tmpDir, 'json');
            expect(stdoutSpy).toHaveBeenCalled();
            const output = stdoutSpy.mock.calls[0][0] as string;
            const parsed = JSON.parse(output);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed[0].name).toBe('test');
        });

        it('should output csv format', () => {
            createPipeline('test', `
name: "Test"
input:
  items:
    - title: "Item"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            executeList(tmpDir, 'csv');
            expect(stdoutSpy).toHaveBeenCalled();
            const output = stdoutSpy.mock.calls[0][0] as string;
            expect(output).toContain('name,description,input,items');
        });

        it('should output markdown format', () => {
            createPipeline('test', `
name: "Test Pipeline"
input:
  items:
    - title: "Item"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            executeList(tmpDir, 'markdown');
            expect(stdoutSpy).toHaveBeenCalled();
            const output = stdoutSpy.mock.calls[0][0] as string;
            expect(output).toContain('| Name |');
            expect(output).toContain('| --- |');
            expect(output).toContain('test');
        });
    });
});
