/**
 * Utility functions for executing shell commands
 */

import { exec, ExecOptions } from 'child_process';

/**
 * Execute a shell command asynchronously
 * @param command Command to execute
 * @param options Execution options
 * @returns Promise with stdout and stderr
 */
export function execAsync(
    command: string,
    options?: ExecOptions
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const defaultOptions: ExecOptions = {
            timeout: 30000, // 30 second default timeout
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            ...options
        };

        exec(command, { ...defaultOptions, encoding: 'utf-8' }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout: stdout as string, stderr: stderr as string });
            }
        });
    });
}
