/**
 * @vitest-environment node
 *
 * Static-analysis tests for `hidePlanBanners` (notes-hide-plan-ralph-banners).
 *
 * Verifies that ChatDetail exposes a single defaulted boolean `hidePlanBanners`
 * prop (AC-01), gates all three plan/Ralph banner render sites on
 * `!hidePlanBanners` so they suppress together (AC-02) with no new config key or
 * feature flag (AC-04), that NoteChatPanel passes it `true` at its ChatDetail
 * call site (AC-03), and that the NoteEditor "Run Ralph" toolbar button is left
 * untouched (Out of Scope / no-touch constraint).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');

describe('ChatDetail hidePlanBanners prop (AC-01)', () => {
    let source: string;

    beforeAll(() => {
        source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
    });

    it('declares hidePlanBanners as an optional boolean in ChatDetailProps', () => {
        expect(source).toMatch(/hidePlanBanners\?:\s*boolean/);
    });

    it('defaults hidePlanBanners to false in the destructuring (AC-04: plain defaulted flag)', () => {
        expect(source).toMatch(/hidePlanBanners\s*=\s*false/);
    });

    it('introduces exactly one new boolean prop — no config key or feature flag (AC-04)', () => {
        // The guard is the prop itself, read directly; it must not be routed
        // through a config accessor / ralphEnabled-style toggle.
        expect(source).not.toMatch(/isHidePlanBanners|hidePlanBannersEnabled|getHidePlanBanners/);
        // Every gate reads the raw prop.
        const gateReads = source.match(/!hidePlanBanners/g) ?? [];
        expect(gateReads.length).toBe(2); // the RalphStartPanel IIFE gate + the ImplementPlanCard gate
    });
});

describe('ChatDetail gates all three banner sites on !hidePlanBanners (AC-02)', () => {
    let source: string;

    beforeAll(() => {
        source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
    });

    it('gates the RalphStartPanel launch IIFE (both paths) on !hidePlanBanners', () => {
        expect(source).toMatch(
            /effectiveNav\.kind === 'thread' && !hidePlanBanners && \(\(\) => \{/,
        );
    });

    it('gates the ImplementPlanCard handoff on !hidePlanBanners', () => {
        // Locate the ImplementPlanCard guard by its distinctive terminal-mode conjunction.
        const guard = source.match(
            /effectiveNav\.kind === 'thread' && !hidePlanBanners && isTerminal && !planChatBusy/,
        );
        expect(guard).not.toBeNull();
    });

    it('keeps both RalphStartPanel paths inside the single gated IIFE so they suppress together', () => {
        const iifeStart = source.indexOf("effectiveNav.kind === 'thread' && !hidePlanBanners && (() => {");
        const implCardGate = source.indexOf("effectiveNav.kind === 'thread' && !hidePlanBanners && isTerminal");
        expect(iifeStart).toBeGreaterThan(-1);
        expect(implCardGate).toBeGreaterThan(iifeStart);

        const iifeBody = source.slice(iifeStart, implCardGate);
        const ralphPanels = iifeBody.match(/<RalphStartPanel/g) ?? [];
        expect(ralphPanels.length).toBe(2); // Path 1 (grilling→start) + Path 2 (goal.md direct)
    });
});

describe('NoteChatPanel passes hidePlanBanners to ChatDetail (AC-03)', () => {
    let source: string;

    beforeAll(() => {
        source = readFileSync(resolve(SPA_ROOT, 'features/notes/editor/NoteChatPanel.tsx'), 'utf-8');
    });

    it('passes hidePlanBanners (true via shorthand) on the ChatDetail call', () => {
        const call = source.match(/<ChatDetail[\s\S]*?\/>/);
        expect(call).not.toBeNull();
        // JSX boolean shorthand => true; must not be explicitly disabled.
        expect(call![0]).toMatch(/\bhidePlanBanners\b(?!=\{false\}|=\{"false"\})/);
        expect(call![0]).not.toContain('hidePlanBanners={false}');
    });
});

describe('NoteEditor "Run Ralph" toolbar button is untouched (no-touch constraint)', () => {
    it('keeps the isGoal && canRunSkill && ralphEnabled Run Ralph guard', () => {
        const editor = readFileSync(resolve(SPA_ROOT, 'features/notes/editor/NoteEditor.tsx'), 'utf-8');
        expect(editor).toMatch(/isGoal && canRunSkill && ralphEnabled/);
        // The banner-hiding prop must not have leaked into the document viewer.
        expect(editor).not.toContain('hidePlanBanners');
    });
});
