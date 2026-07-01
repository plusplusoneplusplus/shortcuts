/**
 * Process subtree helpers.
 *
 * Spawned conversations (via the `send_to_conversation` tool) link to their
 * originating chat through `AIProcess.parentProcessId`. Deleting a chat from
 * history must cascade through the *entire* spawned subtree, not just direct
 * children, so an active grandchild is never left orphaned pointing at a
 * deleted parent.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';

/**
 * Recursively collect every descendant process id of `rootId` by walking the
 * `parentProcessId` links breadth-first. The root itself is NOT included.
 *
 * Guards against cycles (a malformed parent chain that points back at an
 * already-visited node) so traversal always terminates.
 */
export async function collectDescendantProcessIds(
    store: ProcessStore,
    rootId: string,
): Promise<string[]> {
    const descendants: string[] = [];
    const visited = new Set<string>([rootId]);
    let frontier: string[] = [rootId];

    while (frontier.length > 0) {
        const next: string[] = [];
        for (const parentId of frontier) {
            const children = await store.getAllProcesses({ parentProcessId: parentId });
            for (const child of children) {
                if (visited.has(child.id)) continue;
                visited.add(child.id);
                descendants.push(child.id);
                next.push(child.id);
            }
        }
        frontier = next;
    }

    return descendants;
}
