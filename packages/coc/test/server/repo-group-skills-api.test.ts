/**
 * AC-03 — `/api/workspaces/:groupId/skills` for a repo group.
 *
 * A repo group is an ordinary registry workspace whose id carries the `group-` prefix and
 * whose root is `<dataDir>/repos/<groupId>/` with no git checkout. It therefore has no
 * `.github/skills` of its own — its skill list is the global folder plus each live member
 * repo's skills, tagged `source: 'repo-group-member'` with the member's `sourceRepoId`.
 * These tests pin that listing and the disable toggle so nobody later special-cases a
 * group id in the routes, and so the "group settings touch only the group" constraint
 * stays honest.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { createRepoGroup } from '../../src/server/workspaces/repo-group-workspace';
import { skillCache } from '../../src/server/skills/skill-handler';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        loadDefaultMcpConfig: vi.fn().mockReturnValue({ mcpServers: {} }),
        sdkServiceRegistry: {
            getOrThrow: () => ({ sendMessage: vi.fn(), isAvailable: vi.fn().mockResolvedValue({ available: false }) }),
        },
    };
});

function request(
    url: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({
                    status: res.statusCode || 0,
                    body: Buffer.concat(chunks).toString('utf-8'),
                }));
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function jsonReq(url: string, method: string, data: unknown) {
    return request(url, { method, body: JSON.stringify(data) });
}

/** Write a minimal skill folder — a directory holding a SKILL.md — under `root`. */
function writeSkill(root: string, name: string, body: string) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
}

describe('Repo group — /api/workspaces/:groupId/skills', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let memberDir: string;
    let groupId: string;
    const memberId = 'ws-group-skills-member';

    beforeEach(async () => {
        // The skill list cache is module-level and keyed by workspace id, and every test
        // here mints the same group id from the same group name.
        skillCache.clear();

        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-skills-data-'));
        memberDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-skills-member-'));

        // A global skill, and a skill that only the member repo has.
        writeSkill(path.join(dataDir, 'skills'), 'code-review', '# code-review\nReviews code');
        writeSkill(path.join(memberDir, '.github', 'skills'), 'deploy-api', '# deploy-api\nDeploys the API');

        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        await jsonReq(`${server.url}/api/workspaces`, 'POST', { id: memberId, name: 'API', rootPath: memberDir });
        const group = await createRepoGroup(dataDir, store, { name: 'Group Skills Demo', members: [memberId] });
        groupId = group.id;
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(memberDir, { recursive: true, force: true });
    });

    async function listGroupSkills(): Promise<any[]> {
        const res = await request(`${server!.url}/api/workspaces/${groupId}/skills`);
        expect(res.status).toBe(200);
        return JSON.parse(res.body).skills as any[];
    }

    it('lists global skills plus skills inherited from live member repos', async () => {
        const skills = await listGroupSkills();
        const byName = new Map(skills.map(skill => [skill.name, skill]));

        expect(byName.get('code-review')?.source).toBe('global');
        const inherited = byName.get('deploy-api');
        expect(inherited?.source).toBe('repo-group-member');
        expect(inherited?.sourceRepoId).toBe(memberId);
    });

    it('omits skills from a stale member repo instead of failing', async () => {
        fs.rmSync(memberDir, { recursive: true, force: true });
        const skills = await listGroupSkills();
        expect(skills.some(skill => skill.name === 'deploy-api')).toBe(false);
        // The global folder still resolves — a missing member is not an error.
        expect(skills.some(skill => skill.name === 'code-review')).toBe(true);
    });

    it('persists the group disable toggle on the group workspace record', async () => {
        const put = await jsonReq(
            `${server!.url}/api/workspaces/${groupId}/skills-config`,
            'PUT',
            { disabledSkills: ['deploy-api'] },
        );
        expect(put.status).toBe(200);

        const res = await request(`${server!.url}/api/workspaces/${groupId}/skills-config`);
        expect(JSON.parse(res.body).disabledSkills).toEqual(['deploy-api']);
    });

    it('leaves the member repo\'s own skill enablement untouched', async () => {
        await jsonReq(`${server!.url}/api/workspaces/${memberId}/skills-config`, 'PUT', { disabledSkills: [] });
        await jsonReq(`${server!.url}/api/workspaces/${groupId}/skills-config`, 'PUT', { disabledSkills: ['deploy-api'] });

        const member = await request(`${server!.url}/api/workspaces/${memberId}/skills-config`);
        expect(JSON.parse(member.body).disabledSkills).toEqual([]);
    });

    it('never creates a skills folder under the group root', async () => {
        await listGroupSkills();
        await jsonReq(`${server!.url}/api/workspaces/${groupId}/skills-config`, 'PUT', { disabledSkills: ['deploy-api'] });

        const groupRoot = path.join(dataDir, 'repos', groupId);
        expect(fs.existsSync(path.join(groupRoot, '.github', 'skills'))).toBe(false);
        expect(fs.existsSync(path.join(groupRoot, '.github'))).toBe(false);
    });
});
