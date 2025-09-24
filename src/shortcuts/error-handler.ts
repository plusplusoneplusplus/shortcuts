import * as vscode from 'vscode';

/**
 * Error types for better categorization and handling
 */
export enum ErrorType {
    CONFIGURATION_LOAD = 'configuration_load',
    CONFIGURATION_SAVE = 'configuration_save',
    CONFIGURATION_VALIDATION = 'configuration_validation',
    FILE_SYSTEM = 'file_system',
    PATH_RESOLUTION = 'path_resolution',
    PERMISSION = 'permission',
    YAML_PARSING = 'yaml_parsing'
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
    INFO = 'info',
    WARNING = 'warning',
    ERROR = 'error'
}

/**
 * Structured error information
 */
export interface ErrorInfo {
    type: ErrorType;
    severity: ErrorSeverity;
    message: string;
    originalError?: Error;
    context?: Record<string, any>;
}

/**
 * Centralized error handling and user notification system
 */
export class ErrorHandler {
    private static readonly OUTPUT_CHANNEL = 'Shortcuts Panel';
    private static outputChannel: vscode.OutputChannel;

    /**
     * Initialize the error handler
     */
    static initialize(): void {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel(this.OUTPUT_CHANNEL);
        }
    }

    /**
     * Handle an error with appropriate user notification and logging
     * @param errorInfo Error information
     * @returns Promise that resolves when error handling is complete
     */
    static async handleError(errorInfo: ErrorInfo): Promise<void> {
        // Log the error for debugging
        this.logError(errorInfo);

        // Show user notification based on severity
        await this.showUserNotification(errorInfo);
    }

    /**
     * Handle configuration loading errors with fallback behavior
     * @param error Original error
     * @param configPath Path to configuration file
     * @returns User-friendly error message
     */
    static handleConfigurationLoadError(error: Error, configPath: string): string {
        let errorType: ErrorType;
        let userMessage: string;

        if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
            errorType = ErrorType.FILE_SYSTEM;
            userMessage = 'Configuration file not found. A default configuration will be created.';
        } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
            errorType = ErrorType.PERMISSION;
            userMessage = 'Permission denied accessing configuration file. Please check file permissions.';
        } else if (error.message.includes('YAMLException') || error.message.includes('invalid yaml')) {
            errorType = ErrorType.YAML_PARSING;
            userMessage = 'Configuration file contains invalid YAML syntax. Please check the file format.';
        } else {
            errorType = ErrorType.CONFIGURATION_LOAD;
            userMessage = 'Failed to load configuration file. Using default settings.';
        }

        this.handleError({
            type: errorType,
            severity: ErrorSeverity.WARNING,
            message: userMessage,
            originalError: error,
            context: { configPath }
        });

        return userMessage;
    }

    /**
     * Handle configuration saving errors
     * @param error Original error
     * @param configPath Path to configuration file
     * @returns User-friendly error message
     */
    static handleConfigurationSaveError(error: Error, configPath: string): string {
        let errorType: ErrorType;
        let userMessage: string;

        if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
            errorType = ErrorType.PERMISSION;
            userMessage = 'Permission denied saving configuration file. Please check file permissions.';
        } else if (error.message.includes('ENOSPC') || error.message.includes('no space left')) {
            errorType = ErrorType.FILE_SYSTEM;
            userMessage = 'Not enough disk space to save configuration file.';
        } else {
            errorType = ErrorType.CONFIGURATION_SAVE;
            userMessage = 'Failed to save configuration file. Changes may not be persisted.';
        }

        this.handleError({
            type: errorType,
            severity: ErrorSeverity.ERROR,
            message: userMessage,
            originalError: error,
            context: { configPath }
        });

        return userMessage;
    }

    /**
     * Handle path resolution errors
     * @param error Original error
     * @param path Path that failed to resolve
     * @returns User-friendly error message
     */
    static handlePathResolutionError(error: Error, path: string): string {
        let errorType: ErrorType;
        let userMessage: string;

        if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
            errorType = ErrorType.FILE_SYSTEM;
            userMessage = `Path does not exist: ${path}`;
        } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
            errorType = ErrorType.PERMISSION;
            userMessage = `Permission denied accessing path: ${path}`;
        } else {
            errorType = ErrorType.PATH_RESOLUTION;
            userMessage = `Invalid path: ${path}`;
        }

        this.handleError({
            type: errorType,
            severity: ErrorSeverity.WARNING,
            message: userMessage,
            originalError: error,
            context: { path }
        });

        return userMessage;
    }

    /**
     * Handle file system operation errors
     * @param error Original error
     * @param operation Operation that failed
     * @param path Path involved in the operation
     * @returns User-friendly error message
     */
    static handleFileSystemError(error: Error, operation: string, path: string): string {
        let userMessage: string;

        if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
            userMessage = `${operation} failed: Path does not exist (${path})`;
        } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
            userMessage = `${operation} failed: Permission denied (${path})`;
        } else if (error.message.includes('EISDIR')) {
            userMessage = `${operation} failed: Expected file but found directory (${path})`;
        } else if (error.message.includes('ENOTDIR')) {
            userMessage = `${operation} failed: Expected directory but found file (${path})`;
        } else {
            userMessage = `${operation} failed: ${error.message}`;
        }

        this.handleError({
            type: ErrorType.FILE_SYSTEM,
            severity: ErrorSeverity.ERROR,
            message: userMessage,
            originalError: error,
            context: { operation, path }
        });

        return userMessage;
    }

    /**
     * Show informational message to user
     * @param message Message to show
     */
    static showInfo(message: string): void {
        vscode.window.showInformationMessage(message);
        this.logMessage('INFO', message);
    }

    /**
     * Show warning message to user
     * @param message Message to show
     * @param actions Optional action buttons
     * @returns Promise resolving to selected action
     */
    static async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        this.logMessage('WARNING', message);
        return await vscode.window.showWarningMessage(message, ...actions);
    }

    /**
     * Show error message to user
     * @param message Message to show
     * @param actions Optional action buttons
     * @returns Promise resolving to selected action
     */
    static async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        this.logMessage('ERROR', message);
        return await vscode.window.showErrorMessage(message, ...actions);
    }

    /**
     * Log error information for debugging
     * @param errorInfo Error information to log
     */
    private static logError(errorInfo: ErrorInfo): void {
        const timestamp = new Date().toISOString();
        const logLevel = errorInfo.severity.toUpperCase();

        let logMessage = `[${timestamp}] ${logLevel}: ${errorInfo.message}`;

        if (errorInfo.type) {
            logMessage += ` (Type: ${errorInfo.type})`;
        }

        if (errorInfo.context) {
            logMessage += ` Context: ${JSON.stringify(errorInfo.context)}`;
        }

        if (errorInfo.originalError) {
            logMessage += `\nOriginal Error: ${errorInfo.originalError.message}`;
            if (errorInfo.originalError.stack) {
                logMessage += `\nStack Trace: ${errorInfo.originalError.stack}`;
            }
        }

        this.outputChannel.appendLine(logMessage);
        console.log(logMessage);
    }

    /**
     * Log a simple message
     * @param level Log level
     * @param message Message to log
     */
    private static logMessage(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${level}: ${message}`;

        this.outputChannel.appendLine(logMessage);
        console.log(logMessage);
    }

    /**
     * Show user notification based on error severity
     * @param errorInfo Error information
     */
    private static async showUserNotification(errorInfo: ErrorInfo): Promise<void> {
        const actions: string[] = [];

        // Add relevant action buttons based on error type
        if (errorInfo.type === ErrorType.CONFIGURATION_LOAD ||
            errorInfo.type === ErrorType.CONFIGURATION_VALIDATION) {
            actions.push('Open Configuration File', 'Reset to Default');
        } else if (errorInfo.type === ErrorType.PERMISSION) {
            actions.push('Show Help');
        }

        let selectedAction: string | undefined;

        switch (errorInfo.severity) {
            case ErrorSeverity.INFO:
                vscode.window.showInformationMessage(errorInfo.message);
                break;
            case ErrorSeverity.WARNING:
                selectedAction = await vscode.window.showWarningMessage(errorInfo.message, ...actions);
                break;
            case ErrorSeverity.ERROR:
                selectedAction = await vscode.window.showErrorMessage(errorInfo.message, ...actions);
                break;
        }

        // Handle action button clicks
        if (selectedAction) {
            await this.handleUserAction(selectedAction, errorInfo);
        }
    }

    /**
     * Handle user action from error notification
     * @param action Selected action
     * @param errorInfo Original error information
     */
    private static async handleUserAction(action: string, errorInfo: ErrorInfo): Promise<void> {
        switch (action) {
            case 'Open Configuration File':
                if (errorInfo.context?.configPath) {
                    const uri = vscode.Uri.file(errorInfo.context.configPath);
                    await vscode.window.showTextDocument(uri);
                }
                break;
            case 'Reset to Default':
                // This would be handled by the configuration manager
                vscode.commands.executeCommand('shortcuts.resetConfiguration');
                break;
            case 'Show Help':
                vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/editor/workspaces#_workspace-settings'));
                break;
        }
    }

    /**
     * Dispose of resources
     */
    static dispose(): void {
        if (this.outputChannel) {
            this.outputChannel.dispose();
        }
    }
}