/**
 * @vitest-environment node
 *
 * Static analysis: ChatDetail.effectiveAllowedModes must gate the Ralph pill
 * behind isRalphEnabled() so the pill is hidden when ralph.enabled = false.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SPA_ROOT = resolve(__dirname, '../../../../../src/server/spa/client/react');

describe('ChatDetail ralph feature-flag guard', () => {
    const source = readFileSync(resolve(SPA_ROOT, 'features/chat/ChatDetail.tsx'), 'utf-8');

    it('imports isRalphEnabled from config', () => {
        expect(source).toMatch(/import \{[^}]*\bisRalphEnabled\b[^}]*\} from '\.\.\/\.\.\/utils\/config'/);
    });

    it('gates ralphEligible on isRalphEnabled()', () => {
        // The ralphEligible assignment must include an isRalphEnabled() call
        // so the Ralph pill is suppressed when the feature flag is off.
        const eligibleBlock = source.substring(
            source.indexOf('const ralphEligible'),
            source.indexOf('if (!ralphEligible)'),
        );
        expect(eligibleBlock).toContain('isRalphEnabled()');
    });

    it('matches the gating pattern used in NewChatArea', () => {
        const newChatSource = readFileSync(resolve(SPA_ROOT, 'features/chat/NewChatArea.tsx'), 'utf-8');
        // Both surfaces must reference isRalphEnabled to stay in sync
        expect(newChatSource).toContain('isRalphEnabled');
        expect(source).toContain('isRalphEnabled');
    });
});
