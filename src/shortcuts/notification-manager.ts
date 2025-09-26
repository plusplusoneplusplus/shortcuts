import * as vscode from 'vscode';

export interface NotificationOptions {
    timeout?: number; // timeout in milliseconds
    actions?: string[];
}

export class NotificationManager {
    private static timeouts = new Map<number, NodeJS.Timeout>();
    private static notificationId = 0;

    /**
     * Show an information message with optional timeout
     * @param message Message to show
     * @param options Options including timeout and actions
     * @returns Promise resolving to selected action or undefined
     */
    static async showInfo(message: string, options: NotificationOptions = {}): Promise<string | undefined> {
        const { timeout, actions = [] } = options;

        if (timeout && timeout > 0) {
            return this.showNotificationWithTimeout(
                () => vscode.window.showInformationMessage(message, ...actions),
                timeout
            );
        }

        return vscode.window.showInformationMessage(message, ...actions);
    }

    /**
     * Show a warning message with optional timeout
     * @param message Message to show
     * @param options Options including timeout and actions
     * @returns Promise resolving to selected action or undefined
     */
    static async showWarning(message: string, options: NotificationOptions = {}): Promise<string | undefined> {
        const { timeout, actions = [] } = options;

        if (timeout && timeout > 0) {
            return this.showNotificationWithTimeout(
                () => vscode.window.showWarningMessage(message, ...actions),
                timeout
            );
        }

        return vscode.window.showWarningMessage(message, ...actions);
    }

    /**
     * Show an error message with optional timeout
     * @param message Message to show
     * @param options Options including timeout and actions
     * @returns Promise resolving to selected action or undefined
     */
    static async showError(message: string, options: NotificationOptions = {}): Promise<string | undefined> {
        const { timeout, actions = [] } = options;

        if (timeout && timeout > 0) {
            return this.showNotificationWithTimeout(
                () => vscode.window.showErrorMessage(message, ...actions),
                timeout
            );
        }

        return vscode.window.showErrorMessage(message, ...actions);
    }

    /**
     * Show a notification with automatic timeout
     * @param notificationFn Function that shows the notification
     * @param timeout Timeout in milliseconds
     * @returns Promise resolving to selected action or undefined
     */
    private static async showNotificationWithTimeout<T>(
        notificationFn: () => Thenable<T>,
        timeout: number
    ): Promise<T | undefined> {
        const id = ++this.notificationId;

        // Create a promise that resolves after the timeout
        const timeoutPromise = new Promise<undefined>((resolve) => {
            const timeoutId = setTimeout(() => {
                this.timeouts.delete(id);
                resolve(undefined);
            }, timeout);

            this.timeouts.set(id, timeoutId);
        });

        // Race between the notification and the timeout
        const notificationPromise = notificationFn().then((result) => {
            // If user interacts with notification before timeout, clear the timeout
            const timeoutId = this.timeouts.get(id);
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.timeouts.delete(id);
            }
            return result;
        });

        // Return whichever resolves first
        return Promise.race([notificationPromise, timeoutPromise]);
    }

    /**
     * Clear all active timeouts
     */
    static clearAllTimeouts(): void {
        this.timeouts.forEach((timeoutId) => {
            clearTimeout(timeoutId);
        });
        this.timeouts.clear();
    }

    /**
     * Dispose of resources
     */
    static dispose(): void {
        this.clearAllTimeouts();
    }
}