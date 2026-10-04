import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeDatabase as Database } from '@plusplusoneplusplus/coc-native';
import { CronStore } from '../../../src/server/cron/cron-store';
import type { CronEntry } from '../../../src/server/cron/cron-types';
import {
    cancelLegacySentinelScanCrons,
    LEGACY_SENTINEL_SCAN_CRON_DESCRIPTION,
} from '../../../src/server/cron/legacy-sentinel-crons';

function makeCron(overrides: Partial<CronEntry>): CronEntry {
    return {
        id: 'cron_x',
        processId: 'queue_proc',
        description: 'General cron',
        intervalMs: 60_000,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastTickAt: null,
        nextTickAt: new Date(Date.now() + 60_000).toISOString(),
        tickCount: 0,
        consecutiveFailures: 0,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        pausedReason: null,
        prompt: 'tick',
        model: null,
        workspaceId: 'ws-a',
        ...overrides,
    };
}

describe('cancelLegacySentinelScanCrons', () => {
    let db: Database;
    let store: CronStore;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new CronStore(db);
    });

    afterEach(() => {
        db.close();
    });

    it('cancels active and paused Sentinel scan crons and leaves other crons alone', () => {
        store.insert(makeCron({ id: 'cron_scan_active', description: LEGACY_SENTINEL_SCAN_CRON_DESCRIPTION }));
        store.insert(makeCron({ id: 'cron_scan_paused', description: LEGACY_SENTINEL_SCAN_CRON_DESCRIPTION, status: 'paused' }));
        store.insert(makeCron({ id: 'cron_general' }));

        expect(cancelLegacySentinelScanCrons(store)).toBe(2);

        expect(store.getById('cron_scan_active')).toMatchObject({ status: 'cancelled', nextTickAt: null });
        expect(store.getById('cron_scan_paused')?.status).toBe('cancelled');
        expect(store.getById('cron_general')?.status).toBe('active');
        expect(store.getActive().map(cron => cron.id)).toEqual(['cron_general']);
    });

    it('is a no-op once the scan crons are already terminal', () => {
        store.insert(makeCron({ id: 'cron_scan_cancelled', description: LEGACY_SENTINEL_SCAN_CRON_DESCRIPTION, status: 'cancelled' }));
        store.insert(makeCron({ id: 'cron_scan_expired', description: LEGACY_SENTINEL_SCAN_CRON_DESCRIPTION, status: 'expired' }));

        expect(cancelLegacySentinelScanCrons(store)).toBe(0);
        expect(store.getById('cron_scan_expired')?.status).toBe('expired');
    });
});
