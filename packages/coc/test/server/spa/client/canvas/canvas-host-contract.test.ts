/**
 * The canvas-host boundary: one contract, two generated hosts.
 *
 * These are the tests that make the live/offline split safe to keep. The live
 * panel host and the offline export host are built from the SAME method table,
 * so the thing worth asserting is not that each works in isolation (their own
 * suites do that) but that neither can quietly gain or lose a method the other
 * has — the drift that leaves an exported artifact hanging on a promise the
 * panel settles fine.
 */
import { describe, it, expect } from 'vitest';
import {
    CANVAS_HOST_METHODS,
    CANVAS_HOST_VERSION,
    CANVAS_HOST_REQUEST_TIMEOUT_MS,
    canvasHostFailure,
    canvasHostRequestId,
    canvasHostResponse,
    canvasHostStateMessage,
    canvasHostSuccess,
    canvasHostErrorMessage,
    isCanvasHostMessage,
    offlineCanvasHostMessage,
    parseCanvasState,
    serializeCanvasState,
    unsupportedCanvasHostRequest,
} from '../../../../../src/server/spa/client/react/features/canvas/canvas-host-contract';
import {
    buildLiveCanvasHostBootstrap,
    buildOfflineCanvasHostBootstrap,
} from '../../../../../src/server/spa/client/react/features/canvas/canvas-host-bootstrap';

/** Evaluate a generated bootstrap and hand back the `CanvasHost` it installed. */
function installHost(script: string, parent?: { postMessage: (msg: unknown, origin: string) => void }) {
    const body = script.slice(script.indexOf('<script>') + '<script>'.length, script.lastIndexOf('</script>'));
    const listeners: Array<(event: { data: unknown }) => void> = [];
    const frameWindow = {
        CanvasHost: undefined as any,
        addEventListener: (_type: string, cb: (event: { data: unknown }) => void) => { listeners.push(cb); },
    };
    // eslint-disable-next-line no-new-func
    new Function('window', 'parent', 'setTimeout', 'clearTimeout', 'Promise', body)(
        frameWindow,
        parent ?? { postMessage: () => {} },
        setTimeout,
        clearTimeout,
        Promise,
    );
    return {
        host: frameWindow.CanvasHost as Record<string, any>,
        deliver: (data: unknown) => listeners.forEach(cb => cb({ data })),
    };
}

describe('canvas host contract — the method table', () => {
    it('describes every server-backed method exactly once', () => {
        const names = CANVAS_HOST_METHODS.map(m => m.name);
        expect(names).toEqual(['invoke', 'setState', 'listFiles', 'readFile']);
        expect(new Set(names).size).toBe(names.length);
        expect(new Set(CANVAS_HOST_METHODS.map(m => m.requestType)).size).toBe(names.length);
    });

    it('leaves onState out — it is the one method that needs no host', () => {
        expect(CANVAS_HOST_METHODS.some(m => (m.name as string) === 'onState')).toBe(false);
    });
});

describe('canvas host contract — live and offline hosts stay in step', () => {
    const live = installHost(buildLiveCanvasHostBootstrap()).host;
    const offline = installHost(buildOfflineCanvasHostBootstrap('{"count":1}', '{"revision":3,"title":"W"}')).host;

    it('exposes the identical surface in both hosts', () => {
        expect(Object.keys(offline).sort()).toEqual(Object.keys(live).sort());
    });

    it('gives both hosts every table method plus onState, at the same version', () => {
        for (const method of CANVAS_HOST_METHODS) {
            expect(typeof live[method.name]).toBe('function');
            expect(typeof offline[method.name]).toBe('function');
        }
        expect(typeof live.onState).toBe('function');
        expect(typeof offline.onState).toBe('function');
        expect(live.version).toBe(CANVAS_HOST_VERSION);
        expect(offline.version).toBe(CANVAS_HOST_VERSION);
    });

    /**
     * The regression this whole module exists to prevent: a method added to the
     * live host and forgotten offline returns `undefined`, and an artifact that
     * awaits it hangs on a blank page instead of showing its unavailable state.
     */
    it('regression: EVERY server-backed method rejects with code "offline" in an export', async () => {
        for (const method of CANVAS_HOST_METHODS) {
            const result = offline[method.name]('x', {});
            expect(result, `${method.name} must return a promise`).toBeInstanceOf(Promise);
            await expect(result).rejects.toMatchObject({ code: 'offline' });
        }
    });

    it('names the method and the reason in every offline rejection', async () => {
        for (const method of CANVAS_HOST_METHODS) {
            const error = await offline[method.name]('x').catch((e: Error) => e);
            expect(error.message).toBe(offlineCanvasHostMessage(method.name));
            expect(error.message).toContain(method.name);
            expect(error.message).toContain('view-only snapshot');
        }
    });
});

describe('live bootstrap — generated request plumbing', () => {
    it('posts each table method as its declared request type, with a distinct id', () => {
        const posted: any[] = [];
        const { host } = installHost(buildLiveCanvasHostBootstrap(), { postMessage: m => posted.push(m) });
        posted.length = 0; // drop the `ready` announcement

        host.invoke('bump', { n: 1 });
        host.setState({ a: 1 });
        host.listFiles();
        host.readFile('data.csv', { encoding: 'base64' });

        expect(posted.map(m => m.type)).toEqual(CANVAS_HOST_METHODS.map(m => m.requestType));
        expect(posted.map(m => m.id)).toEqual([1, 2, 3, 4]);
        expect(posted.every(m => m.__canvasHost === true)).toBe(true);
        expect(posted[0]).toMatchObject({ name: 'bump', params: { n: 1 } });
        expect(posted[3]).toMatchObject({ path: 'data.csv', options: { encoding: 'base64' } });
    });

    it('defaults absent params/options to an empty object rather than undefined', () => {
        const posted: any[] = [];
        const { host } = installHost(buildLiveCanvasHostBootstrap(), { postMessage: m => posted.push(m) });
        posted.length = 0;

        host.invoke('bump');
        host.readFile('data.csv');

        expect(posted[0].params).toEqual({});
        expect(posted[1].options).toEqual({});
    });

    it('settles a request from the matching response and ignores an unknown id', async () => {
        const posted: any[] = [];
        const { host, deliver } = installHost(buildLiveCanvasHostBootstrap(), { postMessage: m => posted.push(m) });
        const pending = host.invoke('bump');

        deliver({ __canvasHost: true, type: 'response', id: 999, ok: true, result: 'wrong' });
        deliver(canvasHostResponse(1, canvasHostSuccess({ revision: 4 })));

        await expect(pending).resolves.toEqual({ revision: 4 });
    });

    it('rejects with the structured code the host sent', async () => {
        const { host, deliver } = installHost(buildLiveCanvasHostBootstrap());
        const pending = host.setState({ a: 1 });

        deliver(canvasHostResponse(1, canvasHostFailure('revision-conflict', 'stale')));

        await expect(pending).rejects.toMatchObject({ code: 'revision-conflict', message: 'stale' });
    });

    it('advertises the shared version and timeout, not a retyped copy', () => {
        const script = buildLiveCanvasHostBootstrap();
        expect(script).toContain(`version: ${CANVAS_HOST_VERSION}`);
        expect(script).toContain(`var TIMEOUT_MS = ${CANVAS_HOST_REQUEST_TIMEOUT_MS}`);
    });
});

describe('canvas host contract — message helpers', () => {
    it('recognizes only messages addressed to this protocol', () => {
        expect(isCanvasHostMessage({ __canvasHost: true, type: 'ready' })).toBe(true);
        expect(isCanvasHostMessage({ type: 'ready' })).toBe(false);
        expect(isCanvasHostMessage(null)).toBe(false);
        expect(isCanvasHostMessage('ready')).toBe(false);
    });

    it('treats a missing id as a pre-v2 sender rather than a request to drop', () => {
        expect(canvasHostRequestId({ __canvasHost: true, type: 'set-state', id: 7 })).toBe(7);
        expect(canvasHostRequestId({ __canvasHost: true, type: 'set-state' })).toBeNull();
    });

    it('builds the response and canvas-state envelopes the bootstrap reads', () => {
        expect(canvasHostResponse(3, canvasHostSuccess({ revision: 9 })))
            .toEqual({ __canvasHost: true, type: 'response', id: 3, ok: true, result: { revision: 9 } });
        expect(canvasHostStateMessage({ a: 1 }, { revision: 2, title: 'T' }))
            .toEqual({ __canvasHost: true, type: 'canvas-state', state: { a: 1 }, revision: 2, title: 'T' });
    });

    it('answers an unsupported request as a capability error naming the type', () => {
        expect(unsupportedCanvasHostRequest('teleport')).toEqual({
            ok: false,
            error: { code: 'capability-error', message: 'Unsupported CanvasHost request "teleport"' },
        });
        expect(unsupportedCanvasHostRequest(undefined).error.message).toContain('undefined');
    });

    it('prefers a real Error message and falls back otherwise', () => {
        expect(canvasHostErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
        expect(canvasHostErrorMessage(new Error(''), 'fallback')).toBe('fallback');
        expect(canvasHostErrorMessage('boom', 'fallback')).toBe('fallback');
    });
});

describe('canvas host contract — state serialization', () => {
    it('parses stored content, treating empty as {} and malformed as null', () => {
        expect(parseCanvasState('{"a":1}')).toEqual({ a: 1 });
        expect(parseCanvasState('')).toEqual({});
        expect(parseCanvasState('   ')).toEqual({});
        expect(parseCanvasState('{not json')).toBeNull();
    });

    it('serializes state, mapping null/undefined to an empty object', () => {
        expect(serializeCanvasState({ a: 1 })).toBe('{\n  "a": 1\n}');
        expect(serializeCanvasState(undefined)).toBe('{}');
        expect(serializeCanvasState(null)).toBe('{}');
    });

    it('round-trips through both halves', () => {
        expect(parseCanvasState(serializeCanvasState({ cards: [1, 2] }))).toEqual({ cards: [1, 2] });
    });
});
