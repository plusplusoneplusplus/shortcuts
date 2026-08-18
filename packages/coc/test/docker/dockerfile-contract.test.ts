/**
 * Contract guard for the server image (root Dockerfile).
 *
 * The image is loopback-only by policy (`--host 127.0.0.1`, never 0.0.0.0, no
 * EXPOSE), non-root, HOME on the /data volume, tini as PID 1 so `coc serve`
 * drains on SIGTERM. These are text assertions so they run on every OS in CI;
 * the real build/health/loopback smoke is the `docker-build-smoke` CI job.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../../..');

/** Read a repo file as LF text (Windows checkouts may be CRLF). */
function readRepoFile(rel: string): string {
    return fs.readFileSync(path.join(repoRoot, rel), 'utf-8').replace(/\r\n/g, '\n');
}
const dockerfile = readRepoFile('Dockerfile');
const dockerignore = readRepoFile('.dockerignore');

/** Instruction lines only (comments stripped), with `\`-continuations joined. */
function instructions(): string[] {
    return dockerfile
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n')
        .replace(/\\\n\s*/g, ' ')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
}

function instruction(name: string): string[] {
    return instructions().filter((l) => new RegExp(`^${name}\\b`).test(l));
}

describe('Dockerfile contract', () => {
    it('binds loopback in CMD and never mentions 0.0.0.0', () => {
        const [cmd, ...rest] = instruction('CMD');
        expect(rest).toEqual([]);
        expect(cmd).toContain('"--host","127.0.0.1"');
        expect(cmd).toContain('"--data-dir","/data/.coc"');
        expect(dockerfile).not.toContain('0.0.0.0');
    });

    it('has no EXPOSE (port publishing cannot reach a loopback bind)', () => {
        expect(instruction('EXPOSE')).toEqual([]);
    });

    it('runs as the non-root node user with HOME on the /data volume', () => {
        expect(instruction('USER')).toEqual(['USER node']);
        expect(instruction('ENV').some((l) => /\bHOME=\/data\b/.test(l))).toBe(true);
        expect(instruction('VOLUME')).toEqual(['VOLUME ["/data"]']);
        expect(dockerfile).toMatch(/chown -R node:node \/data \/work/);
    });

    it('uses tini as PID 1 and the entrypoint script that execs coc serve', () => {
        expect(instruction('ENTRYPOINT')).toEqual(['ENTRYPOINT ["tini","--","coc-entrypoint"]']);
        expect(dockerfile).toMatch(/apt-get install[^\n]*\btini\b/);
        expect(dockerfile).toMatch(/COPY docker\/entrypoint\.sh \/usr\/local\/bin\/coc-entrypoint/);
        expect(fs.existsSync(path.join(repoRoot, 'docker', 'entrypoint.sh'))).toBe(true);
    });

    it('health check probes 127.0.0.1 only', () => {
        const [health] = instruction('HEALTHCHECK');
        expect(health).toBeDefined();
        expect(health).toContain("http://127.0.0.1:'+(process.env.COC_PORT||4000)+'/api/health");
    });

    it('puts the coc CLI on PATH', () => {
        expect(dockerfile).toMatch(/ln -s \/app\/packages\/coc\/dist\/index\.js \/usr\/local\/bin\/coc/);
    });

    it('installs git and a pinned, checksummed gh for both amd64 and arm64', () => {
        expect(dockerfile).toMatch(/apt-get install[^\n]*\bgit\b/);
        expect(dockerfile).toMatch(/^ARG GH_VERSION=\d+\.\d+\.\d+$/m);
        expect(dockerfile).toMatch(/^ARG GH_SHA256_AMD64=[0-9a-f]{64}$/m);
        expect(dockerfile).toMatch(/^ARG GH_SHA256_ARM64=[0-9a-f]{64}$/m);
        expect(dockerfile).toContain('sha256sum -c');
    });

    it('builds the JS once on the build platform and installs deps per target arch', () => {
        expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:\$\{NODE_VERSION\}-bookworm AS build$/m);
        expect(dockerfile).toMatch(/^FROM node:\$\{NODE_VERSION\}-bookworm AS deps$/m);
        expect(dockerfile).toMatch(/^RUN npm run build -w packages\/coc$/m);
        expect(dockerfile).toMatch(/npm ci --omit=dev/);
        expect(dockerfile).toMatch(/^COPY --from=deps\s+\/src\/node_modules \.\/node_modules$/m);
        // The build stage's (build-arch) node_modules must never reach the runtime image.
        expect(dockerfile).toMatch(/^RUN rm -rf node_modules && find packages .* -name node_modules .*-exec rm -rf \{\} \+$/m);
    });

    it('passes the build commit through so /api/health reports it (no .git in the context)', () => {
        expect(dockerignore.split('\n')).toContain('.git');
        expect(dockerfile).toMatch(/^ARG BUILD_COMMIT=unknown$/m);
        expect(dockerfile).toMatch(/^ENV COC_BUILD_COMMIT=\$\{BUILD_COMMIT\}$/m);
    });

    it('layer-caches npm ci over every workspace package.json (kept in sync with root workspaces)', () => {
        const rootPkg = JSON.parse(readRepoFile('package.json'));
        const workspaces: string[] = rootPkg.workspaces;
        expect(workspaces.length).toBeGreaterThan(0);

        // Both the build stage and the target-arch deps stage need the full set.
        const stages = dockerfile.split(/^FROM /m).slice(1);
        const installStages = stages.filter((s) => /\bnpm ci\b/.test(s));
        expect(installStages).toHaveLength(2);
        for (const stage of installStages) {
            const copied = [...stage.matchAll(/^COPY (packages\/[\w-]+)\/package\.json\s+\1\/$/gm)].map((m) => m[1]);
            expect([...copied].sort()).toEqual([...workspaces].sort());
            // package.json copies must precede the install so the layer is cacheable.
            expect(stage.indexOf('COPY packages/')).toBeLessThan(stage.indexOf('npm ci'));
        }
    });

    it('.dockerignore keeps the build lean without dropping build inputs', () => {
        const lines = dockerignore.split('\n').map((l) => l.trim());
        for (const required of ['node_modules', 'packages/*/node_modules', 'packages/*/dist', '.git', '.github', 'packages/coc/src/server/spa/client/dist']) {
            expect(lines).toContain(required);
        }
        // Build inputs: forge resources (bundled skills) and the per-package build scripts.
        for (const forbidden of ['packages/forge/resources', 'scripts', 'packages/*/scripts', 'docker', '.claude']) {
            expect(lines).not.toContain(forbidden);
        }
    });
});
