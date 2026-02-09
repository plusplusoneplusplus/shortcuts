/**
 * Serve Command Tests
 *
 * Tests for the serve command CLI registration and options.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProgram } from '../../src/cli';
import { executeServe } from '../../src/commands/serve';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-serve-test-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// CLI Registration
// ============================================================================

describe('serve command — CLI registration', () => {
    it('should have serve command', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve');
        expect(cmd).toBeDefined();
    });

    it('should accept a wiki-dir argument', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve')!;
        const args = (cmd as any).registeredArguments || (cmd as any)._args;
        expect(args?.length).toBeGreaterThan(0);
    });

    it('should have expected options', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve')!;
        const optionNames = cmd.options.map(o => o.long || o.short);

        expect(optionNames).toContain('--port');
        expect(optionNames).toContain('--host');
        expect(optionNames).toContain('--generate');
        expect(optionNames).toContain('--watch');
        expect(optionNames).toContain('--ai');
        expect(optionNames).toContain('--model');
        expect(optionNames).toContain('--open');
        expect(optionNames).toContain('--theme');
        expect(optionNames).toContain('--title');
        expect(optionNames).toContain('--verbose');
    });

    it('should have default port 3000', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve')!;
        const portOpt = cmd.options.find(o => o.long === '--port');
        expect(portOpt).toBeDefined();
        expect(portOpt!.defaultValue).toBe(3000);
    });

    it('should have default host localhost', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve')!;
        const hostOpt = cmd.options.find(o => o.long === '--host');
        expect(hostOpt).toBeDefined();
        expect(hostOpt!.defaultValue).toBe('localhost');
    });

    it('should have default theme auto', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve')!;
        const themeOpt = cmd.options.find(o => o.long === '--theme');
        expect(themeOpt).toBeDefined();
        expect(themeOpt!.defaultValue).toBe('auto');
    });

    it('should have --watch defaulting to false', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve')!;
        const watchOpt = cmd.options.find(o => o.long === '--watch');
        expect(watchOpt).toBeDefined();
        expect(watchOpt!.defaultValue).toBe(false);
    });

    it('should have --ai defaulting to false', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve')!;
        const aiOpt = cmd.options.find(o => o.long === '--ai');
        expect(aiOpt).toBeDefined();
        expect(aiOpt!.defaultValue).toBe(false);
    });

    it('should have --open defaulting to false', () => {
        const program = createProgram();
        const cmd = program.commands.find(c => c.name() === 'serve')!;
        const openOpt = cmd.options.find(o => o.long === '--open');
        expect(openOpt).toBeDefined();
        expect(openOpt!.defaultValue).toBe(false);
    });
});

// ============================================================================
// executeServe — validation
// ============================================================================

describe('executeServe — validation', () => {
    it('should return CONFIG_ERROR when wiki dir does not exist', async () => {
        const exitCode = await executeServe('/nonexistent/wiki/dir', {});
        expect(exitCode).toBe(2);
    });

    it('should return CONFIG_ERROR when module-graph.json is missing', async () => {
        const emptyDir = path.join(tempDir, 'empty');
        fs.mkdirSync(emptyDir, { recursive: true });

        const exitCode = await executeServe(emptyDir, {});
        expect(exitCode).toBe(2);
    });

    it('should return CONFIG_ERROR when --generate path does not exist', async () => {
        const wikiDir = path.join(tempDir, 'wiki');
        fs.mkdirSync(wikiDir, { recursive: true });

        const exitCode = await executeServe(wikiDir, {
            generate: '/nonexistent/repo',
        });
        expect(exitCode).toBe(2);
    });
});
