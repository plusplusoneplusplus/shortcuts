/**
 * Workspace-scoped EnDev xDPU activation helpers.
 *
 * This module intentionally keeps EnDev integration local to the selected
 * workspace. It never writes Windows-side Copilot MCP config.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo, WslExecutionContext } from '@plusplusoneplusplus/forge';
import {
    buildWslCommandArgs,
    normalizeExecutionPath,
    resolveWorkspaceExecutionContext,
    getWslExecutablePath,
} from '@plusplusoneplusplus/forge';

export const ENDEV_XDPU_WRAPPER_SKILL_NAME = 'EnDev-xDpu';
export const ENDEV_XDPU_REQUIRED_PLUGIN_SKILLS = [
    'dpu-log-triage',
    'dpu-log-fetch',
    'hbm-dump-triage',
] as const;

const WSL_COMMAND_TIMEOUT_MS = 120_000;
const WSL_COMMAND_MAX_BUFFER = 10 * 1024 * 1024;

export interface EnDevXDpuWslCommandRequest {
    distro: string;
    linuxWorkingDirectory: string;
    command: string;
    timeoutMs?: number;
}

export interface EnDevXDpuWslCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export type EnDevXDpuWslCommandRunner = (
    request: EnDevXDpuWslCommandRequest,
) => Promise<EnDevXDpuWslCommandResult>;

export interface EnDevXDpuActivationResult {
    workspace: WorkspaceInfo;
    wslDistro: string;
    xstoreRepoRoot: string;
    pluginSkillFolder: string;
    extraSkillFolder: string;
    mcpConfigPath?: string;
    wrapperSkillPath: string;
    doctorOutput: string;
}

export class EnDevXDpuSetupError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'EnDevXDpuSetupError';
    }
}

let runnerOverrideForTesting: EnDevXDpuWslCommandRunner | undefined;

export function setEnDevXDpuWslCommandRunnerForTesting(runner: EnDevXDpuWslCommandRunner | undefined): void {
    runnerOverrideForTesting = runner;
}

function getRunner(runner?: EnDevXDpuWslCommandRunner): EnDevXDpuWslCommandRunner {
    return runner ?? runnerOverrideForTesting ?? runWslCommand;
}

function normalizeLinuxPath(input: string): string {
    const normalized = input.replace(/\\/g, '/').replace(/\/+$/g, '');
    return normalized.length > 0 ? normalized : '/';
}

function linuxPathToWslUncPath(distro: string, linuxPath: string): string {
    const normalized = normalizeLinuxPath(linuxPath);
    if (normalized === '/') {
        return path.win32.normalize(`\\\\wsl$\\${distro}`);
    }
    return path.win32.normalize(`\\\\wsl$\\${distro}${normalized.replace(/\//g, '\\')}`);
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncateOutput(value: string): string {
    const trimmed = value.trim();
    return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}...` : trimmed;
}

function formatCommandDetails(result: EnDevXDpuWslCommandResult): Record<string, unknown> {
    return {
        exitCode: result.exitCode,
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
    };
}

function resolveActivationConfig(workspace: WorkspaceInfo): { distro: string; xstoreRepoRoot: string } {
    if (workspace.endevXDpu?.enabled !== true) {
        throw new EnDevXDpuSetupError(
            'EnDev-xDpu is not enabled for this workspace.',
            'ENDEV_XDPU_DISABLED',
        );
    }

    const context = resolveWorkspaceExecutionContext(workspace.rootPath);
    if (context.kind !== 'wsl') {
        throw new EnDevXDpuSetupError(
            'EnDev-xDpu requires a WSL workspace root. Register the xStore checkout using a WSL path such as \\\\wsl$\\Ubuntu\\home\\user\\xstore.',
            'ENDEV_XDPU_UNSUPPORTED_WORKSPACE',
        );
    }

    const distro = workspace.endevXDpu.wslDistro?.trim() || context.distro;
    if (!distro) {
        throw new EnDevXDpuSetupError(
            'EnDev-xDpu requires a WSL distro. Set the workspace EnDev-xDpu WSL distro field and try again.',
            'ENDEV_XDPU_MISSING_DISTRO',
        );
    }

    const xstoreRepoRoot = workspace.endevXDpu.xstoreRepoRoot?.trim() || context.linuxWorkingDirectory;
    if (!xstoreRepoRoot || !xstoreRepoRoot.startsWith('/')) {
        throw new EnDevXDpuSetupError(
            'EnDev-xDpu requires the xStore WSL repo root as a Linux absolute path, for example /home/user/xstore.',
            'ENDEV_XDPU_MISSING_REPO_ROOT',
        );
    }

    return { distro, xstoreRepoRoot: normalizeLinuxPath(xstoreRepoRoot) };
}

async function runWslCommand(request: EnDevXDpuWslCommandRequest): Promise<EnDevXDpuWslCommandResult> {
    const context: WslExecutionContext = {
        kind: 'wsl',
        distro: request.distro,
        linuxWorkingDirectory: request.linuxWorkingDirectory,
        originalWorkingDirectory: request.linuxWorkingDirectory,
    };
    const args = buildWslCommandArgs(context, ['sh', '-lc', request.command]);

    return await new Promise<EnDevXDpuWslCommandResult>((resolve) => {
        execFile(
            getWslExecutablePath(),
            args,
            {
                encoding: 'utf8',
                timeout: request.timeoutMs ?? WSL_COMMAND_TIMEOUT_MS,
                maxBuffer: WSL_COMMAND_MAX_BUFFER,
            },
            (error, stdout, stderr) => {
                const out = typeof stdout === 'string' ? stdout : String(stdout ?? '');
                const err = typeof stderr === 'string' ? stderr : String(stderr ?? '');
                if (error) {
                    const withCode = error as NodeJS.ErrnoException & { code?: number | string; signal?: string };
                    const numericCode = typeof withCode.code === 'number' ? withCode.code : 1;
                    const message = withCode.message ? `${err}${err ? '\n' : ''}${withCode.message}` : err;
                    resolve({ exitCode: numericCode, stdout: out, stderr: message });
                    return;
                }
                resolve({ exitCode: 0, stdout: out, stderr: err });
            },
        );
    });
}

async function runRequiredWslCommand(
    runner: EnDevXDpuWslCommandRunner,
    request: EnDevXDpuWslCommandRequest,
    label: string,
    failureCode: string,
    setupHint: string,
): Promise<EnDevXDpuWslCommandResult> {
    let result: EnDevXDpuWslCommandResult;
    try {
        result = await runner(request);
    } catch (error) {
        throw new EnDevXDpuSetupError(
            `${label} failed to start in WSL. ${setupHint}`,
            failureCode,
            { error: error instanceof Error ? error.message : String(error) },
        );
    }

    if (result.exitCode !== 0) {
        throw new EnDevXDpuSetupError(
            `${label} failed in WSL. ${setupHint}`,
            failureCode,
            formatCommandDetails(result),
        );
    }

    return result;
}

function buildDiscoveryScript(xstoreRepoRoot: string): string {
    const root = shellQuote(xstoreRepoRoot);
    const required = ENDEV_XDPU_REQUIRED_PLUGIN_SKILLS.join(' ');
    return `
set -u
root=${root}
required='${required}'
has_required() {
  dir="$1"
  [ -d "$dir" ] || return 1
  for skill in $required; do
    [ -f "$dir/$skill/SKILL.md" ] || return 1
  done
  return 0
}
print_first_skills_dir() {
  for dir in "$@"; do
    if has_required "$dir"; then
      printf 'SKILLS=%s\\n' "$dir"
      return 0
    fi
  done
  return 1
}
if ! print_first_skills_dir \
  "$root/Developer/private/EnDpuDev/plugin/skills" \
  "$root/.endev/plugin/skills" \
  "$HOME/.endev/mcp-servers/node_modules/funbird-mcp/skills" \
  "$HOME/.endev/generated/skills"; then
  found="$(
    for base in "$root" "$HOME/.endev"; do
      [ -e "$base" ] || continue
      find "$base" -maxdepth 8 -path '*/dpu-log-triage/SKILL.md' -print 2>/dev/null
    done | while IFS= read -r marker; do
      dir="$(dirname "$(dirname "$marker")")"
      if has_required "$dir"; then
        printf '%s\\n' "$dir"
        break
      fi
    done
  )"
  if [ -z "$found" ]; then
    printf 'ERROR=Could not locate EnDev plugin skills containing %s. Run endev doctor in the WSL workspace and ensure the EnDev plugin is installed.\\n' "$required"
    exit 21
  fi
  printf 'SKILLS=%s\\n' "$found"
fi
for file in "$HOME/.endev/generated/.mcp.json" "$HOME/.endev/source/.vscode/mcp.json"; do
  if [ -f "$file" ] && grep -q 'funbird-mcp' "$file"; then
    printf 'MCP=%s\\n' "$file"
    break
  fi
done
`;
}

function parseDiscoveryOutput(stdout: string): { pluginSkillFolder: string; mcpConfigPath?: string } {
    let pluginSkillFolder: string | undefined;
    let mcpConfigPath: string | undefined;
    let errorLine: string | undefined;

    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (line.startsWith('SKILLS=')) {
            pluginSkillFolder = line.slice('SKILLS='.length).trim();
        } else if (line.startsWith('MCP=')) {
            mcpConfigPath = line.slice('MCP='.length).trim();
        } else if (line.startsWith('ERROR=')) {
            errorLine = line.slice('ERROR='.length).trim();
        }
    }

    if (!pluginSkillFolder) {
        throw new EnDevXDpuSetupError(
            errorLine || 'Could not locate EnDev plugin skills in WSL.',
            'ENDEV_XDPU_SKILLS_NOT_FOUND',
            { stdout: truncateOutput(stdout) },
        );
    }

    return {
        pluginSkillFolder: normalizeLinuxPath(pluginSkillFolder),
        ...(mcpConfigPath ? { mcpConfigPath: normalizeLinuxPath(mcpConfigPath) } : {}),
    };
}

function wrapperSkillContent(): string {
    return `---
name: ${ENDEV_XDPU_WRAPPER_SKILL_NAME}
description: Use workspace-local EnDev xDPU skills and bridged WSL MCP from CoC without nested EnDev Copilot sessions.
---

# ${ENDEV_XDPU_WRAPPER_SKILL_NAME}

Use this skill when working on xDPU/xStore tasks in a WSL workspace with EnDev enabled through CoC.

- Prefer the EnDev plugin skills exposed in this workspace, especially \`dpu-log-triage\`, \`dpu-log-fetch\`, and \`hbm-dump-triage\`.
- Do not run nested \`endev copilot\`; CoC owns the chat/workflow session and routes EnDev capabilities through workspace skills and MCP.
- Run shell commands through the WSL workspace context. \`endev doctor\` is the setup validation command when EnDev tools appear unavailable.
- For HBM dump analysis, use \`hbm-dump-triage\` with the bridged \`funbird-mcp\` tools when the user has network access and credentials.
- Manual smoke validation may use sanity job 48037 and sample \`0_FUN-S21F1E-E001_1778203452409685840_hbm1.bin.tgz\`; automated tests must not download internal artifacts.
`;
}

function installWrapperSkill(dataDir: string): string {
    const skillDir = path.join(dataDir, 'skills', ENDEV_XDPU_WRAPPER_SKILL_NAME);
    const skillPath = path.join(skillDir, 'SKILL.md');
    const content = wrapperSkillContent();
    fs.mkdirSync(skillDir, { recursive: true });
    if (!fs.existsSync(skillPath) || fs.readFileSync(skillPath, 'utf-8') !== content) {
        fs.writeFileSync(skillPath, content, 'utf-8');
    }
    return skillPath;
}

function pathsEqual(left: string, right: string): boolean {
    try {
        return normalizeExecutionPath(left) === normalizeExecutionPath(right);
    } catch {
        return left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase();
    }
}

function addExtraSkillFolder(existing: string[] | undefined, extraSkillFolder: string): string[] {
    const folders = existing ? [...existing] : [];
    if (!folders.some(folder => pathsEqual(folder, extraSkillFolder))) {
        folders.push(extraSkillFolder);
    }
    return folders;
}

export async function activateEnDevXDpuWorkspace(
    store: ProcessStore,
    workspace: WorkspaceInfo,
    dataDir: string,
    runner?: EnDevXDpuWslCommandRunner,
): Promise<EnDevXDpuActivationResult> {
    const { distro, xstoreRepoRoot } = resolveActivationConfig(workspace);
    const commandRunner = getRunner(runner);

    const doctor = await runRequiredWslCommand(
        commandRunner,
        {
            distro,
            linuxWorkingDirectory: xstoreRepoRoot,
            command: 'endev doctor',
            timeoutMs: WSL_COMMAND_TIMEOUT_MS,
        },
        'endev doctor',
        'ENDEV_XDPU_DOCTOR_FAILED',
        'Open the WSL workspace terminal and run `endev doctor` to fix the reported setup issues.',
    );

    const discovery = await runRequiredWslCommand(
        commandRunner,
        {
            distro,
            linuxWorkingDirectory: xstoreRepoRoot,
            command: buildDiscoveryScript(xstoreRepoRoot),
            timeoutMs: WSL_COMMAND_TIMEOUT_MS,
        },
        'EnDev plugin discovery',
        'ENDEV_XDPU_DISCOVERY_FAILED',
        'Run `endev doctor` in the WSL workspace and ensure the EnDev plugin is installed.',
    );
    const { pluginSkillFolder, mcpConfigPath } = parseDiscoveryOutput(discovery.stdout);
    const extraSkillFolder = linuxPathToWslUncPath(distro, pluginSkillFolder);
    const wrapperSkillPath = installWrapperSkill(dataDir);
    const extraSkillFolders = addExtraSkillFolder(workspace.extraSkillFolders, extraSkillFolder);
    const updated = await store.updateWorkspace(workspace.id, { extraSkillFolders });

    return {
        workspace: updated ?? { ...workspace, extraSkillFolders },
        wslDistro: distro,
        xstoreRepoRoot,
        pluginSkillFolder,
        extraSkillFolder,
        ...(mcpConfigPath ? { mcpConfigPath } : {}),
        wrapperSkillPath,
        doctorOutput: truncateOutput(`${doctor.stdout}\n${doctor.stderr}`),
    };
}
