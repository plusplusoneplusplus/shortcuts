/**
 * Workspace-scoped EnDev xDPU activation helpers.
 *
 * This module intentionally keeps EnDev integration local to the selected
 * workspace. It never writes Windows-side Copilot MCP config.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { MCPServerConfig, ProcessStore, WorkspaceInfo, WslExecutionContext } from '@plusplusoneplusplus/forge';
import {
    buildWslCommandArgs,
    normalizeExecutionPath,
    resolveWorkspaceExecutionContext,
    getWslExecutablePath,
} from '@plusplusoneplusplus/forge';

export const ENDEV_XDPU_WRAPPER_SKILL_NAME = 'EnDev-xDpu';
export const ENDEV_XDPU_MCP_SERVER_NAME = 'funbird-mcp';
export const ENDEV_XDPU_REQUIRED_PLUGIN_SKILLS = [
    'dpu-log-triage',
    'dpu-log-fetch',
    'hbm-dump-triage',
] as const;
export const ENDEV_XDPU_HBM_SMOKE_SANITY_JOB_ID = '48037';
export const ENDEV_XDPU_HBM_SMOKE_SAMPLE = '0_FUN-S21F1E-E001_1778203452409685840_hbm1.bin.tgz';

const WSL_COMMAND_TIMEOUT_MS = 120_000;
const WSL_COMMAND_MAX_BUFFER = 10 * 1024 * 1024;
type EnDevXDpuHostMode = 'windows-wsl' | 'native-linux';
type EnDevXDpuActivationConfig =
    | { hostMode: 'windows-wsl'; distro: string; xstoreRepoRoot: string }
    | { hostMode: 'native-linux'; distro?: string; xstoreRepoRoot: string };

export interface EnDevXDpuWslCommandRequest {
    distro?: string;
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
    wslDistro?: string;
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
let hostPlatformOverrideForTesting: NodeJS.Platform | undefined;

export function setEnDevXDpuWslCommandRunnerForTesting(runner: EnDevXDpuWslCommandRunner | undefined): void {
    runnerOverrideForTesting = runner;
}

export function setEnDevXDpuHostPlatformForTesting(platform: NodeJS.Platform | undefined): void {
    hostPlatformOverrideForTesting = platform;
}

function getHostPlatform(): NodeJS.Platform {
    return hostPlatformOverrideForTesting ?? process.platform;
}

function getRunner(hostMode: EnDevXDpuHostMode, runner?: EnDevXDpuWslCommandRunner): EnDevXDpuWslCommandRunner {
    return runner ?? runnerOverrideForTesting ?? (hostMode === 'native-linux' ? runNativeCommand : runWslCommand);
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function resolveActivationConfig(workspace: WorkspaceInfo): EnDevXDpuActivationConfig {
    if (workspace.endevXDpu?.enabled !== true) {
        throw new EnDevXDpuSetupError(
            'EnDev-xDpu is not enabled for this workspace.',
            'ENDEV_XDPU_DISABLED',
        );
    }

    const hostPlatform = getHostPlatform();
    const configuredRoot = workspace.endevXDpu.xstoreRepoRoot?.trim();
    if (hostPlatform === 'linux') {
        const nativeRoot = configuredRoot || (workspace.rootPath.startsWith('/') ? workspace.rootPath : undefined);
        if (nativeRoot?.startsWith('/')) {
            return {
                hostMode: 'native-linux',
                ...(workspace.endevXDpu.wslDistro?.trim() ? { distro: workspace.endevXDpu.wslDistro.trim() } : {}),
                xstoreRepoRoot: normalizeLinuxPath(nativeRoot),
            };
        }
    }

    const context = resolveWorkspaceExecutionContext(workspace.rootPath);
    if (hostPlatform !== 'win32' || context.kind !== 'wsl') {
        throw new EnDevXDpuSetupError(
            'EnDev-xDpu requires a WSL workspace root. On Windows, register the xStore checkout using a WSL path such as \\\\wsl$\\Ubuntu\\home\\user\\xstore. When CoC runs inside WSL, register the native Linux path such as /home/user/xstore.',
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

    const xstoreRepoRoot = configuredRoot || context.linuxWorkingDirectory;
    if (!xstoreRepoRoot || !xstoreRepoRoot.startsWith('/')) {
        throw new EnDevXDpuSetupError(
            'EnDev-xDpu requires the xStore WSL repo root as a Linux absolute path, for example /home/user/xstore.',
            'ENDEV_XDPU_MISSING_REPO_ROOT',
        );
    }

    return {
        hostMode: 'windows-wsl',
        distro,
        xstoreRepoRoot: normalizeLinuxPath(xstoreRepoRoot),
    };
}

async function runWslCommand(request: EnDevXDpuWslCommandRequest): Promise<EnDevXDpuWslCommandResult> {
    if (!request.distro) {
        throw new Error('WSL distro is required when EnDev-xDpu runs through the Windows WSL bridge.');
    }
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

async function runNativeCommand(request: EnDevXDpuWslCommandRequest): Promise<EnDevXDpuWslCommandResult> {
    return await new Promise<EnDevXDpuWslCommandResult>((resolve) => {
        execFile(
            'sh',
            ['-lc', request.command],
            {
                cwd: request.linuxWorkingDirectory,
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
  dir="\\$1"
  [ -d "\\$dir" ] || return 1
  for skill in \\$required; do
    [ -f "\\$dir/\\$skill/SKILL.md" ] || return 1
  done
  return 0
}
has_funbird_mcp() {
  file="\\$1"
  [ -f "\\$file" ] && grep -q '${ENDEV_XDPU_MCP_SERVER_NAME}' "\\$file"
}
print_first_skills_dir() {
  for dir in "\\$@"; do
    if has_required "\\$dir"; then
      printf 'SKILLS=%s\\n' "\\$dir"
      return 0
    fi
  done
  return 1
}
if ! print_first_skills_dir \
  "\\$root/Developer/private/EnDpuDev/plugin/skills" \
  "\\$root/.endev/plugin/skills" \
  "\\$HOME/.endev/source/plugin/skills" \
  "\\$HOME/.endev/mcp-servers/node_modules/funbird-mcp/skills" \
  "\\$HOME/.endev/generated/skills"; then
  found="$(
    for base in "\\$HOME/.endev/source" "\\$HOME/.endev" "\\$root"; do
      [ -e "\\$base" ] || continue
      find "\\$base" -maxdepth 16 -type f -path '*/dpu-log-triage/SKILL.md' -print 2>/dev/null
    done | while IFS= read -r marker; do
      dir="$(dirname "$(dirname "\\$marker")")"
      if has_required "\\$dir"; then
        printf '%s\\n' "\\$dir"
        break
      fi
    done
  )"
  if [ -z "\\$found" ]; then
    printf 'ERROR=Could not locate EnDev plugin skills containing %s. Run endev doctor in the WSL workspace and ensure the EnDev plugin is installed.\\n' "\\$required"
    exit 21
  fi
  printf 'SKILLS=%s\\n' "\\$found"
fi
print_first_mcp_config() {
  for file in "\\$@"; do
    if has_funbird_mcp "\\$file"; then
      printf 'MCP=%s\\n' "\\$file"
      return 0
    fi
  done
  return 1
}
if ! print_first_mcp_config \
  "\\$HOME/.endev/generated/.mcp.json" \
  "\\$HOME/.endev/source/.mcp.json" \
  "\\$HOME/.endev/source/.vscode/mcp.json" \
  "\\$root/.mcp.json" \
  "\\$root/.vscode/mcp.json"; then
  found_mcp="$(
    for base in "\\$HOME/.endev/source" "\\$HOME/.endev" "\\$root"; do
      [ -e "\\$base" ] || continue
      find "\\$base" -maxdepth 16 -type f \\( -name '.mcp.json' -o -path '*/.vscode/mcp.json' \\) -print 2>/dev/null
    done | while IFS= read -r file; do
      if has_funbird_mcp "\\$file"; then
        printf '%s\\n' "\\$file"
        break
      fi
    done
  )"
  if [ -n "\\$found_mcp" ]; then
    printf 'MCP=%s\\n' "\\$found_mcp"
  fi
fi
`;
}

function parseDiscoveryOutput(stdout: string): { pluginSkillFolder: string; mcpConfigPath: string } {
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

    if (!mcpConfigPath) {
        throw new EnDevXDpuSetupError(
            `Could not locate EnDev generated MCP config containing ${ENDEV_XDPU_MCP_SERVER_NAME}. Run \`endev doctor\` in the WSL workspace and ensure EnDev generated MCP config is available.`,
            'ENDEV_XDPU_MCP_CONFIG_NOT_FOUND',
            { stdout: truncateOutput(stdout) },
        );
    }

    return {
        pluginSkillFolder: normalizeLinuxPath(pluginSkillFolder),
        mcpConfigPath: normalizeLinuxPath(mcpConfigPath),
    };
}

function buildMcpConfigReadScript(mcpConfigPath: string | undefined): string {
    const candidates = [
        ...(mcpConfigPath ? [mcpConfigPath] : []),
        '$HOME/.endev/generated/.mcp.json',
        '$HOME/.endev/source/.mcp.json',
        '$HOME/.endev/source/.vscode/mcp.json',
        './.mcp.json',
        './.vscode/mcp.json',
    ];
    const seen = new Set<string>();
    const tests = candidates
        .filter(candidate => {
            const key = candidate.replace(/\/+$/g, '');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(candidate => candidate.startsWith('$HOME/')
            ? `"${candidate.replace(/^\$HOME\//, '\\$HOME/')}"`
            : shellQuote(normalizeLinuxPath(candidate)));

    return `
set -u
has_funbird_mcp() {
  file="\\$1"
  [ -f "\\$file" ] && grep -q '${ENDEV_XDPU_MCP_SERVER_NAME}' "\\$file"
}
print_mcp_json() {
  file="\\$1"
  printf 'MCP=%s\\n' "\\$file"
  printf 'JSON_BEGIN\\n'
  cat "\\$file"
  printf '\\nJSON_END\\n'
}
for file in ${tests.join(' ')}; do
  if has_funbird_mcp "\\$file"; then
    print_mcp_json "\\$file"
    exit 0
  fi
done
found_mcp="$(
  for base in "\\$HOME/.endev/source" "\\$HOME/.endev" "."; do
    [ -e "\\$base" ] || continue
    find "\\$base" -maxdepth 16 -type f \\( -name '.mcp.json' -o -path '*/.vscode/mcp.json' \\) -print 2>/dev/null
  done | while IFS= read -r file; do
    if has_funbird_mcp "\\$file"; then
      printf '%s\\n' "\\$file"
      break
    fi
  done
)"
if [ -n "\\$found_mcp" ]; then
  print_mcp_json "\\$found_mcp"
  exit 0
fi
printf 'ERROR=Could not locate EnDev generated MCP config containing ${ENDEV_XDPU_MCP_SERVER_NAME}. Run endev doctor in the WSL workspace.\\n'
exit 22
`;
}

function parseMcpConfigReadOutput(stdout: string): { mcpConfigPath: string; json: string } {
    const pathMatch = stdout.match(/^MCP=(.+)$/m);
    const jsonMatch = stdout.match(/(?:^|\n)JSON_BEGIN\r?\n([\s\S]*?)\r?\nJSON_END(?:\r?\n|$)/);
    if (!pathMatch || !jsonMatch) {
        const errorLine = stdout.split(/\r?\n/)
            .find(line => line.startsWith('ERROR='))
            ?.slice('ERROR='.length)
            ?.trim();
        throw new EnDevXDpuSetupError(
            errorLine || `Could not read EnDev generated MCP config containing ${ENDEV_XDPU_MCP_SERVER_NAME}.`,
            'ENDEV_XDPU_MCP_CONFIG_NOT_FOUND',
            { stdout: truncateOutput(stdout) },
        );
    }

    return {
        mcpConfigPath: normalizeLinuxPath(pathMatch[1].trim()),
        json: jsonMatch[1].trim(),
    };
}

function extractMcpServerMap(parsed: unknown): Record<string, unknown> {
    if (!isRecord(parsed)) {
        throw new EnDevXDpuSetupError(
            'EnDev generated MCP config must be a JSON object.',
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }

    const candidate = parsed.mcpServers ?? parsed.servers;
    if (!isRecord(candidate)) {
        throw new EnDevXDpuSetupError(
            'EnDev generated MCP config must contain an `mcpServers` or `servers` object.',
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }

    return candidate;
}

function getFunbirdMcpServer(parsed: unknown): MCPServerConfig {
    const servers = extractMcpServerMap(parsed);
    const entry = Object.entries(servers).find(([name]) =>
        name.toLowerCase() === ENDEV_XDPU_MCP_SERVER_NAME.toLowerCase());
    if (!entry) {
        throw new EnDevXDpuSetupError(
            `EnDev generated MCP config does not contain ${ENDEV_XDPU_MCP_SERVER_NAME}. Run \`endev doctor\` in the WSL workspace.`,
            'ENDEV_XDPU_MCP_SERVER_NOT_FOUND',
        );
    }

    const config = entry[1];
    if (!isRecord(config)) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config must be an object.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }
    if (config.enabled === false) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} is disabled in EnDev generated MCP config.`,
            'ENDEV_XDPU_MCP_SERVER_DISABLED',
        );
    }
    if (typeof config.command !== 'string' || config.command.trim().length === 0) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config must define a command to bridge through WSL.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }
    if (config.type !== undefined && config.type !== 'local' && config.type !== 'stdio') {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config must be a local or stdio server.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }
    if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string'))) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config args must be an array of strings.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }
    if (config.env !== undefined && (!isRecord(config.env) || Object.values(config.env).some(value => typeof value !== 'string'))) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config env must be an object with string values.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }
    if (config.cwd !== undefined && typeof config.cwd !== 'string') {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config cwd must be a string.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }
    if (config.tools !== undefined && (!Array.isArray(config.tools) || config.tools.some(tool => typeof tool !== 'string'))) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config tools must be an array of strings.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }
    if (config.timeout !== undefined && typeof config.timeout !== 'number') {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config timeout must be a number.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }

    return {
        ...(config.type ? { type: config.type } : {}),
        command: config.command,
        ...(Array.isArray(config.args) ? { args: [...config.args] } : {}),
        ...(isRecord(config.env) ? { env: Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, String(value)])) } : {}),
        ...(typeof config.cwd === 'string' ? { cwd: config.cwd } : {}),
        ...(Array.isArray(config.tools) ? { tools: [...config.tools] } : {}),
        ...(typeof config.timeout === 'number' ? { timeout: config.timeout } : {}),
        ...(typeof config.enabled === 'boolean' ? { enabled: config.enabled } : {}),
    };
}

function validateEnvName(name: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} MCP server config contains invalid environment variable name: ${name}`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }
}

function buildLinuxMcpArgv(config: MCPServerConfig): string[] {
    if (!('command' in config)) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} must be a local MCP server to bridge through WSL.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }

    const command = config.command.trim();
    const args = config.args ?? [];
    const envEntries = Object.entries(config.env ?? {});
    if (!config.cwd && envEntries.length === 0) {
        return [command, ...args];
    }

    const envPrefix = envEntries.map(([name, value]) => {
        validateEnvName(name);
        return `${name}=${shellQuote(String(value))}`;
    }).join(' ');
    const execCommand = `exec ${[command, ...args].map(shellQuote).join(' ')}`;
    const cwdPrefix = config.cwd ? `cd ${shellQuote(config.cwd)} && ` : '';
    const shellCommand = `${cwdPrefix}${envPrefix ? `${envPrefix} ` : ''}${execCommand}`;
    return ['sh', '-lc', shellCommand];
}

function bridgeMcpServerThroughWsl(
    config: MCPServerConfig,
    distro: string,
    xstoreRepoRoot: string,
): MCPServerConfig {
    if (!('command' in config)) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} must be a local MCP server to bridge through WSL.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }

    const context: WslExecutionContext = {
        kind: 'wsl',
        distro,
        linuxWorkingDirectory: xstoreRepoRoot,
        originalWorkingDirectory: xstoreRepoRoot,
    };

    return {
        tools: config.tools ?? ['*'],
        ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
        ...(config.enabled !== undefined ? { enabled: config.enabled } : {}),
        type: config.type === 'local' ? 'local' : 'stdio',
        command: getWslExecutablePath(),
        args: buildWslCommandArgs(context, buildLinuxMcpArgv(config)),
    };
}

function nativeMcpServerConfig(
    config: MCPServerConfig,
    xstoreRepoRoot: string,
): MCPServerConfig {
    if (!('command' in config)) {
        throw new EnDevXDpuSetupError(
            `${ENDEV_XDPU_MCP_SERVER_NAME} must be a local MCP server to run in native WSL.`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }

    return {
        tools: config.tools ?? ['*'],
        ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
        ...(config.enabled !== undefined ? { enabled: config.enabled } : {}),
        type: config.type === 'local' ? 'local' : 'stdio',
        command: config.command.trim(),
        ...(config.args !== undefined ? { args: [...config.args] } : {}),
        ...(config.env !== undefined ? { env: { ...config.env } } : {}),
        cwd: config.cwd ?? xstoreRepoRoot,
    };
}

function resolveMcpServerForHost(
    config: MCPServerConfig,
    activation: EnDevXDpuActivationConfig,
): MCPServerConfig {
    if (activation.hostMode === 'native-linux') {
        return nativeMcpServerConfig(config, activation.xstoreRepoRoot);
    }
    return bridgeMcpServerThroughWsl(config, activation.distro, activation.xstoreRepoRoot);
}

function wrapperSkillContent(): string {
    return `---
name: ${ENDEV_XDPU_WRAPPER_SKILL_NAME}
description: Use workspace-local EnDev xDPU skills and WSL MCP from CoC without nested EnDev Copilot sessions.
---

# ${ENDEV_XDPU_WRAPPER_SKILL_NAME}

Use this skill when working on xDPU/xStore tasks in a WSL workspace with EnDev enabled through CoC.

- Prefer the EnDev plugin skills exposed in this workspace, especially \`dpu-log-triage\`, \`dpu-log-fetch\`, and \`hbm-dump-triage\`.
- Do not run nested \`endev copilot\`; CoC owns the chat/workflow session and routes EnDev capabilities through workspace skills and MCP.
- Run shell commands through the WSL workspace context. \`endev doctor\` is the setup validation command when EnDev tools appear unavailable.
- For HBM dump analysis, use \`hbm-dump-triage\` with the \`funbird-mcp\` tools when the user has network access and credentials. Windows-hosted CoC bridges WSL MCP through \`wsl.exe\`; native WSL CoC uses local stdio MCP directly.

## Manual HBM smoke validation

Use this path only when the user explicitly asks to smoke-test HBM dump analysis and confirms internal network access and credentials are available.

1. Start from the enabled WSL xStore workspace and run \`endev doctor\`; if it fails, surface the setup error and stop.
2. Ask \`hbm-dump-triage\` to analyze sanity job ${ENDEV_XDPU_HBM_SMOKE_SANITY_JOB_ID} sample \`${ENDEV_XDPU_HBM_SMOKE_SAMPLE}\` through the \`funbird-mcp\` tools.
3. Treat download or access failures as environment prerequisites, not CoC failures. Do not run this path in CI, unit tests, or automated workflow validation.
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
    const activation = resolveActivationConfig(workspace);
    const commandRunner = getRunner(activation.hostMode, runner);

    const doctor = await runRequiredWslCommand(
        commandRunner,
        {
            distro: activation.distro,
            linuxWorkingDirectory: activation.xstoreRepoRoot,
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
            distro: activation.distro,
            linuxWorkingDirectory: activation.xstoreRepoRoot,
            command: buildDiscoveryScript(activation.xstoreRepoRoot),
            timeoutMs: WSL_COMMAND_TIMEOUT_MS,
        },
        'EnDev plugin discovery',
        'ENDEV_XDPU_DISCOVERY_FAILED',
        'Run `endev doctor` in the WSL workspace and ensure the EnDev plugin is installed.',
    );
    const { pluginSkillFolder, mcpConfigPath } = parseDiscoveryOutput(discovery.stdout);
    const extraSkillFolder = activation.hostMode === 'windows-wsl'
        ? linuxPathToWslUncPath(activation.distro, pluginSkillFolder)
        : pluginSkillFolder;
    const wrapperSkillPath = installWrapperSkill(dataDir);
    const extraSkillFolders = addExtraSkillFolder(workspace.extraSkillFolders, extraSkillFolder);
    const updated = await store.updateWorkspace(workspace.id, {
        extraSkillFolders,
        endevXDpu: {
            enabled: true,
            ...(activation.distro ? { wslDistro: activation.distro } : {}),
            xstoreRepoRoot: activation.xstoreRepoRoot,
            mcpConfigPath,
        },
    });

    return {
        workspace: updated ?? { ...workspace, extraSkillFolders },
        ...(activation.distro ? { wslDistro: activation.distro } : {}),
        xstoreRepoRoot: activation.xstoreRepoRoot,
        pluginSkillFolder,
        extraSkillFolder,
        mcpConfigPath,
        wrapperSkillPath,
        doctorOutput: truncateOutput(`${doctor.stdout}\n${doctor.stderr}`),
    };
}

export async function resolveEnDevXDpuMcpServers(
    workspace: WorkspaceInfo,
    runner?: EnDevXDpuWslCommandRunner,
): Promise<Record<string, MCPServerConfig> | undefined> {
    if (workspace.endevXDpu?.enabled !== true) {
        return undefined;
    }

    const activation = resolveActivationConfig(workspace);
    const commandRunner = getRunner(activation.hostMode, runner);
    const configRead = await runRequiredWslCommand(
        commandRunner,
        {
            distro: activation.distro,
            linuxWorkingDirectory: activation.xstoreRepoRoot,
            command: buildMcpConfigReadScript(workspace.endevXDpu.mcpConfigPath),
            timeoutMs: WSL_COMMAND_TIMEOUT_MS,
        },
        'EnDev MCP config discovery',
        'ENDEV_XDPU_MCP_CONFIG_NOT_FOUND',
        'Run `endev doctor` in the WSL workspace and ensure EnDev generated MCP config is available.',
    );
    const { json } = parseMcpConfigReadOutput(configRead.stdout);

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        throw new EnDevXDpuSetupError(
            `Failed to parse EnDev generated MCP config: ${error instanceof Error ? error.message : String(error)}`,
            'ENDEV_XDPU_MCP_CONFIG_INVALID',
        );
    }

    const funbirdConfig = getFunbirdMcpServer(parsed);
    return {
        [ENDEV_XDPU_MCP_SERVER_NAME]: resolveMcpServerForHost(funbirdConfig, activation),
    };
}
