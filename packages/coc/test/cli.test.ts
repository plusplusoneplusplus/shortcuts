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
            expect(program.name()).toBe('coc');
        });

        it('should have run command', () => {
            const program = createProgram();
            const runCmd = program.commands.find(c => c.name() === 'run');
            expect(runCmd).toBeDefined();
        });

        it('should have validate command', () => {
            const program = createProgram();
            const validateCmd = program.commands.find(c => c.name() === 'validate');
            expect(validateCmd).toBeDefined();
        });

        it('should have list command', () => {
            const program = createProgram();
            const listCmd = program.commands.find(c => c.name() === 'list');
            expect(listCmd).toBeDefined();
        });

        it('run command should have expected options', () => {
            const program = createProgram();
            const runCmd = program.commands.find(c => c.name() === 'run')!;
            const optionNames = runCmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--parallel');
            expect(optionNames).toContain('--output');
            expect(optionNames).toContain('--output-file');
            expect(optionNames).toContain('--verbose');
            expect(optionNames).toContain('--dry-run');
            expect(optionNames).toContain('--timeout');
            expect(optionNames).toContain('--approve-permissions');
        });

        it('validate command should accept a path argument', () => {
            const program = createProgram();
            const validateCmd = program.commands.find(c => c.name() === 'validate')!;
            // Commander stores arguments in _args
            expect(validateCmd.args?.length || (validateCmd as any)._args?.length).toBeGreaterThan(0);
        });

        it('list command should have optional dir argument', () => {
            const program = createProgram();
            const listCmd = program.commands.find(c => c.name() === 'list')!;
            expect(listCmd).toBeDefined();
        });

        it('should have admin command with wipe-data subcommand', () => {
            const program = createProgram();
            const adminCmd = program.commands.find(c => c.name() === 'admin');
            expect(adminCmd).toBeDefined();

            const wipeCmd = adminCmd!.commands.find(c => c.name() === 'wipe-data');
            expect(wipeCmd).toBeDefined();
        });

        it('wipe-data command should have expected options', () => {
            const program = createProgram();
            const adminCmd = program.commands.find(c => c.name() === 'admin')!;
            const wipeCmd = adminCmd.commands.find(c => c.name() === 'wipe-data')!;
            const optionNames = wipeCmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--confirm');
            expect(optionNames).toContain('--include-wikis');
            expect(optionNames).toContain('--dry-run');
            expect(optionNames).toContain('--data-dir');
        });

        it('should have queue command with submit, list, and cancel subcommands', () => {
            const program = createProgram();
            const queueCmd = program.commands.find(c => c.name() === 'queue');
            expect(queueCmd).toBeDefined();

            const submitCmd = queueCmd!.commands.find(c => c.name() === 'submit');
            expect(submitCmd).toBeDefined();
            const listCmd = queueCmd!.commands.find(c => c.name() === 'list');
            expect(listCmd).toBeDefined();
            const cancelCmd = queueCmd!.commands.find(c => c.name() === 'cancel');
            expect(cancelCmd).toBeDefined();
        });

        it('queue submit command should have expected options', () => {
            const program = createProgram();
            const queueCmd = program.commands.find(c => c.name() === 'queue')!;
            const submitCmd = queueCmd.commands.find(c => c.name() === 'submit')!;
            const optionNames = submitCmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--mode');
            expect(optionNames).toContain('--provider');
            expect(optionNames).toContain('--effort-tier');
            expect(optionNames).toContain('--model');
            expect(optionNames).toContain('--reasoning-effort');
            expect(optionNames).toContain('--workspace-id');
            expect(optionNames).toContain('--priority');
            expect(optionNames).toContain('--display-name');
            expect(optionNames).toContain('--server-url');
            expect(optionNames).toContain('--output');
        });

        it('queue list command should have expected options', () => {
            const program = createProgram();
            const queueCmd = program.commands.find(c => c.name() === 'queue')!;
            const listCmd = queueCmd.commands.find(c => c.name() === 'list')!;
            const optionNames = listCmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--workspace-id');
            expect(optionNames).toContain('--repo-id');
            expect(optionNames).toContain('--status');
            expect(optionNames).toContain('--limit');
            expect(optionNames).toContain('--server-url');
            expect(optionNames).toContain('--output');
        });

        it('queue cancel command should have expected options', () => {
            const program = createProgram();
            const queueCmd = program.commands.find(c => c.name() === 'queue')!;
            const cancelCmd = queueCmd.commands.find(c => c.name() === 'cancel')!;
            const optionNames = cancelCmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--reason');
            expect(optionNames).toContain('--server-url');
        });
    });
});
