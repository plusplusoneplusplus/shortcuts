import * as path from 'node:path';
import { loadNativeGit, type NativeGitRepositoryStatus, type NativeGitStatusEntry } from '@plusplusoneplusplus/coc-native';
import { resolveWorkspaceExecutionContext, runGitViaWsl, translatePathForExecution, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { isRepoGroupWorkspaceId, readRepoGroup } from '../workspaces/repo-group-workspace';

export interface MessagingGitStatus {
    branch: NativeGitRepositoryStatus;
    entries: NativeGitStatusEntry[];
    conflicts: number;
    trackingAvailable: boolean;
}

export type MessagingGitStatusReader = (rootPath: string) => Promise<MessagingGitStatus>;

/** Reuse native parsers without the UI services' empty-success fallbacks or safe.directory writes. */
export const readMessagingGitStatus: MessagingGitStatusReader = async rootPath => {
    const addon = loadNativeGit();
    const execution = resolveWorkspaceExecutionContext(rootPath);
    const run = (args: string[]) => execution.kind === 'wsl'
        ? runGitViaWsl(execution, ['-C', translatePathForExecution(rootPath, execution), ...args],
            { timeout: 15_000, maxBuffer: 50 * 1024 * 1024 })
        : addon.execGit(args, rootPath, { timeout: 15_000, maxBuffer: 50 * 1024 * 1024 });
    const metadata = await run(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--untracked-files=all']);
    const changes = await run(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all']);
    return {
        branch: await addon.parseGitBranchStatus(metadata),
        // Porcelain v1's UI parser treats AA/DD as ordinary changes. All seven
        // unmerged codes are separate here; porcelain v2 reports one `u` per file.
        // Type changes count as modifications even though the UI parser omits T.
        entries: await addon.parseGitStatusPorcelain(changes.split('\n')
            .filter(line => !/^(?:DD|AU|UD|UA|DU|AA|UU) /.test(line))
            .map(line => line.slice(0, 2).replace(/T/g, 'M') + line.slice(2)).join('\n')),
        conflicts: metadata.split('\n').filter(line => line.startsWith('u ')).length,
        trackingAvailable: /^# branch\.ab /m.test(metadata),
    };
};

/** One concise segment: `clean`, or only the nonzero change/conflict counts. */
function statusSummary({ entries, conflicts }: MessagingGitStatus): string {
    const counts = { staged: 0, unstaged: 0, untracked: 0, conflicts };
    for (const entry of entries) {
        if (entry.stage === 'staged' || entry.stage === 'unstaged' || entry.stage === 'untracked') counts[entry.stage]++;
    }
    const parts = Object.entries(counts).filter(([, n]) => n).map(([name, n]) => `${n} ${n === 1 && name === 'conflicts' ? 'conflict' : name}`);
    return parts.length ? parts.join(', ') : 'clean';
}

/** The supplied registry is the caller's access scope; group membership never widens it. */
export async function localGitStatusReply(
    workspaces: readonly WorkspaceInfo[], dataDir?: string,
    readStatus: MessagingGitStatusReader = readMessagingGitStatus,
    escape: (text: string) => string = text => text,
): Promise<string> {
    const local = workspaces.filter(ws => !ws.id.startsWith('remote:'));
    const visible = new Map(local.map(ws => [ws.id, ws]));
    const repos = new Map<string, WorkspaceInfo>();
    const notices: string[] = [];
    const add = (ws: WorkspaceInfo) => {
        if (!ws.virtual && !isRepoGroupWorkspaceId(ws.id)) {
            const key = ws.rootPath ? path.resolve(ws.rootPath) : ws.id;
            if (!repos.has(key)) repos.set(key, ws);
        }
    };
    for (const ws of local) {
        if (!isRepoGroupWorkspaceId(ws.id)) { add(ws); continue; }
        const group = dataDir ? readRepoGroup(dataDir, ws.id) : undefined;
        if (!group) {
            notices.push(`${escape(ws.name || ws.id)}: group membership unavailable`);
            continue;
        }
        for (const id of group.members) {
            const member = visible.get(id);
            if (member) add(member);
        }
    }
    const lines: string[] = [];
    for (const ws of repos.values()) {
        const label = escape(ws.name || ws.id);
        if (!ws.rootPath) { lines.push(`${label}: repository path unavailable`); continue; }
        try {
            lines.push(`${label} - ${statusSummary(await readStatus(ws.rootPath))}`);
        } catch (error) {
            console.error('[messaging] Git status failed:', ws.id, error);
            const message = error instanceof Error ? error.message : '';
            const reason = /not a git repository/i.test(message) ? 'not a Git repository'
                : /ENOENT|does not exist|cannot (?:change|chdir)|no such file/i.test(message) ? 'repository unavailable' : 'status failed';
            lines.push(`${label}: ${reason}`);
        }
    }
    const rows = [...lines, ...notices];
    return [
        `Git status - local repos (${repos.size})`,
        rows.length ? rows.join('\n') : 'No accessible local repos registered.',
    ].join('\n\n');
}
