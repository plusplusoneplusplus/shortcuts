/**
 * CLI Tests
 *
 * Tests for the CLI argument parser and program creation.
 */

import { describe, it, expect } from 'vitest';
import { createProgram, EXIT_CODES } from '../src/cli';

describe('CLI', () => {
    // ========================================================================
    // Exit Codes
    // ========================================================================

    describe('EXIT_CODES', () => {
        it('should define SUCCESS as 0', () => {
            expect(EXIT_CODES.SUCCESS).toBe(0);
        });

        it('should define EXECUTION_ERROR as 1', () => {
            expect(EXIT_CODES.EXECUTION_ERROR).toBe(1);
        });

        it('should define CONFIG_ERROR as 2', () => {
            expect(EXIT_CODES.CONFIG_ERROR).toBe(2);
        });

        it('should define AI_UNAVAILABLE as 3', () => {
            expect(EXIT_CODES.AI_UNAVAILABLE).toBe(3);
        });

        it('should define CANCELLED as 130', () => {
            expect(EXIT_CODES.CANCELLED).toBe(130);
        });

        it('should have all exit codes as numbers', () => {
            for (const [, value] of Object.entries(EXIT_CODES)) {
                expect(typeof value).toBe('number');
            }
        });
    });

    // ========================================================================
    // Program Creation
    // ========================================================================

    describe('createProgram', () => {
        it('should create a program', () => {
            const program = createProgram();
            expect(program).toBeDefined();
        });

        it('should have the correct name', () => {
            const program = createProgram();
            expect(program.name()).toBe('deep-wiki');
        });

        it('should have version', () => {
            const program = createProgram();
            expect(program.version()).toBe('1.0.0');
        });

        it('should have discover command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover');
            expect(cmd).toBeDefined();
        });

        it('should have generate command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate');
            expect(cmd).toBeDefined();
        });

        it('should have seeds command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'seeds');
            expect(cmd).toBeDefined();
        });
    });

    // ========================================================================
    // Seeds Command Options
    // ========================================================================

    describe('seeds command', () => {
        it('should accept a repo-path argument', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'seeds')!;
            expect(cmd).toBeDefined();
            const args = (cmd as any).registeredArguments || (cmd as any)._args;
            expect(args?.length).toBeGreaterThan(0);
        });

        it('should have expected options', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'seeds')!;
            const optionNames = cmd.options.map(o => o.long || o.short);

            expect(optionNames).toContain('--output');
            expect(optionNames).toContain('--max-topics');
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--timeout');
            expect(optionNames).toContain('--verbose');
        });

        it('should have default value for --output', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'seeds')!;
            const outputOpt = cmd.options.find(o => o.long === '--output');
            expect(outputOpt).toBeDefined();
            expect(outputOpt!.defaultValue).toBe('seeds.json');
        });

        it('should have default value for --max-topics', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'seeds')!;
            const maxOpt = cmd.options.find(o => o.long === '--max-topics');
            expect(maxOpt).toBeDefined();
            expect(maxOpt!.defaultValue).toBe(50);
        });
    });

    // ========================================================================
    // Discover Command Options
    // ========================================================================

    describe('discover command', () => {
        it('should accept a repo-path argument', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover')!;
            expect(cmd).toBeDefined();
            // Commander stores arguments in registeredArguments or _args
            const args = (cmd as any).registeredArguments || (cmd as any)._args;
            expect(args?.length).toBeGreaterThan(0);
        });

        it('should have expected options', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover')!;
            const optionNames = cmd.options.map(o => o.long || o.short);

            expect(optionNames).toContain('--output');
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--timeout');
            expect(optionNames).toContain('--focus');
            expect(optionNames).toContain('--force');
            expect(optionNames).toContain('--use-cache');
            expect(optionNames).toContain('--verbose');
            expect(optionNames).toContain('--seeds');
        });

        it('should have default value for output', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover')!;
            const outputOpt = cmd.options.find(o => o.long === '--output');
            expect(outputOpt).toBeDefined();
            expect(outputOpt!.defaultValue).toBe('./wiki');
        });
    });

    // ========================================================================
    // Generate Command Options
    // ========================================================================

    describe('generate command', () => {
        it('should accept a repo-path argument', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            expect(cmd).toBeDefined();
            const args = (cmd as any).registeredArguments || (cmd as any)._args;
            expect(args?.length).toBeGreaterThan(0);
        });

        it('should have expected options', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            const optionNames = cmd.options.map(o => o.long || o.short);

            expect(optionNames).toContain('--output');
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--concurrency');
            expect(optionNames).toContain('--timeout');
            expect(optionNames).toContain('--focus');
            expect(optionNames).toContain('--depth');
            expect(optionNames).toContain('--force');
            expect(optionNames).toContain('--use-cache');
            expect(optionNames).toContain('--phase');
            expect(optionNames).toContain('--verbose');
            expect(optionNames).toContain('--seeds');
            // Website generation options (Phase 5)
            expect(optionNames).toContain('--skip-website');
            expect(optionNames).toContain('--theme');
            expect(optionNames).toContain('--title');
            // Config file support
            expect(optionNames).toContain('--config');
        });

        it('should have default values for depth', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            const depthOpt = cmd.options.find(o => o.long === '--depth');
            expect(depthOpt).toBeDefined();
            expect(depthOpt!.defaultValue).toBe('normal');
        });

        it('should have default value for --theme', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            const themeOpt = cmd.options.find(o => o.long === '--theme');
            expect(themeOpt).toBeDefined();
            expect(themeOpt!.defaultValue).toBe('auto');
        });

        it('should have --end-phase option', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            const optionNames = cmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--end-phase');
        });

        it('should have --skip-website defaulting to false', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;
            const skipOpt = cmd.options.find(o => o.long === '--skip-website');
            expect(skipOpt).toBeDefined();
            expect(skipOpt!.defaultValue).toBe(false);
        });
    });

    // ========================================================================
    // Serve Command Options
    // ========================================================================

    describe('serve command', () => {
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
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--open');
            expect(optionNames).toContain('--theme');
            expect(optionNames).toContain('--title');
            expect(optionNames).toContain('--verbose');
        });

        it('should have default value for --port as 3000', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'serve')!;
            const portOpt = cmd.options.find(o => o.long === '--port');
            expect(portOpt).toBeDefined();
            expect(portOpt!.defaultValue).toBe(3000);
        });

        it('should have default value for --host as localhost', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'serve')!;
            const hostOpt = cmd.options.find(o => o.long === '--host');
            expect(hostOpt).toBeDefined();
            expect(hostOpt!.defaultValue).toBe('localhost');
        });

        it('should parse --port as a valid integer (not NaN)', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'serve')!;

            // Override action to capture parsed opts instead of executing
            let capturedOpts: Record<string, unknown> = {};
            cmd.action((_wikiDir: string, opts: Record<string, unknown>) => {
                capturedOpts = opts;
            });

            program.parse(['node', 'deep-wiki', 'serve', './wiki', '--port', '4567']);
            expect(capturedOpts.port).toBe(4567);
            expect(typeof capturedOpts.port).toBe('number');
            expect(Number.isNaN(capturedOpts.port)).toBe(false);
        });

        it('should use default port 3000 when --port is not specified', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'serve')!;

            let capturedOpts: Record<string, unknown> = {};
            cmd.action((_wikiDir: string, opts: Record<string, unknown>) => {
                capturedOpts = opts;
            });

            program.parse(['node', 'deep-wiki', 'serve', './wiki']);
            expect(capturedOpts.port).toBe(3000);
        });
    });

    // ========================================================================
    // parseInt Parsing Safety (Regression Tests)
    // ========================================================================

    describe('parseInt option parsing safety', () => {
        it('should parse --max-topics correctly in seeds command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'seeds')!;

            let capturedOpts: Record<string, unknown> = {};
            cmd.action((_repoPath: string, opts: Record<string, unknown>) => {
                capturedOpts = opts;
            });

            program.parse(['node', 'deep-wiki', 'seeds', '.', '--max-topics', '100']);
            expect(capturedOpts.maxTopics).toBe(100);
            expect(Number.isNaN(capturedOpts.maxTopics)).toBe(false);
        });

        it('should parse --timeout correctly in seeds command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'seeds')!;

            let capturedOpts: Record<string, unknown> = {};
            cmd.action((_repoPath: string, opts: Record<string, unknown>) => {
                capturedOpts = opts;
            });

            program.parse(['node', 'deep-wiki', 'seeds', '.', '--timeout', '600']);
            expect(capturedOpts.timeout).toBe(600);
            expect(Number.isNaN(capturedOpts.timeout)).toBe(false);
        });

        it('should parse --timeout correctly in discover command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'discover')!;

            let capturedOpts: Record<string, unknown> = {};
            cmd.action((_repoPath: string, opts: Record<string, unknown>) => {
                capturedOpts = opts;
            });

            program.parse(['node', 'deep-wiki', 'discover', '.', '--timeout', '300']);
            expect(capturedOpts.timeout).toBe(300);
            expect(Number.isNaN(capturedOpts.timeout)).toBe(false);
        });

        it('should parse --concurrency and --phase correctly in generate command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;

            let capturedOpts: Record<string, unknown> = {};
            cmd.action((_repoPath: string, opts: Record<string, unknown>) => {
                capturedOpts = opts;
            });

            program.parse(['node', 'deep-wiki', 'generate', '.', '--concurrency', '8', '--phase', '2']);
            expect(capturedOpts.concurrency).toBe(8);
            expect(capturedOpts.phase).toBe(2);
            expect(Number.isNaN(capturedOpts.concurrency)).toBe(false);
            expect(Number.isNaN(capturedOpts.phase)).toBe(false);
        });

        it('should parse --end-phase correctly in generate command', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;

            let capturedOpts: Record<string, unknown> = {};
            cmd.action((_repoPath: string, opts: Record<string, unknown>) => {
                capturedOpts = opts;
            });

            program.parse(['node', 'deep-wiki', 'generate', '.', '--end-phase', '3']);
            expect(capturedOpts.endPhase).toBe(3);
            expect(typeof capturedOpts.endPhase).toBe('number');
            expect(Number.isNaN(capturedOpts.endPhase)).toBe(false);
        });

        it('should parse --phase and --end-phase together correctly', () => {
            const program = createProgram();
            const cmd = program.commands.find(c => c.name() === 'generate')!;

            let capturedOpts: Record<string, unknown> = {};
            cmd.action((_repoPath: string, opts: Record<string, unknown>) => {
                capturedOpts = opts;
            });

            program.parse(['node', 'deep-wiki', 'generate', '.', '--phase', '2', '--end-phase', '4']);
            expect(capturedOpts.phase).toBe(2);
            expect(capturedOpts.endPhase).toBe(4);
        });
    });
});
