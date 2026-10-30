import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    decodeNativeTeamsError, loadNativeTeams, NativeTeamsError, TeamsIc3Session,
} from '../src/teams';

const tenant = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const subscription = '33333333-3333-4333-8333-333333333333';
const directories: string[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
    const value = mkdtempSync(path.join(tmpdir(), 'teams-native-fixture-'));
    directories.push(value);
    return value;
}

function fakeCli(mode: 'valid' | 'failure' | 'malformed' | 'hang' = 'valid'): void {
    const root = directory();
    const account = JSON.stringify({
        id: subscription, tenantId: tenant, user: { name: 'fixture-account', type: 'user' },
    });
    const token = JSON.stringify({
        accessToken: 'opaque-fixture', tokenType: 'Bearer', tenant, subscription,
        expires_on: Math.floor(Date.now() / 1000) + 3600,
    });
    const script = process.platform === 'win32'
        ? [
            '@echo off',
            ...(mode === 'hang' ? ['"%SystemRoot%\\System32\\ping.exe" -n 60 127.0.0.1 >nul'] : []),
            ...(mode === 'failure' ? ['echo fixture-private 1>&2', 'exit /b 1'] : [
                'if "%~1"=="ad" (', `echo ${user}`, ') else if "%~2"=="show" (',
                `echo ${account}`, ') else (',
                `echo ${mode === 'malformed' ? 'fixture-private' : token}`, ')', 'exit /b 0',
            ]),
        ].join('\r\n')
        : [
            '#!/bin/sh',
            ...(mode === 'hang' ? ['sleep 60'] : []),
            ...(mode === 'failure' ? ['echo fixture-private >&2', 'exit 1'] : [
                'if [ "$1" = "ad" ]; then', `printf '%s\\n' '${user}'`,
                'elif [ "$2" = "show" ]; then', `printf '%s\\n' '${account}'`,
                'else', `printf '%s\\n' '${mode === 'malformed' ? 'fixture-private' : token}'`, 'fi',
            ]),
        ].join('\n');
    const file = path.join(root, process.platform === 'win32' ? 'az.cmd' : 'az');
    writeFileSync(file, script);
    if (process.platform !== 'win32') chmodSync(file, 0o700);
    vi.stubEnv('PATH', mode === 'hang' && process.platform !== 'win32'
        ? `${root}${path.delimiter}/usr/bin${path.delimiter}/bin` : root);
}

describe('built IC3 session initialization', () => {
    it('validates configuration without touching credentials', () => {
        vi.stubEnv('PATH', directory());
        const native = loadNativeTeams().NativeTeamsIc3Session;
        for (const region of ['amer', 'emea', 'apac']) {
            const session = new native({ region });
            session.dispose();
        }
        for (const options of [
            { region: '' }, { region: 'auto' }, { region: 'AMER' }, { region: 'amer', timeoutMs: 99 },
            { region: 'amer', timeoutMs: 30_001 }, { region: 'amer', expectedTenantId: ' ' },
            { region: 'amer', expectedUserId: '\n' },
        ]) {
            expect(() => new native(options)).toThrow('[teams-sdk:Configuration:NotAttempted::]');
        }
        for (const timeoutMs of [-1, 0.5, NaN, Infinity, 30_001]) {
            expect(() => new TeamsIc3Session({ region: 'amer', timeoutMs }))
                .toThrow(expect.objectContaining({ code: 'Configuration', delivery: 'NotAttempted' }));
        }
        expect(() => Reflect.construct(TeamsIc3Session, [{ region: 'graph' }]))
            .toThrow(NativeTeamsError);
    });

    it('binds verified native identity without exposing tokens or making a Teams request', async () => {
        fakeCli();
        const session = new TeamsIc3Session({ region: 'emea', expectedTenantId: tenant, expectedUserId: user });
        try {
            const account = await session.connect();
            expect(account).toEqual({ tenantId: tenant, userId: user });
            expect(Object.isFrozen(account)).toBe(true);
            expect(JSON.stringify(account)).not.toContain('opaque-fixture');
        } finally { session.dispose(); }
    });

    it.each([
        { expectedTenantId: subscription }, { expectedUserId: subscription },
    ])('rejects mismatched expected identity without fallback: %j', async constraint => {
        fakeCli();
        const session = new TeamsIc3Session({ region: 'amer', ...constraint });
        await expect(session.connect()).rejects.toMatchObject({ code: 'Authentication', delivery: 'NotAttempted' });
        await expect(session.connect()).rejects.toMatchObject({ code: 'Closed' });
    });

    it.each(['failure', 'malformed'] as const)('sanitizes %s credentials and fails closed', async mode => {
        fakeCli(mode);
        const session = new TeamsIc3Session({ region: 'apac' });
        const error = await session.connect().catch(error => error);
        expect(error).toBeInstanceOf(NativeTeamsError);
        expect(error).toMatchObject({ code: 'Authentication', delivery: 'NotAttempted' });
        expect(String(error)).not.toContain('fixture-private');
        expect(error.cause).toBeUndefined();
        await expect(session.connect()).rejects.toMatchObject({ code: 'Closed' });
    });

    it('does not initialize twice or reuse a disposed account', async () => {
        fakeCli();
        const native = new (loadNativeTeams().NativeTeamsIc3Session)({ region: 'amer' });
        await expect(native.connect()).resolves.toEqual({ tenantId: tenant, userId: user });
        expect(() => native.connect()).toThrow('[teams-sdk:InvalidTarget:NotAttempted::]');
        native.dispose();
        native.dispose();
        expect(() => native.connect()).toThrow('[teams-sdk:Closed:NotAttempted::]');
    });

    it('captures disposal before Tokio dispatches and never publishes late credentials', async () => {
        fakeCli('hang');
        const native = new (loadNativeTeams().NativeTeamsIc3Session)({ region: 'amer' });
        const pending = native.connect();
        native.dispose();
        await expect(pending).rejects.toThrow('[teams-sdk:Closed:NotAttempted::]');
    });

    it('disposes one initialization without revoking another handle', async () => {
        fakeCli();
        const native = loadNativeTeams().NativeTeamsIc3Session;
        const first = new native({ region: 'amer' });
        const second = new native({ region: 'apac' });
        try {
            const cancelled = first.connect();
            const surviving = second.connect();
            first.dispose();
            await expect(cancelled).rejects.toThrow('[teams-sdk:Closed:NotAttempted::]');
            await expect(surviving).resolves.toEqual({ tenantId: tenant, userId: user });
        } finally {
            first.dispose();
            second.dispose();
        }
    });

    it('cancels a single handle and removes its AbortSignal listener', async () => {
        fakeCli('hang');
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const session = new TeamsIc3Session({ region: 'amer' });
        const pending = session.connect(controller.signal);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'Cancelled' });
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        await expect(session.connect()).rejects.toMatchObject({ code: 'Closed' });
    });

    it('does not start credential discovery for a pre-aborted signal', async () => {
        vi.stubEnv('PATH', directory());
        const controller = new AbortController();
        controller.abort();
        const session = new TeamsIc3Session({ region: 'amer' });
        await expect(session.connect(controller.signal)).rejects.toMatchObject({ code: 'Cancelled' });
    });

    it('bounds hung CLI initialization and leaves independent handles usable', async () => {
        fakeCli('hang');
        const session = new TeamsIc3Session({ region: 'amer', timeoutMs: 100 });
        await expect(session.connect()).rejects.toMatchObject({ code: 'Timeout', delivery: 'NotAttempted' });
        fakeCli();
        const next = new TeamsIc3Session({ region: 'amer' });
        try { await expect(next.connect()).resolves.toEqual({ tenantId: tenant, userId: user }); }
        finally { next.dispose(); }
    });
});

describe('safe Teams diagnostics and capability guard', () => {
    it('preserves delivery uncertainty, safe status and retry metadata only', () => {
        for (const delivery of ['NotAttempted', 'Rejected', 'Unknown']) {
            const failure = new Error(`[teams-sdk:RateLimited:${delivery}:429:2000] fixture-private`);
            const error = (() => { try { decodeNativeTeamsError(failure); } catch (error) { return error; } })();
            expect(error).toMatchObject({ code: 'RateLimited', delivery, status: 429, retryAfterMs: 2000 });
            expect(String(error)).not.toContain('fixture-private');
            expect((error as Error).cause).toBeUndefined();
        }
        expect(() => decodeNativeTeamsError(new Error('fixture-private')))
            .toThrow(expect.objectContaining({ code: 'Protocol', delivery: 'Unknown' }));
    });

    describe('built IC3 read boundary', () => {
        it('requires connection and rejects reads after disposal', async () => {
            const session = new TeamsIc3Session({ region: 'amer' });
            await expect(session.readChats()).rejects.toMatchObject({ code: 'InvalidTarget' });
            await expect(session.readHistory('48:notes')).rejects.toMatchObject({ code: 'InvalidTarget' });
            session.dispose();
            await expect(session.readChats()).rejects.toMatchObject({ code: 'Closed' });
        });

        it('marshals session-owned read handles, with isolated cancellation and no source writes', async () => {
            fakeCli();
            const native = new (loadNativeTeams().NativeTeamsIc3Session)({ region: 'emea' });
            await native.connect();
            try {
                for (const read of [native.beginRead(), native.beginRead()]) {
                    read.cancel();
                    expect(() => read.readChats()).toThrow('[teams-sdk:Cancelled:NotAttempted::]');
                }
                const invalid = native.beginRead();
                expect(() => invalid.readHistory(' ')).toThrow('[teams-sdk:InvalidTarget:NotAttempted::]');
                invalid.cancel();
                const forged = native.beginRead();
                expect(() => forged.readChats({})).toThrow();
                forged.cancel();
                const history = native.beginRead();
                history.cancel();
                expect(() => history.readHistory('48:notes')).toThrow('[teams-sdk:Cancelled:NotAttempted::]');
                const closed = native.beginRead();
                native.dispose();
                expect(() => closed.readChats()).toThrow('[teams-sdk:Closed:NotAttempted::]');
                expect(Object.getOwnPropertyNames(Object.getPrototypeOf(native)).sort())
                    .toEqual(['beginRead', 'connect', 'constructor', 'dispose']);
            } finally { native.dispose(); }
        });

        it('does not cancel the account for a pre-aborted read', async () => {
            fakeCli();
            const session = new TeamsIc3Session({ region: 'amer' });
            await session.connect();
            const controller = new AbortController();
            controller.abort();
            await expect(session.readChats({ signal: controller.signal })).rejects.toMatchObject({ code: 'Cancelled' });
            await expect(session.readHistory('48:notes', { signal: controller.signal })).rejects.toMatchObject({ code: 'Cancelled' });
            // Invalid input reaches the still-live native handle without a network request.
            await expect(session.readHistory(' ')).rejects.toMatchObject({ code: 'InvalidTarget' });
            session.dispose();
        });
    });

    describe('IC3 read wrapper with an injected native boundary', () => {
        async function fixture() {
            vi.resetModules();
            const requests: Read[] = [];
            let action: (kind: string, target: unknown, cursor: unknown) => Promise<unknown> = async () => ({
                items: [], rawCount: 0,
            });
            class Read {
                cancel() {}
                readChats(cursor: unknown) { return action('chats', undefined, cursor); }
                readHistory(target: string, cursor: unknown) { return action('history', target, cursor); }
                readThread(target: string, root: string, cursor: unknown) { return action('thread', { target, root }, cursor); }
            }
            class Session {
                async connect() { return { tenantId: tenant, userId: user }; }
                dispose() {}
                beginRead() {
                    const request = new Read();
                    vi.spyOn(request, 'cancel');
                    requests.push(request);
                    return request;
                }
            }
            vi.doMock('../src/loader', async importOriginal => {
                const original = await importOriginal<typeof import('../src/loader')>();
                return { ...original, loadNativeAddon: () => ({
                    NativeTeamsIc3Session: Session, NativeTeamsIc3Read: Read,
                }) };
            });
            const { TeamsIc3Session: SessionWrapper } = await import('../src/teams');
            return {
                session: new SessionWrapper({ region: 'amer' }),
                requests,
                setAction: (value: typeof action) => { action = value; },
            };
        }

        afterEach(() => { vi.doUnmock('../src/loader'); vi.resetModules(); });

        it('preserves continuation and raw coverage without inventing self-chat discovery', async () => {
            const { session, requests, setAction } = await fixture();
            const cursor = Object.freeze({});
            const action = vi.fn(async () => ({
                items: [{ chatId: 'fixture-group', kind: 'group' }], rawCount: 3, next: cursor,
            }));
            setAction(action);
            const page = await session.readChats();
            expect(page).toEqual({
                items: [{ chatId: 'fixture-group', kind: 'group' }], rawCount: 3, next: cursor,
            });
            expect(Object.isFrozen(page)).toBe(true);
            expect(Object.isFrozen(page.items)).toBe(true);
            expect(Object.isFrozen(page.items[0])).toBe(true);
            await session.readChats({ cursor: page.next });
            expect(action.mock.calls).toEqual([['chats', undefined, undefined], ['chats', undefined, cursor]]);
            expect(requests.every(request => vi.mocked(request.cancel).mock.calls.length === 1)).toBe(true);
        });

        it('preserves transient history, missing author evidence, edits, tombstones and truncation', async () => {
            const { session, setAction } = await fixture();
            const message = {
                chatId: '48:notes', messageId: 'fixture-message',
                createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-01T01:00:00Z',
                deleted: false, authorKind: 'user', authorId: user,
                text: '@coc fixture', textTruncated: true, untrustedHtml: '<blockquote>fixture</blockquote>',
                htmlTruncated: false, mentionedUserIds: ['fixture-user'],
            };
            const action = vi.fn(async () => ({
                items: [message, { ...message, deleted: true, authorKind: 'unknown', authorId: undefined, text: '' }],
                rawCount: 2, next: null,
            }));
            setAction(action);
            const page = await session.readHistory('48:notes');
            expect(action.mock.calls).toEqual([['history', '48:notes', undefined]]);
            expect(page.items).toEqual([message, {
                ...message, deleted: true, authorKind: 'unknown', authorId: undefined, text: '',
            }]);
            expect(Object.isFrozen(page.items[0].mentionedUserIds)).toBe(true);
            expect(page.next).toBeUndefined();
        });

        it('passes exact thread scope and continuation through the cancellable wrapper', async () => {
            const { session, requests, setAction } = await fixture();
            const cursor = Object.freeze({});
            const root = { chatId: '19:fixture@thread.v2', messageId: '1790000000000',
                rootMessageId: undefined, text: 'Root context', mentionedUserIds: ['fixture-user'] };
            const action = vi.fn(async () => ({ items: [root], next: cursor, rawCount: 1 }));
            setAction(action);
            const page = await session.readThread(root.chatId, root.messageId);
            expect(page.items[0]).toEqual(root);
            expect(Object.isFrozen(page.items[0])).toBe(true);
            expect(Object.isFrozen(page.items[0].mentionedUserIds)).toBe(true);
            await session.readThread(root.chatId, root.messageId, { cursor: page.next });
            expect(action.mock.calls).toEqual([
                ['thread', { target: root.chatId, root: root.messageId }, undefined],
                ['thread', { target: root.chatId, root: root.messageId }, cursor],
            ]);
            expect(requests.every(request => vi.mocked(request.cancel).mock.calls.length === 1)).toBe(true);
        });

        it('cancels only the pending read, removes listeners and rejects late results', async () => {
            const { session, requests, setAction } = await fixture();
            let resolve!: (value: unknown) => void;
            setAction(() => new Promise(done => { resolve = done; }));
            const controller = new AbortController();
            const remove = vi.spyOn(controller.signal, 'removeEventListener');
            const pending = session.readHistory('48:notes', { signal: controller.signal });
            controller.abort();
            expect(requests[0].cancel).toHaveBeenCalledOnce();
            resolve({ items: [], rawCount: 0 });
            await expect(pending).rejects.toMatchObject({ code: 'Cancelled' });
            expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
            setAction(async () => ({ items: [], rawCount: 0 }));
            await expect(session.readChats()).resolves.toMatchObject({ items: [], rawCount: 0 });
        });

        it('sanitizes read failures without returning an empty success or poisoning other reads', async () => {
            const { session, requests, setAction } = await fixture();
            setAction(async () => { throw new Error('[teams-sdk:RateLimited:Rejected:429:2000] fixture-private'); });
            const failure = await session.readChats().catch(error => error);
            expect(failure).toMatchObject({ code: 'RateLimited', delivery: 'Rejected', status: 429, retryAfterMs: 2000 });
            expect(String(failure)).not.toContain('fixture-private');
            expect(requests[0].cancel).toHaveBeenCalledOnce();
            setAction(async () => ({ items: [], rawCount: 0 }));
            await expect(session.readHistory('48:notes')).resolves.toMatchObject({ items: [] });
        });
    });

    it('requires the complete native capability without a transport fallback', async () => {
        vi.resetModules();
        vi.doMock('../src/loader', async importOriginal => {
            const original = await importOriginal<typeof import('../src/loader')>();
            return { ...original, loadNativeAddon: () => ({ NativeTeamsIc3Session: class { connect() {} } }) };
        });
        try {
            const { loadNativeTeams: load } = await import('../src/teams');
            expect(load).toThrow(/missing IC3 Teams session capability.*Rebuild/);
        } finally {
            vi.doUnmock('../src/loader');
            vi.resetModules();
        }
    });
});
