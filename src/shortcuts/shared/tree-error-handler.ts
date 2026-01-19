import { getExtensionLogger, LogCategory } from './extension-logger';
import { NotificationManager } from '../notification-manager';

/**
 * Utility class for consistent error handling in tree data providers.
 */
export class TreeErrorHandler {
    constructor(
        private readonly context: string,
        private readonly category: LogCategory = LogCategory.EXTENSION
    ) {}
    
    /**
     * Handles an error by logging it and showing a user notification.
     * @param error Error to handle
     */
    handle(error: unknown): void {
        const err = error instanceof Error ? error : new Error('Unknown error');
        getExtensionLogger().error(this.category, `${this.context} error`, err);
        NotificationManager.showError(`Error in ${this.context}: ${err.message}`);
    }
    
    /**
     * Wraps an async function with error handling.
     * @param fn Function to wrap
     * @param fallback Value to return on error
     * @returns Result of fn or fallback on error
     */
    async wrap<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            this.handle(error);
            return fallback;
        }
    }
    
    /**
     * Normalizes an unknown error to an Error object.
     * @param error Unknown error
     * @returns Error object
     */
    static normalize(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }
}
