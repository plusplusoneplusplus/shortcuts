import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Installation identity, shared by all workspaces and independent of transports. */
export function getOrCreateServerIdentity(dataDir: string): string {
    const identityPath = path.join(dataDir, 'server-identity.json');
    const readIdentity = (): string => {
        const saved = JSON.parse(fs.readFileSync(identityPath, 'utf8')) as { serverIdentity?: unknown } | null;
        if (typeof saved?.serverIdentity !== 'string' || !UUID_PATTERN.test(saved.serverIdentity)) {
            throw new Error(`Invalid server identity in ${identityPath}`);
        }
        return saved.serverIdentity;
    };

    try {
        return readIdentity();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    fs.mkdirSync(dataDir, { recursive: true });
    const serverIdentity = randomUUID();
    const temporaryPath = path.join(dataDir, `.server-identity-${serverIdentity}.tmp`);
    fs.writeFileSync(temporaryPath, JSON.stringify({ serverIdentity }) + '\n', { flag: 'wx', mode: 0o600 });
    try {
        // Publish complete bytes without replacing a concurrent startup's identity.
        try {
            fs.linkSync(temporaryPath, identityPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        return readIdentity();
    } finally {
        fs.unlinkSync(temporaryPath);
    }
}
