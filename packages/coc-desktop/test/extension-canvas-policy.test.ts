import { describe, expect, it } from 'vitest';
import { classifyExtensionCanvasNavigation, extensionCanvasUrl } from '../src/extension-canvas-policy';

describe('extension canvas URL policy', () => {
    it('accepts only credential-free HTTP IPv4 loopback instance URLs', () => {
        expect(extensionCanvasUrl('http://127.0.0.1:8123')).toBe('http://127.0.0.1:8123/');
        for (const value of [
            null, {}, '', 'not a url', 'http://localhost:8123/', 'http://[::1]:8123/',
            'https://127.0.0.1:8123/', 'http://127.0.0.1.example.test/',
            'http://127.0.0.2:8123/', 'http://user:password@127.0.0.1:8123/',
            'file:///index.html', 'http://127.0.0.1:8123/\nfoo',
        ]) expect(extensionCanvasUrl(value)).toBeUndefined();
    });

    it('compares exact origins including port and scheme, not paths or hashes', () => {
        const initial = 'http://127.0.0.1:8123/index';
        expect(classifyExtensionCanvasNavigation('http://127.0.0.1:8123/other?q=1#hash', initial)).toBe('allow');
        for (const value of ['http://127.0.0.1:9123/', 'https://127.0.0.1:8123/', 'https://example.test/']) {
            expect(classifyExtensionCanvasNavigation(value, initial)).toBe('external');
        }
        for (const value of ['about:blank', 'javascript:alert(1)', 'data:text/html,test', 'file:///index.html', '/relative', 'https://user@example.test/']) {
            expect(classifyExtensionCanvasNavigation(value, initial)).toBe('deny');
        }
        expect(classifyExtensionCanvasNavigation(initial, 'https://example.test/')).toBe('deny');
    });
});
