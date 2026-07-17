// Display formatting shared by canvas node cards and sub-agent detail metadata.

/**
 * Compact human duration for run timers:
 *   under an hour → `m:ss`   (e.g. `0:09`, `5:09`)
 *   an hour+      → `Hh Mm`  (e.g. `1h 5m`)
 *   a day+        → `Dd Hh`  (e.g. `5d 2h`)
 *
 * Keeps a long-running or stuck background agent from rendering an unbounded
 * minute count (e.g. `7353:17`) that overflows the node card.
 */
export function formatRunDuration(ms: number): string {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const totalMin = Math.floor(totalSec / 60);
    const totalHr = Math.floor(totalMin / 60);
    if (totalHr >= 24) {
        return `${Math.floor(totalHr / 24)}d ${totalHr % 24}h`;
    }
    if (totalHr >= 1) {
        return `${totalHr}h ${totalMin % 60}m`;
    }
    return `${totalMin}:${String(totalSec % 60).padStart(2, '0')}`;
}
