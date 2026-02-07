/**
 * CLI Logger
 *
 * Provides colored console output with spinner/progress support for the deep-wiki CLI.
 * Implements the pipeline-core Logger interface and adds CLI-specific features
 * like spinners, status messages, and color-coded output.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { Logger } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// ANSI Color Codes
// ============================================================================

const COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',

    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',

    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
} as const;

// ============================================================================
// Color Helpers
// ============================================================================

let colorEnabled = true;

/**
 * Enable or disable colored output
 */
export function setColorEnabled(enabled: boolean): void {
    colorEnabled = enabled;
}

/**
 * Check if colors are enabled
 */
export function isColorEnabled(): boolean {
    return colorEnabled;
}

function colorize(color: string, text: string): string {
    if (!colorEnabled) { return text; }
    return `${color}${text}${COLORS.reset}`;
}

export function red(text: string): string { return colorize(COLORS.red, text); }
export function green(text: string): string { return colorize(COLORS.green, text); }
export function yellow(text: string): string { return colorize(COLORS.yellow, text); }
export function blue(text: string): string { return colorize(COLORS.blue, text); }
export function cyan(text: string): string { return colorize(COLORS.cyan, text); }
export function gray(text: string): string { return colorize(COLORS.gray, text); }
export function bold(text: string): string { return colorize(COLORS.bold, text); }
export function dim(text: string): string { return colorize(COLORS.dim, text); }
export function magenta(text: string): string { return colorize(COLORS.magenta, text); }

// ============================================================================
// Symbols (cross-platform)
// ============================================================================

const isWindows = process.platform === 'win32';

export const SYMBOLS = {
    success: isWindows ? '√' : '✓',
    error: isWindows ? '×' : '✗',
    warning: isWindows ? '‼' : '⚠',
    info: isWindows ? 'i' : 'ℹ',
    arrow: isWindows ? '>' : '→',
    bullet: isWindows ? '*' : '•',
    spinner: isWindows
        ? ['|', '/', '-', '\\']
        : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const;

// ============================================================================
// Spinner
// ============================================================================

/**
 * Simple CLI spinner for showing progress
 */
export class Spinner {
    private frameIndex = 0;
    private timer: ReturnType<typeof setInterval> | null = null;
    private _message: string;
    private _isRunning = false;

    constructor(message: string = '') {
        this._message = message;
    }

    get isRunning(): boolean {
        return this._isRunning;
    }

    get message(): string {
        return this._message;
    }

    /**
     * Start the spinner with an optional message
     */
    start(message?: string): void {
        if (this._isRunning) { this.stop(); }
        if (message !== undefined) { this._message = message; }
        this._isRunning = true;

        // Only animate if TTY
        if (process.stderr.isTTY) {
            this.timer = setInterval(() => {
                const frame = SYMBOLS.spinner[this.frameIndex % SYMBOLS.spinner.length];
                process.stderr.write(`\r${colorize(COLORS.cyan, frame)} ${this._message}`);
                this.frameIndex++;
            }, 80);
        } else {
            process.stderr.write(`${this._message}\n`);
        }
    }

    /**
     * Update the spinner message
     */
    update(message: string): void {
        this._message = message;
        if (!process.stderr.isTTY && this._isRunning) {
            process.stderr.write(`${message}\n`);
        }
    }

    /**
     * Stop the spinner and show a final message
     */
    stop(finalMessage?: string): void {
        this._isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (process.stderr.isTTY) {
            process.stderr.write('\r\x1b[K'); // Clear the line
        }
        if (finalMessage) {
            process.stderr.write(`${finalMessage}\n`);
        }
    }

    /**
     * Stop with success state
     */
    succeed(message?: string): void {
        const msg = message || this._message;
        this.stop(`${green(SYMBOLS.success)} ${msg}`);
    }

    /**
     * Stop with failure state
     */
    fail(message?: string): void {
        const msg = message || this._message;
        this.stop(`${red(SYMBOLS.error)} ${msg}`);
    }

    /**
     * Stop with warning state
     */
    warn(message?: string): void {
        const msg = message || this._message;
        this.stop(`${yellow(SYMBOLS.warning)} ${msg}`);
    }
}

// ============================================================================
// CLI Logger (implements pipeline-core Logger interface)
// ============================================================================

/**
 * Verbosity level for CLI output
 */
export type VerbosityLevel = 'quiet' | 'normal' | 'verbose';

let verbosity: VerbosityLevel = 'normal';

/**
 * Set the CLI verbosity level
 */
export function setVerbosity(level: VerbosityLevel): void {
    verbosity = level;
}

/**
 * Get the current verbosity level
 */
export function getVerbosity(): VerbosityLevel {
    return verbosity;
}

/**
 * Create a pipeline-core compatible Logger for CLI usage
 */
export function createCLILogger(): Logger {
    return {
        debug(category: string, message: string): void {
            if (verbosity === 'verbose') {
                process.stderr.write(`${gray(`[DEBUG] [${category}]`)} ${message}\n`);
            }
        },
        info(category: string, message: string): void {
            if (verbosity !== 'quiet') {
                process.stderr.write(`${blue(`[${category}]`)} ${message}\n`);
            }
        },
        warn(category: string, message: string): void {
            process.stderr.write(`${yellow(`[WARN] [${category}]`)} ${message}\n`);
        },
        error(category: string, message: string, error?: Error): void {
            process.stderr.write(`${red(`[ERROR] [${category}]`)} ${message}\n`);
            if (error && verbosity === 'verbose') {
                process.stderr.write(`${gray(error.stack || error.message)}\n`);
            }
        },
    };
}

// ============================================================================
// Print Helpers (user-facing output)
// ============================================================================

/**
 * Print a success message to stderr
 */
export function printSuccess(message: string): void {
    process.stderr.write(`${green(SYMBOLS.success)} ${message}\n`);
}

/**
 * Print an error message to stderr
 */
export function printError(message: string): void {
    process.stderr.write(`${red(SYMBOLS.error)} ${message}\n`);
}

/**
 * Print a warning message to stderr
 */
export function printWarning(message: string): void {
    process.stderr.write(`${yellow(SYMBOLS.warning)} ${message}\n`);
}

/**
 * Print an info message to stderr
 */
export function printInfo(message: string): void {
    process.stderr.write(`${blue(SYMBOLS.info)} ${message}\n`);
}

/**
 * Print a header/title to stderr
 */
export function printHeader(title: string): void {
    process.stderr.write(`\n${bold(title)}\n`);
}

/**
 * Print a key-value pair to stderr
 */
export function printKeyValue(key: string, value: string): void {
    process.stderr.write(`  ${gray(key + ':')} ${value}\n`);
}
