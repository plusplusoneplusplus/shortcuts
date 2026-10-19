import { spawn } from 'node:child_process';

export interface BrowserApplicationRequest {
    kind: 'navigation' | 'new-window' | 'download';
    url: string;
    deploymentUrl?: string;
    mimeType?: string;
}

export function validActivationUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\/[^/?#]/i.test(value)
        || /[\s\\\u0000-\u001f\u007f-\u009f]/.test(value)) { return false; }
    try {
        const url = new URL(value);
        return !!url.hostname && !url.username && !url.password && !url.hash;
    } catch { return false; }
}

export function isClickOnceRequest(request: BrowserApplicationRequest): boolean {
    if (!request || !['navigation', 'new-window', 'download'].includes(request.kind) || !validActivationUrl(request.url)) { return false; }
    if (request.deploymentUrl !== undefined && !validActivationUrl(request.deploymentUrl)) { return false; }
    const deployment = /\.application$/i.test(new URL(request.deploymentUrl ?? request.url).pathname);
    return deployment || request.kind === 'download' && typeof request.mimeType === 'string'
        && request.mimeType.split(';')[0].trim().toLowerCase() === 'application/x-ms-application';
}

export type ClickOnceResult = 'accepted' | 'cancelled' | 'stale' | 'disabled';

const ACTIVATION_ERRORS = {
    invalid: 'Invalid ClickOnce activation URL.',
    unsupported: 'ClickOnce activation requires Windows x64.',
    unavailable: 'ClickOnce activation helper is unavailable.',
    failed: 'Windows rejected ClickOnce activation.',
    missing: 'Windows ClickOnce support is not installed.',
    unknown: 'ClickOnce activation failed; the outcome is unknown. Do not retry automatically.',
    timeout: 'ClickOnce activation timed out; the outcome is unknown. Do not retry automatically.',
} as const;

export class ClickOnceError extends Error {
    constructor(reason: keyof typeof ACTIVATION_ERRORS) { super(ACTIVATION_ERRORS[reason]); }
}

export interface ClickOncePolicy {
    enabled(): boolean;
    ownerCurrent(ownerId: number): boolean;
    activate(url: string): Promise<'accepted' | 'cancelled'>;
    report(ownerId: number, message: string): void;
}

/** Main-only policy; the validity closure binds the exact owner, guest and document. */
export async function dispatchClickOnce(
    policy: ClickOncePolicy, request: BrowserApplicationRequest, current: () => boolean, ownerId: number,
): Promise<ClickOnceResult> {
    if (!isClickOnceRequest(request)) { throw new Error('Invalid ClickOnce activation request.'); }
    if (!policy.enabled()) { return 'disabled'; }
    if (!current() || !policy.ownerCurrent(ownerId)) { return 'stale'; }
    return policy.activate(request.url);
}

/** No URL in argv, shell, temporary files, child diagnostics or exception text. */
export function activateClickOnce(url: string, binary: () => string, platform = process.platform): Promise<'accepted' | 'cancelled'> {
    if (!validActivationUrl(url)) { return Promise.reject(new ClickOnceError('invalid')); }
    if (platform !== 'win32') { return Promise.reject(new ClickOnceError('unsupported')); }
    return new Promise((resolve, reject) => {
        let child: ReturnType<typeof spawn>;
        try { child = spawn(binary(), ['--clickonce'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], shell: false }); }
        catch { reject(new ClickOnceError('unavailable')); return; }
        let output = '';
        let settled = false;
        const finish = (error?: keyof typeof ACTIVATION_ERRORS, result: 'accepted' | 'cancelled' = 'accepted') => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            if (error) { reject(new ClickOnceError(error)); }
            else { resolve(result); }
        };
        const timer = setTimeout(() => {
            child.kill();
            finish('timeout');
        }, 120_000);
        child.on('error', () => finish('unavailable'));
        child.stdin?.on('error', () => { child.kill(); finish('unknown'); });
        child.stdout?.on('error', () => { child.kill(); finish('unknown'); });
        child.stdout?.on('data', (data: Buffer) => {
            if (settled) { return; }
            output += data.toString('utf8');
            if (output.length > 1024) {
                child.kill();
                finish('unknown');
            }
        });
        child.on('close', code => {
            if (code !== 0) { finish('unknown'); return; }
            try {
                const result: unknown = JSON.parse(output);
                if (result && typeof result === 'object' && 'status' in result && Object.keys(result).length === 1) {
                    if (result.status === 'accepted') { finish(); return; }
                    if (result.status === 'missing-handler') { finish('missing'); return; }
                    if (result.status === 'cancelled') { finish(undefined, 'cancelled'); return; }
                    if (result.status === 'unsupported-platform') { finish('unsupported'); return; }
                    if (result.status === 'activation-failed') { finish('failed'); return; }
                    if (result.status === 'invalid') { finish('invalid'); return; }
                }
            } catch { /* Only fixed diagnostics cross this boundary. */ }
            finish('unknown');
        });
        try { child.stdin!.end(JSON.stringify({ url })); }
        catch { child.kill(); finish('unknown'); }
    });
}
