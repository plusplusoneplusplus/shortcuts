/**
 * Logger abstraction for pipeline-core package.
 * 
 * This module provides a simple logger interface that can be implemented
 * by different environments (VS Code, CLI, tests, etc.).
 * 
 * Usage:
 *   import { getLogger, setLogger, consoleLogger } from 'pipeline-core';
 *   
 *   // Use default console logger
 *   const logger = getLogger();
 *   logger.info('AI', 'Processing started');
 *   
 *   // Or set a custom logger (e.g., VS Code output channel)
 *   setLogger(myCustomLogger);
 */

/**
 * Log categories for different subsystems
 */
export enum LogCategory {
    /** AI Service operations (Copilot SDK, sessions) */
    AI = 'AI Service',
    /** Map-reduce operations */
    MAP_REDUCE = 'Map-Reduce',
    /** Pipeline execution */
    PIPELINE = 'Pipeline',
    /** Utility operations */
    UTILS = 'Utils',
    /** General operations */
    GENERAL = 'General',
    /** Task management operations */
    TASKS = 'Tasks'
}

/**
 * Logger interface that can be implemented by different environments.
 */
export interface Logger {
    /**
     * Log a debug message (verbose, for development)
     */
    debug(category: string, message: string): void;
    
    /**
     * Log an informational message
     */
    info(category: string, message: string): void;
    
    /**
     * Log a warning message
     */
    warn(category: string, message: string): void;
    
    /**
     * Log an error message with optional Error object
     */
    error(category: string, message: string, error?: Error): void;
}

/**
 * Console-based logger implementation.
 * Outputs to stdout/stderr with timestamps and categories.
 */
export const consoleLogger: Logger = {
    debug: (cat, msg) => console.debug(`[DEBUG] [${cat}] ${msg}`),
    info: (cat, msg) => console.log(`[INFO] [${cat}] ${msg}`),
    warn: (cat, msg) => console.warn(`[WARN] [${cat}] ${msg}`),
    error: (cat, msg, err) => console.error(`[ERROR] [${cat}] ${msg}`, err || ''),
};

/**
 * Null logger that discards all messages.
 * Useful for tests or when logging should be disabled.
 */
export const nullLogger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

/**
 * Global logger instance.
 * Defaults to console logger but can be replaced.
 */
let globalLogger: Logger = consoleLogger;

/**
 * Set the global logger instance.
 * Call this during initialization to use a custom logger.
 * 
 * @param logger The logger implementation to use
 * 
 * @example
 * // In VS Code extension
 * import { setLogger } from 'pipeline-core';
 * import { getExtensionLogger } from './shared/extension-logger';
 * 
 * setLogger({
 *     debug: (cat, msg) => getExtensionLogger().debug(cat, msg),
 *     info: (cat, msg) => getExtensionLogger().info(cat, msg),
 *     warn: (cat, msg) => getExtensionLogger().warn(cat, msg),
 *     error: (cat, msg, err) => getExtensionLogger().error(cat, msg, err),
 * });
 */
export function setLogger(logger: Logger): void {
    globalLogger = logger;
}

/**
 * Get the current global logger instance.
 * 
 * @returns The current logger
 */
export function getLogger(): Logger {
    return globalLogger;
}

/**
 * Reset the logger to the default console logger.
 * Primarily useful for testing.
 */
export function resetLogger(): void {
    globalLogger = consoleLogger;
}
