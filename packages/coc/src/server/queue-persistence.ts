/**
 * Queue persistence — re-exported from @plusplusoneplusplus/coc-server.
 * The canonical implementation lives in packages/coc-server/src/queue/queue-persistence.ts.
 */
export type {
    PersistedQueueState,
    RestartPolicy,
    QueuePersistenceOptions,
} from '@plusplusoneplusplus/coc-server';
export {
    getRepoQueueFilePath,
    sanitizeTaskForPersistence,
    atomicWriteJson,
    QueuePersistence,
    CURRENT_VERSION,
} from '@plusplusoneplusplus/coc-server';
