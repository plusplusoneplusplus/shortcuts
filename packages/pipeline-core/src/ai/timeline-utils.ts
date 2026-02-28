import type { TimelineItem } from './process-types';

/**
 * Merge consecutive 'content' timeline items into single items.
 * Tool events act as boundaries and are preserved as-is.
 * Returns a new array (no mutation).
 */
export function mergeConsecutiveContentItems(timeline: TimelineItem[]): TimelineItem[] {
    if (timeline.length === 0) return [];

    const result: TimelineItem[] = [];
    let accContent = '';
    let accTimestamp: Date | null = null;

    function flushContent(): void {
        if (accTimestamp !== null) {
            result.push({ type: 'content', timestamp: accTimestamp, content: accContent });
            accContent = '';
            accTimestamp = null;
        }
    }

    for (const item of timeline) {
        if (item.type === 'content') {
            if (accTimestamp === null) {
                accTimestamp = item.timestamp;
            }
            accContent += item.content ?? '';
        } else {
            flushContent();
            result.push(item);
        }
    }

    flushContent();
    return result;
}
