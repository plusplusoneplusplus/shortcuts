/**
 * Validate Command Tests
 *
 * Tests for pipeline validation including YAML parsing, input validation,
 * map/reduce configuration, and filter validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    executeValidate,
    validatePipeline,
    resolvePipelinePath,
} from '../../src/commands/validate';
import type { ValidationResult, ValidationCheck } from '../../src/commands/validate';
import { setColorEnabled } from '../../src/logger';

describe('Validate Command', () => {
    let tmpDir: string;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-cli-validate-'));
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        setColorEnabled(false);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        stderrSpy.mockRestore();
        setColorEnabled(true);
    });

    // ========================================================================
    // resolvePipelinePath
    // ========================================================================

    describe('resolvePipelinePath', () => {
        it('should resolve direct file path', () => {
            const yamlPath = path.join(tmpDir, 'pipeline.yaml');
            fs.writeFileSync(yamlPath, 'name: test\n');
            const result = resolvePipelinePath(yamlPath);
            expect(result).toBe(yamlPath);
        });

        it('should resolve directory to pipeline.yaml inside', () => {
            const dir = path.join(tmpDir, 'my-pipeline');
            fs.mkdirSync(dir);
            const yamlPath = path.join(dir, 'pipeline.yaml');
            fs.writeFileSync(yamlPath, 'name: test\n');
            const result = resolvePipelinePath(dir);
            expect(result).toBe(yamlPath);
        });

        it('should return undefined for non-existent path', () => {
            const result = resolvePipelinePath(path.join(tmpDir, 'nonexistent'));
            expect(result).toBeUndefined();
        });

        it('should return undefined for directory without pipeline.yaml', () => {
            const dir = path.join(tmpDir, 'empty-dir');
            fs.mkdirSync(dir);
            const result = resolvePipelinePath(dir);
            expect(result).toBeUndefined();
        });
    });

    // ========================================================================
    // validatePipeline - Valid Pipelines
    // ========================================================================

    describe('validatePipeline - valid pipelines', () => {
        it('should validate a minimal CSV pipeline', () => {
            const dir = path.join(tmpDir, 'csv-pipeline');
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'input.csv'), 'title,description\nBug 1,Fix it\n');
            const yamlPath = path.join(dir, 'pipeline.yaml');
            fs.writeFileSync(yamlPath, `
name: "Bug Triage"
input:
  from:
    type: csv
    path: "input.csv"
map:
  prompt: "Analyze: {{title}}"
  output:
    - severity
    - category
reduce:
  type: json
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.pipelineName).toBe('Bug Triage');
            expect(result.checks.every(c => c.status !== 'fail')).toBe(true);
        });

        it('should validate a pipeline with inline items', () => {
            const yamlPath = path.join(tmpDir, 'inline.yaml');
            fs.writeFileSync(yamlPath, `
name: "Inline Pipeline"
input:
  items:
    - title: "Item 1"
    - title: "Item 2"
    - title: "Item 3"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('3 inline items'))).toBe(true);
        });

        it('should validate a pipeline with inline list (fanout)', () => {
            const yamlPath = path.join(tmpDir, 'fanout.yaml');
            fs.writeFileSync(yamlPath, `
name: "Multi-Model Fanout"
input:
  from:
    - model: gpt-4
    - model: claude-sonnet
  parameters:
    - name: code
      value: "function add(a, b) { return a + b; }"
map:
  prompt: "Review: {{code}}"
  model: "{{model}}"
  output:
    - review
reduce:
  type: table
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('2 inline list'))).toBe(true);
        });

        it('should validate pipeline with generate input', () => {
            const yamlPath = path.join(tmpDir, 'generate.yaml');
            fs.writeFileSync(yamlPath, `
name: "Generated Input"
input:
  generate:
    prompt: "Generate 5 test cases"
    schema:
      - testName
      - input
      - expected
map:
  prompt: "Run test: {{testName}}"
  output:
    - result
reduce:
  type: json
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('AI-generated'))).toBe(true);
        });

        it('should validate pipeline with filter', () => {
            const yamlPath = path.join(tmpDir, 'filter.yaml');
            fs.writeFileSync(yamlPath, `
name: "Filtered Pipeline"
input:
  items:
    - priority: 5
      title: High
    - priority: 2
      title: Low
filter:
  type: rule
  rule:
    rules:
      - field: priority
        operator: gte
        value: 3
    mode: all
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('rule-based'))).toBe(true);
        });

        it('should validate pipeline with AI reduce', () => {
            const yamlPath = path.join(tmpDir, 'ai-reduce.yaml');
            fs.writeFileSync(yamlPath, `
name: "AI Reduce"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Analyze: {{title}}"
  output:
    - result
reduce:
  type: ai
  prompt: "Summarize: {{RESULTS}}"
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
        });

        it('should validate pipeline with batch mapping', () => {
            const yamlPath = path.join(tmpDir, 'batch.yaml');
            fs.writeFileSync(yamlPath, `
name: "Batch Pipeline"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process batch: {{ITEMS}}"
  batchSize: 10
  output:
    - result
reduce:
  type: json
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('batch mode'))).toBe(true);
        });

        it('should validate pipeline with text mode (no output fields)', () => {
            const yamlPath = path.join(tmpDir, 'text-mode.yaml');
            fs.writeFileSync(yamlPath, `
name: "Text Mode"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Analyze: {{title}}"
reduce:
  type: text
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('text mode'))).toBe(true);
        });

        it('should validate pipeline with parameters', () => {
            const yamlPath = path.join(tmpDir, 'params.yaml');
            fs.writeFileSync(yamlPath, `
name: "With Parameters"
input:
  items:
    - title: "Item 1"
  parameters:
    - name: reviewer
      value: "Alice"
map:
  prompt: "Review by {{reviewer}}: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('reviewer'))).toBe(true);
        });

        it('should validate pipeline with skill', () => {
            const yamlPath = path.join(tmpDir, 'skill.yaml');
            fs.writeFileSync(yamlPath, `
name: "With Skill"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Analyze: {{title}}"
  skill: "go-deep"
  output:
    - result
reduce:
  type: json
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('skill "go-deep"'))).toBe(true);
        });

        it('should validate pipeline with input limit', () => {
            const yamlPath = path.join(tmpDir, 'limit.yaml');
            fs.writeFileSync(yamlPath, `
name: "With Limit"
input:
  items:
    - title: "Item 1"
    - title: "Item 2"
    - title: "Item 3"
  limit: 2
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('limit: 2'))).toBe(true);
        });

        it('should validate pipeline with promptFile', () => {
            const yamlPath = path.join(tmpDir, 'promptfile.yaml');
            fs.writeFileSync(yamlPath, `
name: "Prompt File"
input:
  items:
    - title: "Item 1"
map:
  promptFile: "analyze.prompt.md"
  output:
    - result
reduce:
  type: json
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('prompt from file'))).toBe(true);
        });
    });

    // ========================================================================
    // validatePipeline - Invalid Pipelines
    // ========================================================================

    describe('validatePipeline - invalid pipelines', () => {
        it('should fail on invalid YAML', () => {
            const yamlPath = path.join(tmpDir, 'invalid.yaml');
            fs.writeFileSync(yamlPath, '{{invalid yaml');
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(false);
            expect(result.checks.some(c => c.status === 'fail')).toBe(true);
        });

        it('should fail on missing name', () => {
            const yamlPath = path.join(tmpDir, 'no-name.yaml');
            fs.writeFileSync(yamlPath, `
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
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(false);
        });

        it('should fail on missing CSV file', () => {
            const dir = path.join(tmpDir, 'missing-csv');
            fs.mkdirSync(dir);
            const yamlPath = path.join(dir, 'pipeline.yaml');
            fs.writeFileSync(yamlPath, `
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
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(false);
            expect(result.checks.some(c => c.status === 'fail' && c.label.includes('CSV'))).toBe(true);
        });

        it('should fail on invalid reduce type', () => {
            const yamlPath = path.join(tmpDir, 'bad-reduce.yaml');
            fs.writeFileSync(yamlPath, `
name: "Bad Reduce"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: invalid_type
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(false);
            expect(result.checks.some(c => c.status === 'fail' && c.detail?.includes('Invalid reduce type'))).toBe(true);
        });

        it('should fail on AI reduce without prompt', () => {
            const yamlPath = path.join(tmpDir, 'ai-no-prompt.yaml');
            fs.writeFileSync(yamlPath, `
name: "AI No Prompt"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: ai
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(false);
            expect(result.checks.some(c => c.status === 'fail' && c.label.includes('AI prompt'))).toBe(true);
        });

        it('should fail on missing map prompt', () => {
            const yamlPath = path.join(tmpDir, 'no-map-prompt.yaml');
            fs.writeFileSync(yamlPath, `
name: "No Map Prompt"
input:
  items:
    - title: "Item 1"
map:
  output:
    - result
reduce:
  type: json
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(false);
        });
    });

    // ========================================================================
    // validatePipeline - Warnings
    // ========================================================================

    describe('validatePipeline - warnings', () => {
        it('should warn on prompt without template variables', () => {
            const yamlPath = path.join(tmpDir, 'no-vars.yaml');
            fs.writeFileSync(yamlPath, `
name: "No Variables"
input:
  items:
    - title: "Item 1"
map:
  prompt: "Just a static prompt"
  output:
    - result
reduce:
  type: json
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.status === 'warn' && c.label.includes('no template variables'))).toBe(true);
        });

        it('should warn on zero input limit', () => {
            const yamlPath = path.join(tmpDir, 'zero-limit.yaml');
            fs.writeFileSync(yamlPath, `
name: "Zero Limit"
input:
  items:
    - title: "Item 1"
  limit: 0
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);
            const result = validatePipeline(yamlPath);
            // limit: 0 generates a warning
            expect(result.checks.some(c => c.status === 'warn' && c.label.includes('limit'))).toBe(true);
        });
    });

    // ========================================================================
    // Filter Validation
    // ========================================================================

    describe('Filter validation', () => {
        it('should validate hybrid filter', () => {
            const yamlPath = path.join(tmpDir, 'hybrid-filter.yaml');
            fs.writeFileSync(yamlPath, `
name: "Hybrid Filter"
input:
  items:
    - title: "Item 1"
filter:
  type: hybrid
  rule:
    rules:
      - field: status
        operator: equals
        value: open
  ai:
    prompt: "Should include {{title}}?"
    output:
      - include
  combineMode: or
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('hybrid'))).toBe(true);
            expect(result.checks.some(c => c.label.includes('combineMode: or'))).toBe(true);
        });

        it('should validate AI filter', () => {
            const yamlPath = path.join(tmpDir, 'ai-filter.yaml');
            fs.writeFileSync(yamlPath, `
name: "AI Filter"
input:
  items:
    - title: "Item 1"
filter:
  type: ai
  ai:
    prompt: "Is {{title}} actionable?"
    output:
      - include
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = validatePipeline(yamlPath);
            expect(result.valid).toBe(true);
            expect(result.checks.some(c => c.label.includes('AI-based'))).toBe(true);
        });

        it('should fail on rule filter without rules', () => {
            const yamlPath = path.join(tmpDir, 'empty-rule-filter.yaml');
            fs.writeFileSync(yamlPath, `
name: "Empty Rule Filter"
input:
  items:
    - title: "Item 1"
filter:
  type: rule
  rule:
    rules: []
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = validatePipeline(yamlPath);
            expect(result.checks.some(c => c.status === 'fail' && c.label.includes('rules'))).toBe(true);
        });

        it('should fail on AI filter without prompt', () => {
            const yamlPath = path.join(tmpDir, 'ai-filter-no-prompt.yaml');
            fs.writeFileSync(yamlPath, `
name: "AI Filter No Prompt"
input:
  items:
    - title: "Item 1"
filter:
  type: ai
  ai:
    output:
      - include
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: list
`);
            const result = validatePipeline(yamlPath);
            expect(result.checks.some(c => c.status === 'fail' && c.label.includes('AI config'))).toBe(true);
        });
    });

    // ========================================================================
    // executeValidate
    // ========================================================================

    describe('executeValidate', () => {
        it('should return 0 for valid pipeline', () => {
            const yamlPath = path.join(tmpDir, 'valid.yaml');
            fs.writeFileSync(yamlPath, `
name: "Valid"
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
            const exitCode = executeValidate(yamlPath);
            expect(exitCode).toBe(0);
        });

        it('should return 2 for non-existent file', () => {
            const exitCode = executeValidate(path.join(tmpDir, 'nonexistent.yaml'));
            expect(exitCode).toBe(2);
        });

        it('should return 2 for invalid pipeline', () => {
            const yamlPath = path.join(tmpDir, 'invalid.yaml');
            fs.writeFileSync(yamlPath, '{{invalid');
            const exitCode = executeValidate(yamlPath);
            expect(exitCode).toBe(2);
        });

        it('should resolve directory path', () => {
            const dir = path.join(tmpDir, 'package');
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'pipeline.yaml'), `
name: "Package"
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
            const exitCode = executeValidate(dir);
            expect(exitCode).toBe(0);
        });
    });
});
