/**
 * Chat-List Group Seed Utilities for E2E Tests
 *
 * Extends the base `seed.ts` helpers with the four grouped-row kinds the chat
 * list renders — Ralph sessions, For Each runs, Map Reduce runs, and spawned
 * sub-conversation trees — plus plain interleaved chats. These fixtures back the
 * range-selection e2e suite (chat-list-range-selection.spec.ts).
 *
 * Grouping keys (see the SPA grouping modules under
 * src/server/spa/client/react/features/chat/):
 *   - Ralph:      process `metadata.ralph.{sessionId,phase,currentIteration}`.
 *   - For Each:   a persisted run (POST .../for-each-runs) whose child chats
 *                 carry `metadata.forEach.runId`. Without the run seed the
 *                 tagged chats stay standalone (groupBySeededTaskGroups short-
 *                 circuits when there are no seeds).
 *   - Map Reduce: a persisted run (POST .../map-reduce-runs) + child chats with
 *                 `metadata.mapReduce.runId`.
 *   - Spawned:    plain chats linked by `parentProcessId` (same path as
 *                 nested-spawn-tree.spec.ts).
 *
 * All the group-toggle feature flags (ralph/forEach/mapReduce) default off and
 * the shared E2E server config keeps them off, so callers must first
 * `enableGroupFeatures()` (a live PUT /api/admin/config) before loading the SPA.
 * The spawned-tree view is default-on and needs no flag.
 */

import { request, seedProcess } from './seed';

/** Deterministic ISO timestamp `offsetMinutes` after a fixed base instant. */
const BASE_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
export function seededIso(offsetMinutes: number): string {
    return new Date(BASE_MS + offsetMinutes * 60_000).toISOString();
}

/**
 * Enable the ralph / for-each / map-reduce group toggles via the live admin
 * config API. These are `runtime: 'live'` flags, so the change is picked up by
 * the SPA's next GET /api/config/runtime — call this BEFORE `page.goto`.
 */
export async function enableGroupFeatures(baseURL: string): Promise<void> {
    const res = await request(`${baseURL}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({
            'ralph.enabled': true,
            'forEach.enabled': true,
            'mapReduce.enabled': true,
        }),
    });
    if (res.status !== 200) {
        throw new Error(`Failed to enable group features: ${res.status} ${res.body}`);
    }
}

/** Seed one plain completed chat scoped to a workspace. Returns its id. */
export async function seedPlainChat(
    baseURL: string,
    wsId: string,
    id: string,
    offsetMinutes: number,
    promptPreview?: string,
): Promise<string> {
    return seedPlainChatAt(baseURL, wsId, id, seededIso(offsetMinutes), promptPreview);
}

/**
 * Seed a plain completed chat at an explicit ISO timestamp. Use this to place a
 * plain chat relative to a For Each / Map Reduce group: those groups are backed
 * by a persisted run whose record is created at wall-clock "now", so the group's
 * sort timestamp is `max(run.createdAt≈now, seededChildTs)` ≈ now regardless of
 * the seeded child offsets — a fixed-past-base plain chat can never sort between
 * them. Seeding a plain chat at `Date.now() ± minutes` brackets the run groups
 * deterministically. Returns the chat id.
 */
export async function seedPlainChatAt(
    baseURL: string,
    wsId: string,
    id: string,
    iso: string,
    promptPreview?: string,
): Promise<string> {
    await seedProcess(baseURL, id, {
        type: 'chat',
        status: 'completed',
        workspaceId: wsId,
        promptPreview: promptPreview ?? `Plain chat ${id}`,
        startTime: iso,
        endTime: iso,
        metadata: { type: 'chat', workspaceId: wsId, mode: 'ask' },
    });
    return id;
}

/** ISO timestamp `offsetMinutes` from real wall-clock now (for bracketing run-backed groups). */
export function nowRelativeIso(offsetMinutes: number): string {
    return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

/**
 * Seed a Ralph session: one grilling process + `iterations` executing
 * iterations, all sharing `sessionId`. Returns the ordered process ids
 * (grill first, then iterations) — this is the range-selection unit.
 */
export async function seedRalphSession(
    baseURL: string,
    wsId: string,
    sessionId: string,
    opts: { iterations?: number; goal?: string; baseOffsetMinutes?: number } = {},
): Promise<{ sessionId: string; grillId: string; iterationIds: string[]; allIds: string[] }> {
    const iterations = opts.iterations ?? 2;
    const goal = opts.goal ?? `Ralph goal for ${sessionId}`;
    const base = opts.baseOffsetMinutes ?? 0;

    const grillId = `${sessionId}-grill`;
    const grillTs = seededIso(base);
    await seedProcess(baseURL, grillId, {
        type: 'chat',
        status: 'completed',
        workspaceId: wsId,
        promptPreview: `Grill: ${goal}`,
        startTime: grillTs,
        endTime: grillTs,
        metadata: {
            type: 'chat',
            workspaceId: wsId,
            mode: 'ask',
            ralph: { sessionId, phase: 'grilling', currentIteration: 0, originalGoal: goal },
        },
    });

    const iterationIds: string[] = [];
    for (let i = 1; i <= iterations; i++) {
        const iterId = `${sessionId}-iter-${i}`;
        const iterTs = seededIso(base + i);
        await seedProcess(baseURL, iterId, {
            type: 'chat',
            status: 'completed',
            workspaceId: wsId,
            promptPreview: `Iteration ${i}`,
            startTime: iterTs,
            endTime: iterTs,
            metadata: {
                type: 'chat',
                workspaceId: wsId,
                mode: 'autopilot',
                ralph: { sessionId, phase: 'executing', currentIteration: i, originalGoal: goal },
            },
        });
        iterationIds.push(iterId);
    }

    return { sessionId, grillId, iterationIds, allIds: [grillId, ...iterationIds] };
}

/** Create a persisted For Each run (draft) and return its server-assigned runId. */
async function createForEachRun(
    baseURL: string,
    wsId: string,
    originalRequest: string,
    itemCount: number,
): Promise<string> {
    const items = Array.from({ length: itemCount }, (_, i) => ({
        id: `fe-item-${i + 1}`,
        title: `For Each item ${i + 1}`,
        prompt: `Do work ${i + 1}`,
        status: 'pending',
    }));
    const res = await request(`${baseURL}/api/workspaces/${encodeURIComponent(wsId)}/for-each-runs`, {
        method: 'POST',
        body: JSON.stringify({ originalRequest, childMode: 'ask', items }),
    });
    if (res.status !== 201) {
        throw new Error(`Failed to create for-each run: ${res.status} ${res.body}`);
    }
    const json = JSON.parse(res.body);
    const runId = json.run?.runId;
    if (!runId) {
        throw new Error(`for-each run response missing runId: ${res.body}`);
    }
    return runId;
}

/**
 * Seed a For Each run group: the persisted run + a generation chat + `children`
 * child chats tagged with the run. Returns the runId and ordered child ids
 * (generation first, then children) — the range-selection unit.
 */
export async function seedForEachRun(
    baseURL: string,
    wsId: string,
    opts: { children?: number; baseOffsetMinutes?: number; request?: string } = {},
): Promise<{ runId: string; generationId: string; childIds: string[]; allIds: string[] }> {
    const childCount = opts.children ?? 2;
    const base = opts.baseOffsetMinutes ?? 0;
    const originalRequest = opts.request ?? 'For Each run request';
    const runId = await createForEachRun(baseURL, wsId, originalRequest, childCount);

    const generationId = `fe-gen-${runId}`;
    const genTs = seededIso(base);
    await seedProcess(baseURL, generationId, {
        type: 'chat',
        status: 'completed',
        workspaceId: wsId,
        promptPreview: `For Each generation: ${originalRequest}`,
        startTime: genTs,
        endTime: genTs,
        metadata: {
            type: 'chat',
            workspaceId: wsId,
            mode: 'ask',
            forEach: { kind: 'generation', runId, workspaceId: wsId },
        },
    });

    const childIds: string[] = [];
    for (let i = 1; i <= childCount; i++) {
        const childId = `fe-child-${runId}-${i}`;
        const childTs = seededIso(base + i);
        await seedProcess(baseURL, childId, {
            type: 'chat',
            status: 'completed',
            workspaceId: wsId,
            promptPreview: `For Each child ${i}`,
            startTime: childTs,
            endTime: childTs,
            metadata: {
                type: 'chat',
                workspaceId: wsId,
                mode: 'ask',
                forEach: { kind: 'child', runId, workspaceId: wsId, itemId: `fe-item-${i}` },
            },
        });
        childIds.push(childId);
    }

    return { runId, generationId, childIds, allIds: [generationId, ...childIds] };
}

/** Create a persisted Map Reduce run (draft) and return its server-assigned runId. */
async function createMapReduceRun(
    baseURL: string,
    wsId: string,
    originalRequest: string,
    itemCount: number,
): Promise<string> {
    const items = Array.from({ length: itemCount }, (_, i) => ({
        id: `mr-item-${i + 1}`,
        title: `Map Reduce item ${i + 1}`,
        prompt: `Map work ${i + 1}`,
        status: 'pending',
    }));
    const res = await request(`${baseURL}/api/workspaces/${encodeURIComponent(wsId)}/map-reduce-runs`, {
        method: 'POST',
        body: JSON.stringify({
            originalRequest,
            reduceInstructions: 'Combine all mapped results',
            childMode: 'ask',
            maxParallel: 2,
            items,
        }),
    });
    if (res.status !== 201) {
        throw new Error(`Failed to create map-reduce run: ${res.status} ${res.body}`);
    }
    const json = JSON.parse(res.body);
    const runId = json.run?.runId;
    if (!runId) {
        throw new Error(`map-reduce run response missing runId: ${res.body}`);
    }
    return runId;
}

/**
 * Seed a Map Reduce run group: the persisted run + a generation chat + `children`
 * map child chats + one reduce chat, all tagged with the run. Returns the runId
 * and ordered ids (generation, map children, reduce) — the range-selection unit.
 */
export async function seedMapReduceRun(
    baseURL: string,
    wsId: string,
    opts: { children?: number; baseOffsetMinutes?: number; request?: string } = {},
): Promise<{ runId: string; generationId: string; childIds: string[]; reduceId: string; allIds: string[] }> {
    const childCount = opts.children ?? 2;
    const base = opts.baseOffsetMinutes ?? 0;
    const originalRequest = opts.request ?? 'Map Reduce run request';
    const runId = await createMapReduceRun(baseURL, wsId, originalRequest, childCount);

    const generationId = `mr-gen-${runId}`;
    const genTs = seededIso(base);
    await seedProcess(baseURL, generationId, {
        type: 'chat',
        status: 'completed',
        workspaceId: wsId,
        promptPreview: `Map Reduce generation: ${originalRequest}`,
        startTime: genTs,
        endTime: genTs,
        metadata: {
            type: 'chat',
            workspaceId: wsId,
            mode: 'ask',
            mapReduce: { kind: 'generation', runId, workspaceId: wsId },
        },
    });

    const childIds: string[] = [];
    for (let i = 1; i <= childCount; i++) {
        const childId = `mr-child-${runId}-${i}`;
        const childTs = seededIso(base + i);
        await seedProcess(baseURL, childId, {
            type: 'chat',
            status: 'completed',
            workspaceId: wsId,
            promptPreview: `Map child ${i}`,
            startTime: childTs,
            endTime: childTs,
            metadata: {
                type: 'chat',
                workspaceId: wsId,
                mode: 'ask',
                mapReduce: { runId, workspaceId: wsId, phase: 'map', itemId: `mr-item-${i}` },
            },
        });
        childIds.push(childId);
    }

    const reduceId = `mr-reduce-${runId}`;
    const reduceTs = seededIso(base + childCount + 1);
    await seedProcess(baseURL, reduceId, {
        type: 'chat',
        status: 'completed',
        workspaceId: wsId,
        promptPreview: 'Reduce step',
        startTime: reduceTs,
        endTime: reduceTs,
        metadata: {
            type: 'chat',
            workspaceId: wsId,
            mode: 'ask',
            mapReduce: { runId, workspaceId: wsId, phase: 'reduce' },
        },
    });

    return { runId, generationId, childIds, reduceId, allIds: [generationId, ...childIds, reduceId] };
}

/**
 * Seed a spawned sub-conversation tree: a root chat plus descendants linked via
 * `parentProcessId` (same path a real `send_to_conversation` create takes). The
 * default shape is root → [child-1 → grandchild, child-2]. Returns the ids in
 * pre-order (root, child-1, grandchild, child-2).
 */
export async function seedSpawnedTree(
    baseURL: string,
    wsId: string,
    rootId: string,
    opts: { baseOffsetMinutes?: number } = {},
): Promise<{ rootId: string; child1Id: string; grandchildId: string; child2Id: string; allIds: string[] }> {
    const base = opts.baseOffsetMinutes ?? 0;
    const child1Id = `${rootId}-child-1`;
    const grandchildId = `${rootId}-gc-1`;
    const child2Id = `${rootId}-child-2`;

    const seedNode = async (id: string, offset: number, parentProcessId?: string) => {
        const ts = seededIso(base + offset);
        await seedProcess(baseURL, id, {
            type: 'chat',
            status: 'completed',
            workspaceId: wsId,
            promptPreview: `Spawned ${id}`,
            startTime: ts,
            endTime: ts,
            metadata: { type: 'chat', workspaceId: wsId, mode: 'ask' },
            ...(parentProcessId ? { parentProcessId } : {}),
        });
    };

    await seedNode(rootId, 0);
    await seedNode(child1Id, 1, rootId);
    await seedNode(grandchildId, 2, child1Id);
    await seedNode(child2Id, 3, rootId);

    return { rootId, child1Id, grandchildId, child2Id, allIds: [rootId, child1Id, grandchildId, child2Id] };
}
