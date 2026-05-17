import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { normalizeExecutionPath, resolvePathForHostFilesystem } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';

export const ENDEV_XDPU_SKILL_NAME = 'EnDev-xDpu';
export const ENDEV_STATUS_CACHE_FILE = path.join('endev', 'eligibility.json');

const DEFAULT_DOCTOR_TIMEOUT_MS = 3000;
const MAX_CAPTURED_OUTPUT_CHARS = 4096;

const ENDEV_SETUP_MARKERS = [
    '.endev',
    '.endev.yaml',
    '.endev.yml',
    '.endev.json',
    'endev.yaml',
    'endev.yml',
    'endev.json',
] as const;

const XDPU_WORKSPACE_MARKERS = [
    '.xdpu',
    'xdpu',
    'xdpu.yaml',
    'xdpu.yml',
    'xdpudev.json',
    'funos',
    'FunOS',
] as const;

const ENDEV_PLUGIN_SKILL_FOLDER_CANDIDATES = [
    path.join('.endev', 'copilot', 'skills'),
    path.join('.endev', 'plugins', 'copilot', 'skills'),
    path.join('.endev', 'skills'),
    path.join('endev', 'copilot', 'skills'),
    path.join('endev', 'skills'),
] as const;

export type EnDevEligibilityReason =
    | 'eligible'
    | 'not-native-wsl'
    | 'not-xdpu-workspace'
    | 'missing-setup-files'
    | 'doctor-failed';

export interface EnDevDoctorResult {
    ok: boolean;
    timedOut?: boolean;
    exitCode?: number | string;
    signal?: string;
    error?: string;
    stdout?: string;
    stderr?: string;
}

export interface EnDevEligibilityStatus {
    workspaceId: string;
    workspaceRoot: string;
    eligible: boolean;
    reason: EnDevEligibilityReason;
    nativeWsl: boolean;
    xDpuWorkspace: boolean;
    hasSetupFiles: boolean;
    setupFiles: string[];
    doctor?: EnDevDoctorResult;
    pluginSkillFolder?: string;
    checkedAt: string;
    cached: boolean;
}

export interface EnDevDetectionOptions {
    forceRefresh?: boolean;
    doctorTimeoutMs?: number;
    isNativeWsl?: boolean;
    doctorRunner?: (cwd: string, timeoutMs: number) => Promise<EnDevDoctorResult>;
}

export function isNativeWslEnvironment(): boolean {
    if (process.platform !== 'linux') {
        return false;
    }
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
        return true;
    }
    try {
        const version = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
        return version.includes('microsoft') || version.includes('wsl');
    } catch {
        return false;
    }
}

function truncateOutput(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    return value.length > MAX_CAPTURED_OUTPUT_CHARS
        ? value.slice(0, MAX_CAPTURED_OUTPUT_CHARS)
        : value;
}

async function runEnDevDoctor(cwd: string, timeoutMs: number): Promise<EnDevDoctorResult> {
    return new Promise(resolve => {
        execFile(
            'endev',
            ['doctor'],
            {
                cwd,
                timeout: timeoutMs,
                windowsHide: true,
                maxBuffer: MAX_CAPTURED_OUTPUT_CHARS * 2,
            },
            (error, stdout, stderr) => {
                if (!error) {
                    resolve({
                        ok: true,
                        stdout: truncateOutput(stdout),
                        stderr: truncateOutput(stderr),
                    });
                    return;
                }

                const execError = error as NodeJS.ErrnoException & {
                    code?: number | string;
                    signal?: NodeJS.Signals | string;
                    killed?: boolean;
                };
                resolve({
                    ok: false,
                    timedOut: execError.killed === true && execError.signal === 'SIGTERM',
                    exitCode: execError.code,
                    signal: typeof execError.signal === 'string' ? execError.signal : undefined,
                    error: execError.message,
                    stdout: truncateOutput(stdout),
                    stderr: truncateOutput(stderr),
                });
            },
        );
    });
}

function safeExists(filePath: string): boolean {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

function findExistingRelativePaths(rootPath: string, markers: readonly string[]): string[] {
    const found: string[] = [];
    for (const marker of markers) {
        if (safeExists(path.join(rootPath, marker))) {
            found.push(marker);
        }
    }
    return found;
}

function isXdpUWorkspace(workspace: WorkspaceInfo, hostRootPath: string): boolean {
    const identity = [
        workspace.name,
        workspace.rootPath,
        workspace.remoteUrl,
        path.basename(hostRootPath),
    ].filter(Boolean).join(' ').toLowerCase();

    if (/(^|[^a-z0-9])x-?dpu([^a-z0-9]|$)/i.test(identity)) {
        return true;
    }

    return findExistingRelativePaths(hostRootPath, XDPU_WORKSPACE_MARKERS).length > 0;
}

function findPluginSkillFolder(rootPath: string): string | undefined {
    for (const candidate of ENDEV_PLUGIN_SKILL_FOLDER_CANDIDATES) {
        const candidatePath = path.join(rootPath, candidate);
        if (safeExists(candidatePath)) {
            return candidatePath;
        }
    }
    return undefined;
}

function readCachedStatus(cachePath: string): EnDevEligibilityStatus | undefined {
    try {
        if (!fs.existsSync(cachePath)) {
            return undefined;
        }
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Partial<EnDevEligibilityStatus>;
        if (
            typeof parsed.workspaceId === 'string'
            && typeof parsed.workspaceRoot === 'string'
            && typeof parsed.eligible === 'boolean'
            && typeof parsed.reason === 'string'
            && typeof parsed.checkedAt === 'string'
        ) {
            return {
                workspaceId: parsed.workspaceId,
                workspaceRoot: parsed.workspaceRoot,
                eligible: parsed.eligible,
                reason: parsed.reason as EnDevEligibilityReason,
                nativeWsl: parsed.nativeWsl === true,
                xDpuWorkspace: parsed.xDpuWorkspace === true,
                hasSetupFiles: parsed.hasSetupFiles === true,
                setupFiles: Array.isArray(parsed.setupFiles)
                    ? parsed.setupFiles.filter((entry): entry is string => typeof entry === 'string')
                    : [],
                doctor: parsed.doctor,
                pluginSkillFolder: typeof parsed.pluginSkillFolder === 'string' ? parsed.pluginSkillFolder : undefined,
                checkedAt: parsed.checkedAt,
                cached: true,
            };
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function writeCachedStatus(cachePath: string, status: EnDevEligibilityStatus): void {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ ...status, cached: false }, null, 2), 'utf-8');
    fs.renameSync(tmpPath, cachePath);
}

export async function detectEnDevEligibility(
    dataDir: string,
    workspace: WorkspaceInfo,
    options: EnDevDetectionOptions = {},
): Promise<EnDevEligibilityStatus> {
    const cachePath = getRepoDataPath(dataDir, workspace.id, ENDEV_STATUS_CACHE_FILE);
    if (!options.forceRefresh) {
        const cached = readCachedStatus(cachePath);
        if (cached) {
            return cached;
        }
    }

    const checkedAt = new Date().toISOString();
    const hostRootPath = resolvePathForHostFilesystem(workspace.rootPath);
    const nativeWsl = options.isNativeWsl ?? isNativeWslEnvironment();
    const setupFiles = findExistingRelativePaths(hostRootPath, ENDEV_SETUP_MARKERS);
    const xDpuWorkspace = isXdpUWorkspace(workspace, hostRootPath);
    const base = {
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
        nativeWsl,
        xDpuWorkspace,
        hasSetupFiles: setupFiles.length > 0,
        setupFiles,
        checkedAt,
        cached: false,
    };

    let status: EnDevEligibilityStatus;
    if (!nativeWsl) {
        status = { ...base, eligible: false, reason: 'not-native-wsl' };
    } else if (!xDpuWorkspace) {
        status = { ...base, eligible: false, reason: 'not-xdpu-workspace' };
    } else if (setupFiles.length === 0) {
        status = { ...base, eligible: false, reason: 'missing-setup-files' };
    } else {
        const timeoutMs = options.doctorTimeoutMs ?? DEFAULT_DOCTOR_TIMEOUT_MS;
        const doctor = await (options.doctorRunner ?? runEnDevDoctor)(hostRootPath, timeoutMs);
        status = doctor.ok
            ? {
                ...base,
                eligible: true,
                reason: 'eligible',
                doctor,
                pluginSkillFolder: findPluginSkillFolder(hostRootPath),
            }
            : {
                ...base,
                eligible: false,
                reason: 'doctor-failed',
                doctor,
            };
    }

    writeCachedStatus(cachePath, status);
    return status;
}

export async function getEffectiveEnDevExtraSkillFolders(
    dataDir: string | undefined,
    workspace: WorkspaceInfo,
    options: EnDevDetectionOptions = {},
): Promise<string[]> {
    const folders = [...(workspace.extraSkillFolders ?? [])];
    if (!dataDir) {
        return folders;
    }

    const status = await detectEnDevEligibility(dataDir, workspace, options);
    if (!status.eligible || !status.pluginSkillFolder) {
        return folders;
    }

    const normalized = new Set(folders.map(folder => normalizeExecutionPath(folder)));
    if (!normalized.has(normalizeExecutionPath(status.pluginSkillFolder))) {
        folders.push(status.pluginSkillFolder);
    }
    return folders;
}

export async function isEnDevWrapperSkillVisible(
    dataDir: string | undefined,
    workspace: WorkspaceInfo,
    options: EnDevDetectionOptions = {},
): Promise<boolean> {
    if (!dataDir) {
        return false;
    }
    const status = await detectEnDevEligibility(dataDir, workspace, options);
    return status.eligible;
}

