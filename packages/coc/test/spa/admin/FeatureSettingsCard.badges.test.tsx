/**
 * Tests for the Experimental-pill rule in the admin Workspace Features card.
 *
 * A feature that ships enabled is no longer experimental in practice, so its
 * "Experimental" pill is suppressed. Restart/Preview badges are unaffected.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    FeatureSettingsCard,
    resolveFeatureBadge,
} from '../../../src/server/spa/client/react/admin/FeatureSettingsCard';
import {
    ADMIN_SETTING_DEFINITIONS,
    FEATURE_CARD_GROUPS,
    getFeatureCardSettings,
    type AdminSettingDefinition,
} from '../../../src/config/admin-setting-definitions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function def(key: string): AdminSettingDefinition {
    const found = ADMIN_SETTING_DEFINITIONS.find(d => d.key === key);
    if (!found) throw new Error(`no admin setting definition for '${key}'`);
    return found;
}

/** All feature-card definitions, in render order. */
function featureCardDefs(): AdminSettingDefinition[] {
    return FEATURE_CARD_GROUPS.flatMap(group => getFeatureCardSettings(group.id));
}

function renderCard(search = '') {
    // Every dependsOn parent on, so dependent rows are not filtered out.
    const featureValues: Record<string, unknown> = {};
    for (const d of featureCardDefs()) featureValues[d.key] = d.default;
    for (const d of featureCardDefs()) {
        if (d.ui?.dependsOn) featureValues[d.ui.dependsOn] = true;
    }
    return render(
        <FeatureSettingsCard
            featureValues={featureValues as never}
            setFeatureValues={vi.fn()}
            featureSearch={search}
            setFeatureSearch={vi.fn()}
            dirty={false}
            saving={false}
            onSave={vi.fn()}
            onCancel={vi.fn()}
            sources={{}}
            isDefaultValue={() => true}
        />,
    );
}

/** Badge labels rendered in the same row as `testId`'s control. */
function badgeLabelsForRow(testId: string): string[] {
    const control = screen.getByTestId(testId);
    const row = control.closest('.ar-row') ?? control.parentElement?.parentElement;
    if (!row) throw new Error(`no row found for '${testId}'`);
    return Array.from(row.querySelectorAll('.ar-badge')).map(el => el.textContent?.trim() ?? '');
}

// ── resolveFeatureBadge ───────────────────────────────────────────────────────

describe('resolveFeatureBadge', () => {
    it('suppresses the Experimental pill for a default-enabled feature', () => {
        // Ships on (`default: true`) and is tagged experimental in the registry.
        const chatStyleSelector = def('features.chatStyleSelector');
        expect(chatStyleSelector.default).toBe(true);
        expect(chatStyleSelector.ui?.badge).toBe('experimental');
        expect(resolveFeatureBadge(chatStyleSelector)).toBeUndefined();
    });

    it('keeps the Experimental pill for a default-disabled feature', () => {
        const ralph = def('ralph.enabled');
        expect(ralph.default).toBe(false);
        expect(resolveFeatureBadge(ralph)).toEqual({
            className: 'ar-badge ar-badge-accent',
            label: 'Experimental',
        });
    });

    it('leaves non-experimental badges alone regardless of default', () => {
        expect(resolveFeatureBadge({
            ...def('ralph.enabled'),
            default: true,
            ui: { ...def('ralph.enabled').ui!, badge: 'restart' },
        })).toEqual({ className: 'ar-badge ar-badge-warning', label: 'Restart' });

        expect(resolveFeatureBadge({
            ...def('ralph.enabled'),
            default: true,
            ui: { ...def('ralph.enabled').ui!, badge: 'preview' },
        })).toEqual({ className: 'ar-badge ar-badge-accent', label: 'Preview' });
    });

    it('returns undefined when the setting has no badge or no ui spec', () => {
        const noBadge = def('features.focusedDiff');
        expect(noBadge.ui?.badge).toBeUndefined();
        expect(resolveFeatureBadge(noBadge)).toBeUndefined();
        expect(resolveFeatureBadge({ ...noBadge, ui: undefined })).toBeUndefined();
    });

    it('covers every registry feature: experimental + default-on always resolves to no badge', () => {
        const defaultOnExperimental = featureCardDefs()
            .filter(d => d.ui?.badge === 'experimental' && d.default === true);
        // Guards against the rule silently applying to nothing.
        expect(defaultOnExperimental.length).toBeGreaterThan(0);
        for (const d of defaultOnExperimental) {
            expect(resolveFeatureBadge(d), `${d.key} should have no badge`).toBeUndefined();
        }
    });
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('FeatureSettingsCard badges', () => {
    it('renders no Experimental pill on any default-enabled experimental row', () => {
        renderCard();
        const defaultOnExperimental = featureCardDefs()
            .filter(d => d.ui?.badge === 'experimental' && d.default === true);
        expect(defaultOnExperimental.length).toBeGreaterThan(0);
        for (const d of defaultOnExperimental) {
            expect(badgeLabelsForRow(d.ui!.testId), d.key).not.toContain('Experimental');
        }
    });

    it('still renders the Experimental pill on default-disabled experimental rows', () => {
        renderCard();
        const defaultOffExperimental = featureCardDefs()
            .filter(d => d.ui?.badge === 'experimental' && d.default !== true);
        expect(defaultOffExperimental.length).toBeGreaterThan(0);
        for (const d of defaultOffExperimental) {
            expect(badgeLabelsForRow(d.ui!.testId), d.key).toContain('Experimental');
        }
    });

    it('still renders Restart pills, including on default-enabled rows', () => {
        renderCard();
        const restartDefs = featureCardDefs().filter(d => d.ui?.badge === 'restart');
        expect(restartDefs.length).toBeGreaterThan(0);
        for (const d of restartDefs) {
            expect(badgeLabelsForRow(d.ui!.testId), d.key).toContain('Restart');
        }
    });
});
