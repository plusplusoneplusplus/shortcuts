import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateClickOnce, dispatchClickOnce, isClickOnceRequest, validActivationUrl, type ClickOncePolicy } from '../src/browser-clickonce';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

const url = 'https://fixture.test/App.application?value=a%2Fb+z&value=second&empty=';
const request = { kind: 'navigation' as const, url };
function policy(): ClickOncePolicy {
    return { enabled: vi.fn(() => true), ownerCurrent: vi.fn(() => true), activate: vi.fn(async () => 'accepted' as const), report: vi.fn() };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('ClickOnce main-process policy', () => {
    it('accepts only bounded HTTPS deployment URLs or the deployment MIME on downloads', () => {
        expect(isClickOnceRequest(request)).toBe(true);
        expect(isClickOnceRequest({ kind: 'download', url: 'https://fixture.test/deploy?value=synthetic', mimeType: 'Application/X-MS-Application; charset=utf-8' })).toBe(true);
        expect(isClickOnceRequest({ kind: 'navigation', url: 'https://fixture.test/redirect?value=synthetic', deploymentUrl: url })).toBe(true);
        for (const invalid of [
            'file:///app.application', 'http://fixture.test/app.application', 'javascript:alert(1)',
            'https://name:password@fixture.test/app.application', 'https://fixture.test\\app.application',
            `${url}\n`, `${url}#part`, ` ${url}`, 'https://fixture.test/' + 'a'.repeat(2048),
        ]) {
            expect(validActivationUrl(invalid), invalid).toBe(false);
            expect(isClickOnceRequest({ ...request, url: invalid })).toBe(false);
        }
        expect(isClickOnceRequest({ kind: 'navigation', url: 'https://fixture.test/', mimeType: 'application/x-ms-application' })).toBe(false);
        expect(isClickOnceRequest({ kind: 'download', url: 'https://fixture.test/report.pdf', mimeType: 'application/pdf' })).toBe(false);
        expect(isClickOnceRequest({ ...request, deploymentUrl: 'file:///app.application' })).toBe(false);
        const prefix = 'https://fixture.test/app.application?value=';
        const boundary = prefix + 'a'.repeat(2048 - prefix.length);
        expect(validActivationUrl(boundary)).toBe(true);
        expect(validActivationUrl(boundary + 'a')).toBe(false);
        expect(validActivationUrl('https:///fixture.test/app.application')).toBe(false);
        expect(validActivationUrl(url + '\u0085')).toBe(false);
    });

    it('dispatches directly without confirmation, retaining default-off and lifecycle checks and the exact URL', async () => {
        const p = policy();
        vi.mocked(p.enabled).mockReturnValueOnce(false);
        expect(await dispatchClickOnce(p, request, () => true, 7)).toBe('disabled');
        expect(p.activate).not.toHaveBeenCalled();
        expect(await dispatchClickOnce(p, request, () => false, 7)).toBe('stale');
        expect(p.activate).not.toHaveBeenCalled();
        const dispatched = dispatchClickOnce(p, request, () => true, 7);
        expect(p.ownerCurrent).toHaveBeenCalledExactlyOnceWith(7);
        expect(p.activate).toHaveBeenCalledExactlyOnceWith(url);
        expect(await dispatched).toBe('accepted');
    });

    it('rejects an unregistered or replaced owner before activation', async () => {
        const p = policy();
        vi.mocked(p.ownerCurrent).mockReturnValue(false);
        expect(await dispatchClickOnce(p, request, () => true, 7)).toBe('stale');
        expect(p.activate).not.toHaveBeenCalled();
    });

    it('rejects malformed requests without echoing their values and propagates native cancellation', async () => {
        const p = policy();
        await expect(dispatchClickOnce(p, { ...request, url: 'file:///synthetic.application?private=value' }, () => true, 7))
            .rejects.toThrow('Invalid ClickOnce activation request.');
        expect(p.activate).not.toHaveBeenCalled();
        vi.mocked(p.activate).mockResolvedValue('cancelled');
        expect(await dispatchClickOnce(p, request, () => true, 7)).toBe('cancelled');
    });
});

function child() {
    const input: string[] = [];
    const stdin = new Writable({ write(data, _encoding, done) { input.push(data.toString()); done(); } });
    const process = Object.assign(new EventEmitter(), { stdin, stdout: new PassThrough(), kill: vi.fn() });
    mocks.spawn.mockReturnValueOnce(process);
    const finish = (status: string, code = 0) => {
        process.stdout.write(JSON.stringify({ status }));
        process.emit('close', code);
    };
    return { process, input, finish };
}

describe('isolated Windows activation dispatch', () => {
    it('sends the unchanged URL only through stdin with fixed arguments and no shell', async () => {
        const c = child();
        const pending = activateClickOnce(url, () => 'native-helper.exe', 'win32');
        expect(mocks.spawn).toHaveBeenCalledWith('native-helper.exe', ['--clickonce'], {
            windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], shell: false,
        });
        expect(JSON.parse(c.input.join(''))).toEqual({ url });
        c.finish('accepted');
        expect(await pending).toBe('accepted');
    });
    it('reports missing handlers, cancellation and HRESULT failures distinctly', async () => {
        for (const [status, message] of [['missing-handler', 'not installed'], ['activation-failed', 'Windows rejected']]) {
            const c = child();
            const pending = activateClickOnce(url, () => 'native-helper.exe', 'win32');
            const assertion = expect(pending).rejects.toThrow(message);
            c.finish(status);
            await assertion;
        }
        const c = child();
        const pending = activateClickOnce(url, () => 'native-helper.exe', 'win32');
        c.finish('cancelled');
        expect(await pending).toBe('cancelled');
    });
    it('never spawns on unsupported platforms or invalid URLs', async () => {
        for (const platform of ['darwin', 'linux']) await expect(activateClickOnce(url, () => 'unused', platform)).rejects.toThrow('requires Windows');
        await expect(activateClickOnce('file:///synthetic.application', () => 'unused', 'win32')).rejects.toThrow('Invalid');
        expect(mocks.spawn).not.toHaveBeenCalled();
    });
    it('sanitizes resolver, process, input and response errors', async () => {
        await expect(activateClickOnce(url, () => { throw new Error(url); }, 'win32')).rejects.toThrow('helper is unavailable');
        mocks.spawn.mockImplementationOnce(() => { throw new Error(url); });
        await expect(activateClickOnce(url, () => 'native-helper.exe', 'win32')).rejects.toThrow('helper is unavailable');
        for (const event of ['error', 'input', 'close', 'output', 'output-error']) {
            const c = child();
            const pending = activateClickOnce(url, () => 'native-helper.exe', 'win32');
            const assertion = expect(pending).rejects.not.toThrow(url);
            if (event === 'error') c.process.emit('error', new Error(url));
            if (event === 'input') c.process.stdin.emit('error', new Error(url));
            if (event === 'close') c.process.emit('close', 1);
            if (event === 'output') { c.process.stdout.write(url.repeat(40)); c.process.emit('close', 0); }
            if (event === 'output-error') c.process.stdout.emit('error', new Error(url));
            await assertion;
        }
    });
    it('bounds dispatch duration and reports unknown outcomes without retrying', async () => {
        vi.useFakeTimers();
        const c = child();
        const pending = activateClickOnce(url, () => 'native-helper.exe', 'win32');
        const assertion = expect(pending).rejects.toThrow('outcome is unknown');
        await vi.advanceTimersByTimeAsync(120_000);
        await assertion;
        expect(c.process.kill).toHaveBeenCalledOnce();
        expect(mocks.spawn).toHaveBeenCalledOnce();
        c.finish('accepted');
    });
    it('treats malformed responses as unknown outcomes, not a rejected or successful activation', async () => {
        const c = child();
        const pending = activateClickOnce(url, () => 'native-helper.exe', 'win32');
        const assertion = expect(pending).rejects.toThrow('outcome is unknown');
        c.process.stdout.write('invalid response');
        c.process.emit('close', 0);
        await assertion;
    });
});
