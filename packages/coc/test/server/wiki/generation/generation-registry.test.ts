/**
 * Covers per-wiki isolation, the already-running guard, cancellation tokens,
 * and the reset/dispose lifecycle hooks.
 */

import { describe, it, expect } from 'vitest';
import { WikiGenerationRegistry, defaultGenerationRegistry } from '../../../../src/server/wiki/generation';

describe('WikiGenerationRegistry — start/finish', () => {
    it('reports nothing running for an unknown wiki', () => {
        const registry = new WikiGenerationRegistry();
        expect(registry.get('w1')).toBeNull();
        expect(registry.isRunning('w1')).toBe(false);
    });

    it('claims a wiki and records the starting phase', () => {
        const registry = new WikiGenerationRegistry();
        const handle = registry.start('w1', 3, 1000);

        expect(handle).not.toBeNull();
        expect(registry.isRunning('w1')).toBe(true);
        expect(registry.get('w1')).toMatchObject({
            running: true,
            currentPhase: 3,
            cancelled: false,
            startTime: 1000,
        });
    });

    it('refuses a second concurrent start for the same wiki', () => {
        const registry = new WikiGenerationRegistry();
        expect(registry.start('w1', 1)).not.toBeNull();
        expect(registry.start('w1', 1)).toBeNull();
    });

    it('allows a new start after the previous run finishes', () => {
        const registry = new WikiGenerationRegistry();
        const first = registry.start('w1', 1)!;
        first.finish();

        expect(registry.isRunning('w1')).toBe(false);
        expect(registry.get('w1')).toBeNull();
        expect(registry.start('w1', 1)).not.toBeNull();
    });

    it('keeps state per wiki', () => {
        const registry = new WikiGenerationRegistry();
        registry.start('w1', 2);

        expect(registry.isRunning('w1')).toBe(true);
        expect(registry.isRunning('w2')).toBe(false);
        expect(registry.start('w2', 1)).not.toBeNull();
    });

    it('does not let a stale handle clear a newer run', () => {
        const registry = new WikiGenerationRegistry();
        const stale = registry.start('w1', 1)!;
        stale.finish();
        registry.start('w1', 1);

        stale.finish();

        expect(registry.isRunning('w1')).toBe(true);
    });

    it('finish is idempotent', () => {
        const registry = new WikiGenerationRegistry();
        const handle = registry.start('w1', 1)!;
        handle.finish();
        expect(() => handle.finish()).not.toThrow();
    });

    it('setPhase updates the state the status endpoint reads', () => {
        const registry = new WikiGenerationRegistry();
        const handle = registry.start('w1', 1)!;

        handle.setPhase(4);

        expect(registry.get('w1')?.currentPhase).toBe(4);
    });
});

describe('WikiGenerationRegistry — cancellation', () => {
    it('cancel flips the handle token', () => {
        const registry = new WikiGenerationRegistry();
        const handle = registry.start('w1', 1)!;

        expect(handle.isCancelled()).toBe(false);
        expect(registry.cancel('w1')).toBe(true);
        expect(handle.isCancelled()).toBe(true);
    });

    it('cancel returns false when nothing is running', () => {
        const registry = new WikiGenerationRegistry();
        expect(registry.cancel('w1')).toBe(false);
    });

    it('cancel returns false after the run finished', () => {
        const registry = new WikiGenerationRegistry();
        const handle = registry.start('w1', 1)!;
        handle.finish();
        expect(registry.cancel('w1')).toBe(false);
    });

    it('cancelling one wiki does not cancel another', () => {
        const registry = new WikiGenerationRegistry();
        const first = registry.start('w1', 1)!;
        const second = registry.start('w2', 1)!;

        registry.cancel('w1');

        expect(first.isCancelled()).toBe(true);
        expect(second.isCancelled()).toBe(false);
    });
});

describe('WikiGenerationRegistry — reset and dispose', () => {
    it('reset clears one wiki only', () => {
        const registry = new WikiGenerationRegistry();
        registry.start('w1', 1);
        registry.start('w2', 1);

        registry.reset('w1');

        expect(registry.get('w1')).toBeNull();
        expect(registry.get('w2')).not.toBeNull();
    });

    it('resetAll clears everything', () => {
        const registry = new WikiGenerationRegistry();
        registry.start('w1', 1);
        registry.start('w2', 1);

        registry.resetAll();

        expect(registry.get('w1')).toBeNull();
        expect(registry.get('w2')).toBeNull();
    });

    it('dispose cancels in-flight runs before clearing', () => {
        const registry = new WikiGenerationRegistry();
        const handle = registry.start('w1', 1)!;

        registry.dispose();

        expect(handle.isCancelled()).toBe(true);
        expect(registry.get('w1')).toBeNull();
    });

    it('two registries never share state', () => {
        const a = new WikiGenerationRegistry();
        const b = new WikiGenerationRegistry();

        a.start('w1', 1);

        expect(a.isRunning('w1')).toBe(true);
        expect(b.isRunning('w1')).toBe(false);
    });

    it('exposes a shared default registry instance', () => {
        expect(defaultGenerationRegistry).toBeInstanceOf(WikiGenerationRegistry);
    });
});
