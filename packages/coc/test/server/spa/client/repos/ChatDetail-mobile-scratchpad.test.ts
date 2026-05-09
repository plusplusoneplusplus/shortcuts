/**
 * @vitest-environment node
 *
 * Static analysis tests: verifies that ChatDetail renders the mobile tab bar
 * and correctly gates the follow-up input when isMobileScratchpad is active.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');

describe('ChatDetail mobile scratchpad tab-switch rendering', () => {
    let source: string;

    beforeAll(() => {
        source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');
    });

    it('derives isMobileScratchpad from isMobile, scratchpadEnabled, and isOpen', () => {
        expect(source).toMatch(
            /isMobileScratchpad\s*=\s*isMobile\s*&&\s*scratchpadEnabled\s*&&\s*scratchpad\.isOpen/,
        );
    });

    it('imports MobileScratchpadTabBar', () => {
        expect(source).toMatch(/import.*MobileScratchpadTabBar.*from.*scratchpad\/MobileScratchpadTabBar/);
    });

    it('renders MobileScratchpadTabBar when isMobileScratchpad', () => {
        expect(source).toMatch(/isMobileScratchpad[\s\S]{0,200}MobileScratchpadTabBar/);
    });

    it('passes activeMobileTab and setActiveMobileTab to tab bar', () => {
        expect(source).toMatch(/activeTab=\{scratchpad\.activeMobileTab\}/);
        expect(source).toMatch(/onTabChange=\{scratchpad\.setActiveMobileTab\}/);
    });

    it('hides the chat column when mobile scratchpad tab is active', () => {
        expect(source).toMatch(/isMobileScratchpad.*activeMobileTab.*!==\s*['"]chat['"]/);
    });

    it('hides the scratchpad panel when mobile chat tab is active', () => {
        expect(source).toMatch(/isMobileScratchpad.*activeMobileTab.*!==\s*['"]scratchpad['"]/);
    });

    it('skips ScratchpadDivider on mobile', () => {
        expect(source).toMatch(/!isMobileScratchpad[\s\S]{0,100}ScratchpadDivider/);
    });

    it('guards outer follow-up input with mobile chat tab condition', () => {
        // The outer FollowUpInputArea is hidden when on mobile scratchpad tab
        expect(source).toMatch(
            /!isMobileScratchpad\s*\|\|\s*scratchpad\.activeMobileTab\s*===\s*['"]chat['"]/,
        );
    });
});
