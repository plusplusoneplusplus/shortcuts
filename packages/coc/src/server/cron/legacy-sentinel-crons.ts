import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { CronStore } from './cron-store';

/** Description the retired Sentinel scanner gave its hourly cron. */
export const LEGACY_SENTINEL_SCAN_CRON_DESCRIPTION = 'Sentinel workspace scan';

/**
 * Cancels every live cron the retired Sentinel scanner provisioned so it can
 * never tick again. Runs at startup, before timers are re-armed.
 */
export function cancelLegacySentinelScanCrons(store: Pick<CronStore, 'getAll' | 'update'>): number {
    const crons = store.getAll().filter(cron =>
        cron.description === LEGACY_SENTINEL_SCAN_CRON_DESCRIPTION
        && cron.status !== 'cancelled'
        && cron.status !== 'expired');
    for (const cron of crons) {
        cron.status = 'cancelled';
        cron.nextTickAt = null;
        store.update(cron);
    }
    if (crons.length > 0) {
        getLogger().info(
            LogCategory.AI,
            `[CronInfra] Cancelled ${crons.length} retired Sentinel scan cron(s)`,
        );
    }
    return crons.length;
}
