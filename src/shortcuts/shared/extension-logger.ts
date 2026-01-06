/**
 * ExtensionLogger - Centralized logging framework for the Shortcuts extension
 * 
 * Provides structured logging to VSCode's Output Channel with support for:
 * - Multiple log categories (AI Service, Git, Configuration, etc.)
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - Contextual metadata
 * - Cross-platform compatibility (Windows, macOS, Linux)
 * 
 * Usage:
 *   const logger = getExtensionLogger();
 *   logger.info('MyCategory', 'Operation completed', { duration: 100 });
 *   logger.error('MyCategory', 'Operation failed', error, { context: 'value' });
 */

import * as vscode from 'vscode';

/**
 * Log levels for extension operations
 */
export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR'
}

/**
 * Predefined log categories for common extension features
 */
export enum LogCategory {
    /** AI Service operations (Copilot CLI, clarifications, code review) */
    AI = 'AI Service',
    /** Git operations (commits, changes, diff) */
    GIT = 'Git',
    /** Configuration management */
    CONFIG = 'Configuration',
    /** Markdown comments feature */
    MARKDOWN = 'Markdown Comments',
    /** Git diff comments feature */
    DIFF_COMMENTS = 'Diff Comments',
    /** Discovery feature */
    DISCOVERY = 'Discovery',
    /** Sync operations */
    SYNC = 'Sync',
    /** Tasks viewer */
    TASKS = 'Tasks',
    /** General extension operations */
    EXTENSION = 'Extension',
    /** File system operations */
    FILESYSTEM = 'FileSystem'
}

/**
 * Log entry structure
 */
export interface LogEntry {
    level: LogLevel;
    category: string;
    message: string;
    timestamp: Date;
    context?: Record<string, unknown>;
    error?: Error;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
    /** Output channel name (default: 'Shortcuts') */
    channelName?: string;
    /** Maximum number of log entries to keep in history */
    maxHistorySize?: number;
    /** Minimum log level to output (default: DEBUG in dev, INFO in prod) */
    minLevel?: LogLevel;
    /** Whether to also log to console (default: true in dev) */
    logToConsole?: boolean;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: Required<LoggerConfig> = {
    channelName: 'Shortcuts',
    maxHistorySize: 1000,
    minLevel: LogLevel.DEBUG,
    logToConsole: true
};

/**
 * Log level priority for filtering
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3
};

/**
 * Singleton logger for the Shortcuts extension.
 * Logs to VSCode's Output Channel for visibility in the IDE.
 */
export class ExtensionLogger implements vscode.Disposable {
    private static instance: ExtensionLogger | undefined;
    
    private outputChannel: vscode.OutputChannel | undefined;
    private initialized = false;
    private logHistory: LogEntry[] = [];
    private config: Required<LoggerConfig>;
    private categoryFilters: Set<string> = new Set();

    private constructor(config?: LoggerConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Get the singleton instance of ExtensionLogger
     */
    static getInstance(config?: LoggerConfig): ExtensionLogger {
        if (!ExtensionLogger.instance) {
            ExtensionLogger.instance = new ExtensionLogger(config);
        }
        return ExtensionLogger.instance;
    }

    /**
     * Initialize the logger with VSCode's Output Channel.
     * Must be called during extension activation.
     */
    initialize(config?: LoggerConfig): void {
        if (this.initialized) {
            return;
        }

        if (config) {
            this.config = { ...this.config, ...config };
        }

        this.outputChannel = vscode.window.createOutputChannel(this.config.channelName);
        this.initialized = true;
        this.info(LogCategory.EXTENSION, 'Logger initialized', {
            channelName: this.config.channelName,
            minLevel: this.config.minLevel
        });
    }

    /**
     * Check if the logger is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Set the minimum log level
     */
    setMinLevel(level: LogLevel): void {
        this.config.minLevel = level;
    }

    /**
     * Add a category filter (only show logs from these categories)
     * Pass empty to show all categories
     */
    setCategoryFilter(categories: string[]): void {
        this.categoryFilters.clear();
        categories.forEach(c => this.categoryFilters.add(c));
    }

    /**
     * Log a debug message
     */
    debug(category: string | LogCategory, message: string, context?: Record<string, unknown>): void {
        this.log(LogLevel.DEBUG, category, message, context);
    }

    /**
     * Log an info message
     */
    info(category: string | LogCategory, message: string, context?: Record<string, unknown>): void {
        this.log(LogLevel.INFO, category, message, context);
    }

    /**
     * Log a warning message
     */
    warn(category: string | LogCategory, message: string, context?: Record<string, unknown>): void {
        this.log(LogLevel.WARN, category, message, context);
    }

    /**
     * Log an error message
     */
    error(category: string | LogCategory, message: string, error?: Error, context?: Record<string, unknown>): void {
        this.log(LogLevel.ERROR, category, message, context, error);
    }

    // ============================================
    // Convenience methods for common operations
    // ============================================

    /**
     * Log an operation start
     */
    logOperationStart(category: string | LogCategory, operation: string, context?: Record<string, unknown>): void {
        this.info(category, `Starting: ${operation}`, context);
    }

    /**
     * Log an operation completion
     */
    logOperationComplete(category: string | LogCategory, operation: string, durationMs?: number, context?: Record<string, unknown>): void {
        this.info(category, `Completed: ${operation}`, {
            ...context,
            durationMs
        });
    }

    /**
     * Log an operation failure
     */
    logOperationFailed(category: string | LogCategory, operation: string, error?: Error, context?: Record<string, unknown>): void {
        this.error(category, `Failed: ${operation}`, error, {
            ...context,
            platform: process.platform,
            nodeVersion: process.version
        });
    }

    // ============================================
    // AI Service specific convenience methods
    // ============================================

    /**
     * Log an AI process launch attempt
     */
    logAIProcessLaunch(prompt: string, workingDirectory: string, command?: string): void {
        this.info(LogCategory.AI, 'Launching AI process', {
            promptPreview: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
            workingDirectory,
            command: command ? this.sanitizeCommand(command) : undefined,
            platform: process.platform
        });
    }

    /**
     * Log an AI process launch failure
     */
    logAIProcessLaunchFailure(reason: string, error?: Error, context?: Record<string, unknown>): void {
        this.error(LogCategory.AI, `AI process launch failed: ${reason}`, error, {
            ...context,
            platform: process.platform,
            nodeVersion: process.version
        });
    }

    /**
     * Log an AI process completion
     */
    logAIProcessComplete(processId: string, durationMs: number, success: boolean): void {
        const level = success ? LogLevel.INFO : LogLevel.WARN;
        this.log(level, LogCategory.AI, `AI process ${success ? 'completed' : 'failed'}`, {
            processId,
            durationMs,
            success
        });
    }

    /**
     * Log an AI process cancellation
     */
    logAIProcessCancelled(processId: string, reason: string): void {
        this.info(LogCategory.AI, 'AI process cancelled', {
            processId,
            reason
        });
    }

    /**
     * Log a program existence check
     */
    logProgramCheck(programName: string, exists: boolean, path?: string, error?: string): void {
        if (exists) {
            this.debug(LogCategory.AI, `Program check: ${programName} found`, { path });
        } else {
            this.warn(LogCategory.AI, `Program check: ${programName} not found`, { error });
        }
    }

    // ============================================
    // Output channel management
    // ============================================

    /**
     * Show the output channel to the user
     */
    show(preserveFocus = true): void {
        this.outputChannel?.show(preserveFocus);
    }

    /**
     * Get recent log entries (for testing or debugging)
     */
    getRecentLogs(count = 50): LogEntry[] {
        return this.logHistory.slice(-count);
    }

    /**
     * Get logs filtered by category
     */
    getLogsByCategory(category: string, count = 50): LogEntry[] {
        return this.logHistory
            .filter(entry => entry.category === category)
            .slice(-count);
    }

    /**
     * Get logs filtered by level
     */
    getLogsByLevel(level: LogLevel, count = 50): LogEntry[] {
        return this.logHistory
            .filter(entry => entry.level === level)
            .slice(-count);
    }

    /**
     * Clear the output channel and history
     */
    clear(): void {
        this.outputChannel?.clear();
        this.logHistory = [];
    }

    // ============================================
    // Private methods
    // ============================================

    /**
     * Core logging method
     */
    private log(level: LogLevel, category: string, message: string, context?: Record<string, unknown>, error?: Error): void {
        // Check level filter
        if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.config.minLevel]) {
            return;
        }

        // Check category filter
        if (this.categoryFilters.size > 0 && !this.categoryFilters.has(category)) {
            return;
        }

        const timestamp = new Date();
        const entry: LogEntry = {
            level,
            category,
            message,
            timestamp,
            context,
            error
        };

        // Add to history
        this.logHistory.push(entry);
        if (this.logHistory.length > this.config.maxHistorySize) {
            this.logHistory.shift();
        }

        // Format the log message
        const formattedMessage = this.formatLogMessage(entry);

        // Output to channel if initialized
        if (this.outputChannel) {
            this.outputChannel.appendLine(formattedMessage);
        }

        // Also log to console if enabled
        if (this.config.logToConsole) {
            this.logToConsole(level, formattedMessage, error);
        }
    }

    /**
     * Format a log entry for output
     */
    private formatLogMessage(entry: LogEntry): string {
        const timestamp = entry.timestamp.toISOString();
        const levelPadded = entry.level.padEnd(5);
        const categoryPadded = `[${entry.category}]`.padEnd(20);
        
        let message = `[${timestamp}] ${levelPadded} ${categoryPadded} ${entry.message}`;

        if (entry.context && Object.keys(entry.context).length > 0) {
            message += `\n  Context: ${JSON.stringify(entry.context, null, 2).replace(/\n/g, '\n  ')}`;
        }

        if (entry.error) {
            message += `\n  Error: ${entry.error.message}`;
            if (entry.error.stack) {
                // Format stack trace with indentation
                const stackLines = entry.error.stack.split('\n').slice(1);
                message += `\n  Stack:\n    ${stackLines.join('\n    ')}`;
            }
        }

        return message;
    }

    /**
     * Log to console based on level
     */
    private logToConsole(level: LogLevel, message: string, error?: Error): void {
        const prefix = '[Shortcuts]';
        switch (level) {
            case LogLevel.DEBUG:
                console.debug(prefix, message);
                break;
            case LogLevel.INFO:
                console.log(prefix, message);
                break;
            case LogLevel.WARN:
                console.warn(prefix, message);
                break;
            case LogLevel.ERROR:
                console.error(prefix, message, error || '');
                break;
        }
    }

    /**
     * Sanitize command for logging (hide sensitive info)
     */
    private sanitizeCommand(command: string): string {
        // Don't log the full prompt content, just the command structure
        // This prevents sensitive data from being logged
        const promptMatch = command.match(/(-p\s+)(['"].*['"])/);
        if (promptMatch) {
            return command.replace(promptMatch[2], '"<prompt content hidden>"');
        }
        return command;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.outputChannel?.dispose();
        this.outputChannel = undefined;
        this.initialized = false;
        this.logHistory = [];
        ExtensionLogger.instance = undefined;
    }
}

/**
 * Get the singleton extension logger instance.
 * Convenience function for easy access.
 */
export function getExtensionLogger(): ExtensionLogger {
    return ExtensionLogger.getInstance();
}

// ============================================
// Backward compatibility aliases for AI Service
// ============================================

/**
 * @deprecated Use LogLevel instead
 */
export const AILogLevel = LogLevel;

/**
 * @deprecated Use LogEntry instead
 */
export type AILogEntry = LogEntry;

/**
 * @deprecated Use ExtensionLogger instead
 */
export const AIServiceLogger = ExtensionLogger;

/**
 * @deprecated Use getExtensionLogger instead
 */
export function getAIServiceLogger(): ExtensionLogger {
    return getExtensionLogger();
}

