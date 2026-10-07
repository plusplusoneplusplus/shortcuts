import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ app: undefined as any, contents: [] as any[] }));
vi.mock('electron', () => ({ get app() { return mocks.app; }, webContents: { getAllWebContents: () => mocks.contents } }));

function contents(id: number, type = 'window', hostWebContents?: any) {
    return Object.assign(new EventEmitter(), {
        id, hostWebContents, getType: () => type, getURL: vi.fn(() => 'https://spa.test/'),
        isDestroyed: vi.fn(() => false), close: vi.fn(), session: {},
    });
}

async function harness() {
    const guard = await import('../src/browser-webview-guard');
    const owner = contents(1);
    const window = Object.assign(new EventEmitter(), { webContents: owner, isDestroyed: () => false });
    guard.installBrowserWebviewGuard();
    mocks.app.emit('web-contents-created', {}, owner);
    guard.registerBrowserEmbedder(window as any, 'https://spa.test/');
    const profile = {};
    const attached = vi.fn();
    const expired = vi.fn();
    const authorization = guard.authorizeBrowserWebview(1, 'https://page.test/', profile as any, attached, expired);
    const attempt = (embedder = owner, override: Record<string, unknown> = {}, preferences: Record<string, unknown> = {}) => {
        const event = { preventDefault: vi.fn() };
        embedder.emit('will-attach-webview', event, preferences, {
            partition: authorization.partition, src: authorization.src, ...override,
        });
        return { event, preferences };
    };
    const createGuest = (id = 2) => {
        const guest = contents(id, 'webview', owner);
        guest.session = profile;
        mocks.app.emit('web-contents-created', {}, guest);
        owner.emit('did-attach-webview', {}, guest);
        return guest;
    };
    return { guard, owner, window, profile, authorization, attempt, attached, expired, createGuest };
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); mocks.app = new EventEmitter(); mocks.contents = []; });
afterEach(() => { vi.useRealTimers(); });

describe('browser webview authorization boundary', () => {
    it('authorizes only a validated exact file, without granting URL tokens file access', async () => {
        const h = await harness();
        const directory = mkdtempSync(path.join(process.cwd(), '.file-guard-'));
        try {
            const file = path.join(directory, 'index.html');
            writeFileSync(file, '<html>preview</html>');
            const src = pathToFileURL(file).href;
            const urlToken = h.guard.authorizeBrowserWebview(1, src, h.profile as any, vi.fn(), vi.fn());
            expect(h.attempt(h.owner, { src, partition: urlToken.partition }).event.preventDefault).toHaveBeenCalledOnce();
            const fileToken = h.guard.authorizeBrowserWebview(1, src, h.profile as any, vi.fn(), vi.fn(), file);
            expect(h.attempt(h.owner, { src: src + '#other', partition: fileToken.partition }).event.preventDefault).toHaveBeenCalledOnce();
            expect(h.attempt(h.owner, { src, partition: fileToken.partition }).event.preventDefault).not.toHaveBeenCalled();
            fileToken.adopt(h.createGuest().id);
            expect(() => fileToken.adopt(2)).toThrow();
            expect(() => h.guard.authorizeBrowserWebview(1, 'https://page.test/', h.profile as any, vi.fn(), vi.fn(), file)).toThrow('does not match');
            expect(() => h.guard.authorizeBrowserWebview(1, src, h.profile as any, vi.fn(), vi.fn(), path.join(directory, 'missing.html'))).toThrow('unavailable');
        } finally { rmSync(directory, { recursive: true, force: true }); }
    });

    it('rejects unregistered, wrong-owner, wrong-source and unknown-token attachments', async () => {
        const h = await harness();
        const other = contents(3);
        mocks.app.emit('web-contents-created', {}, other);
        for (const [owner, params] of [
            [other, {}], [h.owner, { src: 'file:///blocked.html' }],
            [h.owner, { src: 'https://page.test/other' }], [h.owner, { partition: 'forged' }],
        ] as const) {
            expect(h.attempt(owner as any, params).event.preventDefault).toHaveBeenCalledOnce();
        }
        expect(h.attached).not.toHaveBeenCalled();
    });

    it('overwrites every renderer privilege and binds the exact session before navigation', async () => {
        const h = await harness();
        const { event, preferences } = h.attempt(h.owner, {}, {
            preload: '/unsafe/preload.js', nodeIntegration: true, sandbox: false, contextIsolation: false,
            nodeIntegrationInWorker: true, nodeIntegrationInSubFrames: true, webviewTag: true,
            webSecurity: false, allowRunningInsecureContent: true, additionalArguments: ['--unsafe'],
            experimentalFeatures: true, enableBlinkFeatures: 'unsafe',
        });
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(preferences).toMatchObject({
            session: h.profile, sandbox: true, contextIsolation: true, nodeIntegration: false,
            nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false,
            webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false,
        });
        expect(preferences).not.toHaveProperty('preload');
        expect(preferences).not.toHaveProperty('additionalArguments');
        expect(preferences).not.toHaveProperty('enableBlinkFeatures');
        const guest = h.createGuest();
        expect(h.attached).toHaveBeenCalledWith(guest);
        h.authorization.adopt(guest.id);
        expect(() => h.authorization.adopt(guest.id)).toThrow('does not belong');
        expect(() => h.authorization.adopt(100)).toThrow('does not belong');
        expect(h.attempt().event.preventDefault).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(30_001);
        expect(h.expired).not.toHaveBeenCalled();
    });

    it('expires both unattached and attached-but-unadopted handles and revokes the token', async () => {
        const h = await harness();
        h.attempt();
        const guest = h.createGuest();
        vi.advanceTimersByTime(30_000);
        expect(h.expired).toHaveBeenCalledOnce();
        expect(() => h.authorization.adopt(guest.id)).toThrow();
        expect(h.attempt().event.preventDefault).toHaveBeenCalledOnce();
        const expired = vi.fn();
        h.guard.authorizeBrowserWebview(1, 'https://other.test/', h.profile as any, vi.fn(), expired);
        vi.advanceTimersByTime(30_000);
        expect(expired).toHaveBeenCalledOnce();
    });

    it('rejects nested guests and a registered window navigated away from its SPA', async () => {
        const h = await harness();
        h.attempt();
        const guest = h.createGuest();
        expect(h.attempt(guest).event.preventDefault).toHaveBeenCalledOnce();
        h.authorization.dispose();
        const auth = h.guard.authorizeBrowserWebview(1, 'https://page.test/', h.profile as any, vi.fn(), vi.fn());
        h.owner.getURL.mockReturnValue('https://spa.test/untrusted.html');
        expect(h.attempt(h.owner, { partition: auth.partition }).event.preventDefault).toHaveBeenCalledOnce();
        h.owner.getURL.mockReturnValue('https://spa.test/#repos/workspace/browser');
        expect(h.guard.isBrowserEmbedder(h.owner as any)).toBe(true);
        h.window.emit('closed');
        expect(h.guard.isBrowserEmbedder(h.owner as any)).toBe(false);
    });

    it('does not let closing one pending view revoke another view for the same owner', async () => {
        const h = await harness();
        const other = h.guard.authorizeBrowserWebview(1, 'https://other.test/', h.profile as any, vi.fn(), vi.fn());
        h.authorization.dispose();
        expect(h.attempt(h.owner, { src: other.src, partition: other.partition }).event.preventDefault).not.toHaveBeenCalled();
        const guest = h.createGuest();
        expect(() => other.adopt(guest.id)).not.toThrow();
    });

    it('canonicalizes bare server origins and separates concurrent same-URL guests', async () => {
        const h = await harness();
        h.guard.registerBrowserEmbedder(h.window as any, 'https://spa.test');
        const other = h.guard.authorizeBrowserWebview(1, h.authorization.src, h.profile as any, vi.fn(), vi.fn());
        h.attempt();
        const first = h.createGuest(10);
        h.attempt(h.owner, { partition: other.partition });
        const second = h.createGuest(11);
        expect(() => h.authorization.adopt(second.id)).toThrow();
        expect(() => other.adopt(first.id)).toThrow();
        expect(() => h.authorization.adopt(first.id)).not.toThrow();
        expect(() => other.adopt(second.id)).not.toThrow();
    });

    it('rejects overlapping creation and guests in a different session', async () => {
        const h = await harness();
        const other = h.guard.authorizeBrowserWebview(1, 'https://other.test/', h.profile as any, vi.fn(), vi.fn());
        h.attempt();
        expect(h.attempt(h.owner, { partition: other.partition, src: other.src }).event.preventDefault).toHaveBeenCalledOnce();
        const guest = contents(20, 'webview', h.owner);
        mocks.app.emit('web-contents-created', {}, guest);
        vi.runOnlyPendingTimers();
        expect(guest.close).toHaveBeenCalledOnce();
        expect(h.attached).not.toHaveBeenCalled();
    });
});
