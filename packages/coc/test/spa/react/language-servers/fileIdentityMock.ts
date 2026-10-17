import { beforeEach, vi } from 'vitest';

/** Filesystem identity seam for suites whose files exist only in mocked IO. */
const mockFileIdentity = vi.hoisted(() => vi.fn(async (_owner: unknown, path: string) => path));
vi.mock('../../../../src/server/spa/client/react/features/language-servers/fileIdentity', async importOriginal => ({
    ...await importOriginal<object>(),
    resolveOwnedFile: mockFileIdentity,
}));
beforeEach(() => { mockFileIdentity.mockImplementation(async (_owner, path) => path); });

export { mockFileIdentity };
