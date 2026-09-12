import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SettingsSectionIcon } from '../../../src/server/spa/client/react/features/repo-settings/SettingsShell';
import type { SettingsSection } from '../../../src/server/spa/client/react/types/dashboard';

// Sections that appear in the repo settings sidebar. Each one must render an
// icon so the nav list stays visually consistent.
const NAV_SECTIONS: SettingsSection[] = [
    'info',
    'preferences',
    'tasks',
    'notes',
    'language-servers',
    'members',
    'mcp',
    'skills',
    'llm-tools',
    'instructions',
    'memory',
];

describe('SettingsSectionIcon', () => {
    for (const id of NAV_SECTIONS) {
        it(`renders an icon for "${id}"`, () => {
            const { container } = render(<SettingsSectionIcon id={id} />);
            expect(container.querySelector('svg')).not.toBeNull();
        });
    }
});
