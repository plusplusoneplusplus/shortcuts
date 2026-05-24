import { execFile, ExecFileOptions } from 'child_process';

export function execFileAsync(
    file: string,
    args: readonly string[] = [],
    options?: ExecFileOptions
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const defaultOptions: ExecFileOptions = {
            timeout: 30000,
            maxBuffer: 50 * 1024 * 1024,
            windowsHide: true,
            ...options,
        };

        execFile(file, args, { ...defaultOptions, encoding: 'utf-8' }, (error, stdout, stderr) => {
            if (error) {
                const stderrStr = typeof stderr === 'string' ? stderr.trim() : '';
                if (stderrStr && !error.message.includes(stderrStr)) {
                    error.message += `\n${stderrStr}`;
                }
                reject(error);
            } else {
                resolve({ stdout: stdout as string, stderr: stderr as string });
            }
        });
    });
}
