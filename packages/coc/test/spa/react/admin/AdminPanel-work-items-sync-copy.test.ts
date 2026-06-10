import { describe, expect, it } from 'vitest';
import { getAdminSettingDefinition } from '../../../../src/config/admin-setting-definitions';

describe('Admin Features card — remote work item provider integration copy', () => {
    it('describes workItems.sync.enabled as remote provider integration, not manual GitHub sync', () => {
        const def = getAdminSettingDefinition('workItems.sync.enabled');
        expect(def).toBeDefined();
        expect(def!.ui).toBeDefined();

        expect(def!.ui!.label).toBe('Remote Work Items');
        expect(def!.ui!.hint).toContain('remote provider integration');
        expect(def!.ui!.hint).toContain('save-to-provider updates');
        expect(def!.ui!.hint).toContain('background polling');
        expect(def!.ui!.label).not.toContain('Work Items GitHub Sync');
        expect(def!.ui!.hint).not.toContain('Manual GitHub Issues import/export/sync controls');
    });
});
