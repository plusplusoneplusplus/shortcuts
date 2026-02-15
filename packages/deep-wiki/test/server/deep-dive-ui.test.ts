/**
 * Tests for Deep Dive UI and WebSocket Live Reload in the SPA template.
 */

import { describe, it, expect } from 'vitest';
import { generateSpaHtml } from '../../src/server/spa-template';
import type { SpaTemplateOptions } from '../../src/server/spa-template';

// ============================================================================
// Helpers
// ============================================================================

function createOptions(overrides?: Partial<SpaTemplateOptions>): SpaTemplateOptions {
    return {
        theme: 'auto',
        title: 'Test Wiki',
        enableSearch: true,
        enableAI: true,
        enableGraph: false,
        enableWatch: false,
        ...overrides,
    };
}

// ============================================================================
// Deep Dive Button Tests
// ============================================================================

describe('Deep Dive UI', () => {
    describe('when AI is enabled', () => {
        const opts = createOptions({ enableAI: true });

        it('should include addDeepDiveButton function', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('function addDeepDiveButton');
        });

        it('should include toggleDeepDiveSection function', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('function toggleDeepDiveSection');
        });

        it('should include startDeepDive function', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('function startDeepDive');
        });

        it('should include finishDeepDive function', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('function finishDeepDive');
        });

        it('should call addDeepDiveButton in loadModule', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('addDeepDiveButton(moduleId)');
        });

        it('should include deep-dive streaming flag', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('var deepDiveStreaming = false');
        });

        it('should include Explore Further button text', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('Explore Further');
        });

        it('should fetch /api/explore/ endpoint', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('fetch("/api/explore/"');
        });

        it('should send depth: deep in request body', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('body.depth = "deep"');
        });

        it('should include question input field', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('deep-dive-input');
            expect(html).toContain('Ask a specific question');
        });

        it('should include submit button', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('deep-dive-submit');
        });

        it('should include result container', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('deep-dive-result');
        });

        it('should process SSE events for deep dive', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('data.type === "status"');
            expect(html).toContain('data.type === "chunk"');
            expect(html).toContain('data.type === "done"');
            expect(html).toContain('data.type === "error"');
        });

        it('should render markdown in deep dive response', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('marked.parse(fullResponse)');
        });

        it('should highlight code in deep dive result', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('hljs.highlightElement(block)');
        });

        it('should disable submit button during streaming', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('submitBtn.disabled = true');
        });

        it('should re-enable submit button after streaming', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('submitBtn.disabled = false');
        });

        it('should handle Enter key on deep-dive input', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('e.key === "Enter"');
        });
    });

    describe('CSS styles', () => {
        it('should include deep-dive button styles', () => {
            const html = generateSpaHtml(createOptions({ enableAI: true }));
            expect(html).toContain('.deep-dive-btn');
        });

        it('should include deep-dive section styles', () => {
            const html = generateSpaHtml(createOptions({ enableAI: true }));
            expect(html).toContain('.deep-dive-section');
        });

        it('should include deep-dive input styles', () => {
            const html = generateSpaHtml(createOptions({ enableAI: true }));
            expect(html).toContain('.deep-dive-input');
            expect(html).toContain('.deep-dive-submit');
        });

        it('should include deep-dive result styles', () => {
            const html = generateSpaHtml(createOptions({ enableAI: true }));
            expect(html).toContain('.deep-dive-result');
            expect(html).toContain('.deep-dive-status');
        });

        it('should always include deep-dive JS in bundle even when AI is disabled', () => {
            const html = generateSpaHtml(createOptions({ enableAI: false }));
            expect(html).toContain('function addDeepDiveButton');
            expect(html).toContain('function startDeepDive');
            expect(html).toContain('enableAI: false');
        });
    });

    describe('when AI is disabled', () => {
        const opts = createOptions({ enableAI: false });

        it('should always include deep dive functions in bundle, controlled by config', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('function addDeepDiveButton');
            expect(html).toContain('function startDeepDive');
            expect(html).toContain('enableAI: false');
        });

        it('should always include deep dive button call in bundle, controlled by config', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('addDeepDiveButton(moduleId)');
            expect(html).toContain('enableAI: false');
        });
    });
});

// ============================================================================
// WebSocket Live Reload Tests
// ============================================================================

describe('WebSocket Live Reload UI', () => {
    describe('when watch mode is enabled', () => {
        const opts = createOptions({ enableWatch: true });

        it('should include live-reload-bar HTML element', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('id="live-reload-bar"');
        });

        it('should include connectWebSocket function', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('function connectWebSocket()');
        });

        it('should include handleWsMessage function', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('function handleWsMessage(msg)');
        });

        it('should construct WebSocket URL from location', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('location.host + "/ws"');
        });

        it('should call connectWebSocket on load', () => {
            const html = generateSpaHtml(opts);
            // Should call it at script startup
            expect(html).toContain('connectWebSocket();');
        });

        it('should send periodic pings', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('{ type: "ping" }');
            expect(html).toContain('setInterval');
        });

        it('should handle reconnection with backoff', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('wsReconnectDelay');
            expect(html).toContain('wsReconnectTimer');
        });

        it('should handle rebuilding messages', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('msg.type === "rebuilding"');
            expect(html).toContain('Rebuilding:');
        });

        it('should handle reload messages', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('msg.type === "reload"');
            expect(html).toContain('Updated:');
        });

        it('should handle error messages', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('msg.type === "error"');
        });

        it('should invalidate markdown cache on reload', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('delete markdownCache[id]');
        });

        it('should reload current module if affected', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('currentModuleId');
            expect(html).toContain('loadModule(currentModuleId, true)');
        });

        it('should auto-hide notification bar after 3 seconds', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('3e3');
        });
    });

    describe('CSS styles', () => {
        it('should include live-reload-bar styles', () => {
            const html = generateSpaHtml(createOptions({ enableWatch: true }));
            expect(html).toContain('.live-reload-bar');
            expect(html).toContain('.live-reload-bar.visible');
            expect(html).toContain('.live-reload-bar.rebuilding');
            expect(html).toContain('.live-reload-bar.reloaded');
            expect(html).toContain('.live-reload-bar.error');
        });

        it('should include live-reload-bar styles even without watch', () => {
            // Styles are always included in base CSS
            const html = generateSpaHtml(createOptions({ enableWatch: false }));
            expect(html).toContain('.live-reload-bar');
        });
    });

    describe('when watch mode is disabled', () => {
        const opts = createOptions({ enableWatch: false });

        it('should not include live-reload-bar HTML', () => {
            const html = generateSpaHtml(opts);
            expect(html).not.toContain('id="live-reload-bar"');
        });

        it('should always include WebSocket code in bundle, controlled by config', () => {
            const html = generateSpaHtml(opts);
            expect(html).toContain('function connectWebSocket');
            expect(html).toContain('function handleWsMessage');
            expect(html).toContain('enableWatch: false');
        });
    });
});
