import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebSocket } from '../../../src/server/spa/client/react/hooks/useWebSocket';
import { resetSpaCocClientForTests } from '../../../src/server/spa/client/react/api/cocClient';

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readyState = MockWebSocket.CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor(readonly url: string) {
        MockWebSocket.instances.push(this);
    }

    send = vi.fn();

    close(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({} as CloseEvent);
    }

    open(): void {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.({} as Event);
    }

    message(data: unknown): void {
        this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
    }
}

describe('useWebSocket', () => {
    beforeEach(() => {
        resetSpaCocClientForTests();
        MockWebSocket.instances = [];
        vi.stubGlobal('WebSocket', MockWebSocket);
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/custom-ws' };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete (window as any).__DASHBOARD_CONFIG__;
        resetSpaCocClientForTests();
    });

    it('preserves hook status and callback behavior while delegating socket lifecycle', () => {
        const onMessage = vi.fn();
        const onConnect = vi.fn();
        const { result } = renderHook(() => useWebSocket({ onMessage, onConnect }));

        act(() => result.current.connect());
        expect(MockWebSocket.instances[0].url).toBe(`ws://${window.location.host}/custom-ws`);
        expect(result.current.status).toBe('connecting');

        act(() => MockWebSocket.instances[0].open());
        expect(result.current.status).toBe('open');
        expect(onConnect).toHaveBeenCalled();

        act(() => MockWebSocket.instances[0].message({ type: 'queue-changed' }));
        expect(onMessage).toHaveBeenCalledWith({ type: 'queue-changed' });

        act(() => result.current.disconnect());
        expect(result.current.status).toBe('closed');
    });
});
