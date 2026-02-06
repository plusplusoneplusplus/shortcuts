/**
 * Logger Tests
 *
 * Tests for CLI logger, colors, symbols, spinner, and progress display.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    setColorEnabled,
    isColorEnabled,
    red,
    green,
    yellow,
    blue,
    cyan,
    gray,
    bold,
    dim,
    magenta,
    SYMBOLS,
    Spinner,
    ProgressDisplay,
    createCLILogger,
    setVerbosity,
    getVerbosity,
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
    printKeyValue,
} from '../src/logger';

describe('Logger', () => {
    // ========================================================================
    // Color Functions
    // ========================================================================

    describe('Color Functions', () => {
        beforeEach(() => {
            setColorEnabled(true);
        });

        afterEach(() => {
            setColorEnabled(true);
        });

        it('should apply ANSI color codes when enabled', () => {
            expect(red('test')).toContain('\x1b[31m');
            expect(red('test')).toContain('test');
            expect(red('test')).toContain('\x1b[0m');
        });

        it('should return plain text when colors are disabled', () => {
            setColorEnabled(false);
            expect(red('test')).toBe('test');
            expect(green('hello')).toBe('hello');
            expect(yellow('warn')).toBe('warn');
            expect(blue('info')).toBe('info');
            expect(cyan('data')).toBe('data');
            expect(gray('dim')).toBe('dim');
            expect(bold('strong')).toBe('strong');
            expect(dim('faded')).toBe('faded');
            expect(magenta('mag')).toBe('mag');
        });

        it('should track color enabled state', () => {
            expect(isColorEnabled()).toBe(true);
            setColorEnabled(false);
            expect(isColorEnabled()).toBe(false);
            setColorEnabled(true);
            expect(isColorEnabled()).toBe(true);
        });

        it('should apply green color code', () => {
            expect(green('ok')).toContain('\x1b[32m');
        });

        it('should apply yellow color code', () => {
            expect(yellow('warn')).toContain('\x1b[33m');
        });

        it('should apply blue color code', () => {
            expect(blue('info')).toContain('\x1b[34m');
        });

        it('should apply cyan color code', () => {
            expect(cyan('data')).toContain('\x1b[36m');
        });

        it('should apply gray color code', () => {
            expect(gray('dim')).toContain('\x1b[90m');
        });

        it('should apply bold style', () => {
            expect(bold('strong')).toContain('\x1b[1m');
        });

        it('should apply dim style', () => {
            expect(dim('faded')).toContain('\x1b[2m');
        });

        it('should apply magenta color code', () => {
            expect(magenta('mag')).toContain('\x1b[35m');
        });
    });

    // ========================================================================
    // Symbols
    // ========================================================================

    describe('Symbols', () => {
        it('should have success symbol', () => {
            expect(SYMBOLS.success).toBeDefined();
            expect(typeof SYMBOLS.success).toBe('string');
        });

        it('should have error symbol', () => {
            expect(SYMBOLS.error).toBeDefined();
            expect(typeof SYMBOLS.error).toBe('string');
        });

        it('should have warning symbol', () => {
            expect(SYMBOLS.warning).toBeDefined();
            expect(typeof SYMBOLS.warning).toBe('string');
        });

        it('should have info symbol', () => {
            expect(SYMBOLS.info).toBeDefined();
            expect(typeof SYMBOLS.info).toBe('string');
        });

        it('should have arrow symbol', () => {
            expect(SYMBOLS.arrow).toBeDefined();
            expect(typeof SYMBOLS.arrow).toBe('string');
        });

        it('should have bullet symbol', () => {
            expect(SYMBOLS.bullet).toBeDefined();
            expect(typeof SYMBOLS.bullet).toBe('string');
        });

        it('should have spinner frames as an array', () => {
            expect(Array.isArray(SYMBOLS.spinner)).toBe(true);
            expect(SYMBOLS.spinner.length).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // Spinner
    // ========================================================================

    describe('Spinner', () => {
        let stderrSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });

        afterEach(() => {
            stderrSpy.mockRestore();
        });

        it('should create a spinner with a message', () => {
            const spinner = new Spinner('Loading...');
            expect(spinner.message).toBe('Loading...');
            expect(spinner.isRunning).toBe(false);
        });

        it('should create a spinner without a message', () => {
            const spinner = new Spinner();
            expect(spinner.message).toBe('');
            expect(spinner.isRunning).toBe(false);
        });

        it('should start and stop the spinner', () => {
            const spinner = new Spinner('test');
            spinner.start();
            expect(spinner.isRunning).toBe(true);
            spinner.stop();
            expect(spinner.isRunning).toBe(false);
        });

        it('should update spinner message', () => {
            const spinner = new Spinner('initial');
            spinner.start();
            spinner.update('updated');
            expect(spinner.message).toBe('updated');
            spinner.stop();
        });

        it('should succeed with custom message', () => {
            const spinner = new Spinner('doing work');
            spinner.start();
            spinner.succeed('Done!');
            expect(spinner.isRunning).toBe(false);
            // Check that stderr was written to
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should fail with custom message', () => {
            const spinner = new Spinner('doing work');
            spinner.start();
            spinner.fail('Failed!');
            expect(spinner.isRunning).toBe(false);
        });

        it('should warn with custom message', () => {
            const spinner = new Spinner('doing work');
            spinner.start();
            spinner.warn('Warning!');
            expect(spinner.isRunning).toBe(false);
        });

        it('should stop existing spinner when starting a new one', () => {
            const spinner = new Spinner('first');
            spinner.start();
            expect(spinner.isRunning).toBe(true);
            spinner.start('second');
            expect(spinner.isRunning).toBe(true);
            expect(spinner.message).toBe('second');
            spinner.stop();
        });

        it('should stop with a final message', () => {
            const spinner = new Spinner('test');
            spinner.start();
            spinner.stop('Final message');
            expect(spinner.isRunning).toBe(false);
        });

        it('should stop without final message', () => {
            const spinner = new Spinner('test');
            spinner.start();
            spinner.stop();
            expect(spinner.isRunning).toBe(false);
        });

        it('succeed should use original message if no message given', () => {
            const spinner = new Spinner('original');
            spinner.start();
            spinner.succeed();
            expect(spinner.isRunning).toBe(false);
        });

        it('fail should use original message if no message given', () => {
            const spinner = new Spinner('original');
            spinner.start();
            spinner.fail();
            expect(spinner.isRunning).toBe(false);
        });
    });

    // ========================================================================
    // Progress Display
    // ========================================================================

    describe('ProgressDisplay', () => {
        let stderrSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });

        afterEach(() => {
            stderrSpy.mockRestore();
        });

        it('should create a progress display with total', () => {
            const progress = new ProgressDisplay({ total: 100 });
            expect(progress).toBeDefined();
        });

        it('should update progress', () => {
            const progress = new ProgressDisplay({ total: 10, label: 'Test' });
            progress.update(5);
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should update progress with message', () => {
            const progress = new ProgressDisplay({ total: 10 });
            progress.update(3, 'Processing item 3');
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should complete progress', () => {
            const progress = new ProgressDisplay({ total: 10 });
            progress.complete('All done');
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should complete with default message', () => {
            const progress = new ProgressDisplay({ total: 10, label: 'MyTask' });
            progress.complete();
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should handle zero total', () => {
            const progress = new ProgressDisplay({ total: 0 });
            progress.update(0);
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should respect showPercentage option', () => {
            const progress = new ProgressDisplay({
                total: 10,
                showPercentage: false,
            });
            progress.update(5);
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should respect showCount option', () => {
            const progress = new ProgressDisplay({
                total: 10,
                showCount: false,
            });
            progress.update(5);
            expect(stderrSpy).toHaveBeenCalled();
        });
    });

    // ========================================================================
    // CLI Logger
    // ========================================================================

    describe('createCLILogger', () => {
        let stderrSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
            setVerbosity('normal');
        });

        afterEach(() => {
            stderrSpy.mockRestore();
            setVerbosity('normal');
        });

        it('should create a logger with all methods', () => {
            const logger = createCLILogger();
            expect(logger.debug).toBeDefined();
            expect(logger.info).toBeDefined();
            expect(logger.warn).toBeDefined();
            expect(logger.error).toBeDefined();
        });

        it('should log info messages in normal verbosity', () => {
            const logger = createCLILogger();
            logger.info('Test', 'Hello');
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should not log debug messages in normal verbosity', () => {
            const logger = createCLILogger();
            logger.debug('Test', 'Debug message');
            expect(stderrSpy).not.toHaveBeenCalled();
        });

        it('should log debug messages in verbose mode', () => {
            setVerbosity('verbose');
            const logger = createCLILogger();
            logger.debug('Test', 'Debug message');
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should not log info messages in quiet mode', () => {
            setVerbosity('quiet');
            const logger = createCLILogger();
            logger.info('Test', 'Info message');
            expect(stderrSpy).not.toHaveBeenCalled();
        });

        it('should always log warnings', () => {
            setVerbosity('quiet');
            const logger = createCLILogger();
            logger.warn('Test', 'Warning message');
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should always log errors', () => {
            setVerbosity('quiet');
            const logger = createCLILogger();
            logger.error('Test', 'Error message');
            expect(stderrSpy).toHaveBeenCalled();
        });

        it('should log error stack in verbose mode', () => {
            setVerbosity('verbose');
            const logger = createCLILogger();
            const err = new Error('test error');
            logger.error('Test', 'Error occurred', err);
            // Should have been called at least twice (error msg + stack)
            expect(stderrSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        it('should not log error stack in normal mode', () => {
            const logger = createCLILogger();
            const err = new Error('test error');
            logger.error('Test', 'Error occurred', err);
            // Should have been called exactly once (just the error msg)
            expect(stderrSpy.mock.calls.length).toBe(1);
        });
    });

    // ========================================================================
    // Verbosity
    // ========================================================================

    describe('Verbosity', () => {
        afterEach(() => {
            setVerbosity('normal');
        });

        it('should default to normal', () => {
            expect(getVerbosity()).toBe('normal');
        });

        it('should set and get verbosity', () => {
            setVerbosity('verbose');
            expect(getVerbosity()).toBe('verbose');
            setVerbosity('quiet');
            expect(getVerbosity()).toBe('quiet');
            setVerbosity('normal');
            expect(getVerbosity()).toBe('normal');
        });
    });

    // ========================================================================
    // Print Helpers
    // ========================================================================

    describe('Print Helpers', () => {
        let stderrSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });

        afterEach(() => {
            stderrSpy.mockRestore();
        });

        it('printSuccess should write to stderr', () => {
            printSuccess('done');
            expect(stderrSpy).toHaveBeenCalled();
            const output = stderrSpy.mock.calls[0][0] as string;
            expect(output).toContain('done');
        });

        it('printError should write to stderr', () => {
            printError('failed');
            expect(stderrSpy).toHaveBeenCalled();
            const output = stderrSpy.mock.calls[0][0] as string;
            expect(output).toContain('failed');
        });

        it('printWarning should write to stderr', () => {
            printWarning('careful');
            expect(stderrSpy).toHaveBeenCalled();
            const output = stderrSpy.mock.calls[0][0] as string;
            expect(output).toContain('careful');
        });

        it('printInfo should write to stderr', () => {
            printInfo('note');
            expect(stderrSpy).toHaveBeenCalled();
            const output = stderrSpy.mock.calls[0][0] as string;
            expect(output).toContain('note');
        });

        it('printHeader should write bold text to stderr', () => {
            printHeader('Title');
            expect(stderrSpy).toHaveBeenCalled();
            const output = stderrSpy.mock.calls[0][0] as string;
            expect(output).toContain('Title');
        });

        it('printKeyValue should write key and value to stderr', () => {
            printKeyValue('Name', 'Test');
            expect(stderrSpy).toHaveBeenCalled();
            const output = stderrSpy.mock.calls[0][0] as string;
            expect(output).toContain('Name');
            expect(output).toContain('Test');
        });
    });
});
