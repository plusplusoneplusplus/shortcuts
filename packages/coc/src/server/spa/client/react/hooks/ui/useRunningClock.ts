import { useEffect, useState } from 'react';

/**
 * A coarse clock that only ticks while `active` is true.
 *
 * Returns epoch ms, updated once per `intervalMs` for as long as the caller is
 * in a running state, and frozen at the last value once it settles. Rows that
 * are not running never schedule a timer, which keeps a long conversation with
 * hundreds of finished tool calls timer-free.
 */
export function useRunningClock(active: boolean, intervalMs = 1000): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!active) { return; }
        setNow(Date.now());
        const id = window.setInterval(() => setNow(Date.now()), intervalMs);
        return () => window.clearInterval(id);
    }, [active, intervalMs]);

    return now;
}
