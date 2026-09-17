/**
 * Regression guard: `useSlashCommands` must not read the dashboard config
 * while rendering.
 *
 * The hook is mounted by many surfaces that have nothing to do with slash
 * commands (Resolve Context, markdown editors, follow-up composers). When the
 * flag lookups moved into the hook body, every one of those suites started
 * throwing on mount because their `utils/config` mock only lists the exports
 * that surface actually uses. Reading the flags inside `parseAndExtract`
 * instead keeps mounting free of config access, so new flags stay additive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSlashCommands } from '../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands';
import type { SkillItem } from '../../../../src/server/spa/client/react/features/chat/SlashCommandMenu';

const { isCronEnabled, isCanvasEnabled } = vi.hoisted(() => ({
    isCronEnabled: vi.fn(() => true),
    isCanvasEnabled: vi.fn(() => true),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({ isCronEnabled, isCanvasEnabled }));

const skills: SkillItem[] = [
    { name: 'cron', description: 'Run a prompt on a recurring interval' },
    { name: 'canvas', description: 'Create or update a canvas' },
];

describe('useSlashCommands feature-flag reads', () => {
    beforeEach(() => {
        isCronEnabled.mockClear();
        isCanvasEnabled.mockClear();
    });

    it('does not read the config module on mount', () => {
        renderHook(() => useSlashCommands(skills));

        expect(isCronEnabled).not.toHaveBeenCalled();
        expect(isCanvasEnabled).not.toHaveBeenCalled();
    });

    it('does not read the config module on re-render', () => {
        const { rerender } = renderHook(() => useSlashCommands(skills));
        rerender();

        expect(isCronEnabled).not.toHaveBeenCalled();
        expect(isCanvasEnabled).not.toHaveBeenCalled();
    });

    it('reads the flags when parsing submitted text', () => {
        const { result } = renderHook(() => useSlashCommands(skills));
        const parsed = result.current.parseAndExtract('/canvas build a dashboard');

        expect(isCronEnabled).toHaveBeenCalled();
        expect(isCanvasEnabled).toHaveBeenCalled();
        expect(parsed.skills).toContain('canvas');
    });

    it('prefers caller-supplied flags over the config module', () => {
        // Drop the `canvas` skill too — otherwise `/canvas` still matches as a
        // plain skill token and the meta-command filter is not what is measured.
        const withoutCanvas = skills.filter(skill => skill.name !== 'canvas');
        const { result } = renderHook(() => useSlashCommands(withoutCanvas, { cronEnabled: true, canvasEnabled: false }));
        const parsed = result.current.parseAndExtract('/canvas build a dashboard');

        expect(isCanvasEnabled).not.toHaveBeenCalled();
        expect(parsed.metaCommands).not.toContain('canvas');
        expect(parsed.prompt).toBe('/canvas build a dashboard');
    });
});
