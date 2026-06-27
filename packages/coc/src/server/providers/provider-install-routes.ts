/**
 * Provider SDK Install Routes
 *
 * POST /api/providers/sdk/:provider/install
 *   Triggers npm install of the optional SDK package for the given provider.
 *   Returns 202 Accepted immediately; status can be polled via the GET endpoint.
 *   Allowed providers: 'codex' | 'claude'
 *
 * GET /api/providers/sdk/:provider/install-status
 *   Returns the current install status for the given provider.
 *   Response: { status: 'not-installed' | 'installing' | 'installed' | 'install-failed', error?: string }
 *
 * After a successful install the provider's SDK service is re-registered in the
 * module-level `sdkServiceRegistry` so it becomes usable without a full server restart.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import { createRequire } from 'module';
import type { Route } from '../types';
import { sendJson, send400, send404, send500 } from '../shared/router';
import { registerCodexSDKService, registerClaudeSDKService, registerOpenCodeSDKService } from '@plusplusoneplusplus/forge';

// ============================================================================
// Provider → package name mapping
// ============================================================================

const PROVIDER_PACKAGES: Record<string, string> = {
    codex: '@openai/codex-sdk',
    claude: '@anthropic-ai/claude-agent-sdk',
    opencode: '@opencode-ai/sdk',
};

const PROVIDER_INSTALL_PROBES: Record<string, string[]> = {
    // @openai/codex-sdk is ESM import-only, so require.resolve('@openai/codex-sdk')
    // reports ERR_PACKAGE_PATH_NOT_EXPORTED even when installed. Its bundled CLI
    // dependency is required for quota/model RPCs and exposes a resolvable bin.
    codex: ['@openai/codex/bin/codex.js', '@openai/codex/package.json'],
    claude: ['@anthropic-ai/claude-agent-sdk'],
    opencode: ['@opencode-ai/sdk'],
};

// ============================================================================
// Install status store (in-memory, per server lifetime)
// ============================================================================

export type ProviderInstallStatus = 'not-installed' | 'installing' | 'installed' | 'install-failed';

export interface ProviderInstallState {
    status: ProviderInstallStatus;
    /** Human-readable error message when status === 'install-failed'. */
    error?: string;
    /** ISO timestamp when the last install was started. */
    startedAt?: string;
    /** ISO timestamp when the last install completed (success or failure). */
    completedAt?: string;
}

// Shared across all route registrations in a process so callers see consistent state.
const installStates = new Map<string, ProviderInstallState>();

/** Exported for use in tests and other handlers that need to read install state. */
export function getInstallState(provider: string): ProviderInstallState {
    return installStates.get(provider) ?? { status: 'not-installed' };
}

/** Returns explicit install state, falling back to runtime package detection. */
export function getResolvedInstallState(provider: string): ProviderInstallState {
    const memState = installStates.get(provider);
    if (memState?.status === 'installing' || memState?.status === 'install-failed') {
        return memState;
    }
    if (memState?.status === 'installed') {
        return { status: 'installed' };
    }

    return { status: isPackageInstalled(provider) ? 'installed' : 'not-installed' };
}

/** Clears the in-memory install state. Used by tests only. */
export function clearInstallStates(): void {
    installStates.clear();
}

// ============================================================================
// Package detection helper
// ============================================================================

const runtimeRequire = createRequire(__filename);

/** Returns true when the provider's runtime package can be resolved in the current environment. */
function isPackageInstalled(provider: string): boolean {
    const pkg = PROVIDER_PACKAGES[provider];
    if (!pkg || !packageJsonExists(pkg)) return false;

    for (const specifier of PROVIDER_INSTALL_PROBES[provider] ?? [PROVIDER_PACKAGES[provider]!]) {
        try {
            runtimeRequire.resolve(specifier);
            return true;
        } catch {
            // Try the next probe for packages with multiple valid layouts.
        }
    }
    return false;
}

function packageJsonExists(pkg: string): boolean {
    const packageParts = pkg.split('/');
    for (const baseDir of runtimeRequire.resolve.paths(pkg) ?? []) {
        if (fs.existsSync(path.join(baseDir, ...packageParts, 'package.json'))) {
            return true;
        }
    }
    return false;
}

// ============================================================================
// Post-install provider re-registration
// ============================================================================

/**
 * Re-registers the provider's SDK service in the live registry so it can be
 * used without a full server restart.
 */
function reRegisterProvider(provider: string): void {
    if (provider === 'codex') {
        registerCodexSDKService();
    } else if (provider === 'claude') {
        registerClaudeSDKService();
    } else if (provider === 'opencode') {
        registerOpenCodeSDKService();
    }
}

// ============================================================================
// Install runner
// ============================================================================

/**
 * Runs `npm install <pkg>` in the given directory and updates the in-memory
 * status. On success, re-registers the provider in the SDK service registry.
 */
function runInstall(
    provider: string,
    pkg: string,
    installDir: string,
): void {
    installStates.set(provider, {
        status: 'installing',
        startedAt: new Date().toISOString(),
    });

    // Use 'npm' on the PATH; on Windows 'npm' resolves to npm.cmd via PATH lookup.
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';

    const child = childProcess.spawn(npmCmd, ['install', pkg], {
        cwd: installDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (err) => {
        installStates.set(provider, {
            status: 'install-failed',
            error: `Failed to start npm: ${err.message}`,
            startedAt: installStates.get(provider)?.startedAt,
            completedAt: new Date().toISOString(),
        });
    });

    child.on('close', (code) => {
        if (code === 0) {
            installStates.set(provider, {
                status: 'installed',
                startedAt: installStates.get(provider)?.startedAt,
                completedAt: new Date().toISOString(),
            });
            // Re-register the provider so the running server picks it up live.
            try {
                reRegisterProvider(provider);
            } catch {
                // Re-registration failure is non-fatal; the install itself succeeded.
            }
        } else {
            const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
            installStates.set(provider, {
                status: 'install-failed',
                error: stderr || `npm install exited with code ${code}`,
                startedAt: installStates.get(provider)?.startedAt,
                completedAt: new Date().toISOString(),
            });
        }
    });
}

// ============================================================================
// Route context
// ============================================================================

export interface ProviderInstallRouteContext {
    /**
     * The directory where `npm install <pkg>` should be run so that the
     * installed package lands in the same `node_modules` tree as coc itself.
     * Typically the root directory of the `@plusplusoneplusplus/coc` package.
     */
    cocInstallDir: string;
}

// ============================================================================
// Route registration
// ============================================================================

/**
 * Registers the provider SDK install endpoints on the shared route table.
 *
 * @param routes  - Shared route table (mutated in place)
 * @param ctx     - Runtime dependencies (install dir)
 */
export function registerProviderInstallRoutes(routes: Route[], ctx: ProviderInstallRouteContext): void {

    // -- GET /api/providers/sdk/:provider/install-status -------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/providers\/sdk\/([^/]+)\/install-status$/,
        handler: (_req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!PROVIDER_PACKAGES[provider]) {
                send404(res, `Unknown provider: ${provider}. Known providers: ${Object.keys(PROVIDER_PACKAGES).join(', ')}`);
                return;
            }

            sendJson(res, getResolvedInstallState(provider));
        },
    });

    // -- POST /api/providers/sdk/:provider/install -------------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/providers\/sdk\/([^/]+)\/install$/,
        handler: (_req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!PROVIDER_PACKAGES[provider]) {
                send400(res, `Unknown provider: ${provider}. Known providers: ${Object.keys(PROVIDER_PACKAGES).join(', ')}`);
                return;
            }

            const pkg = PROVIDER_PACKAGES[provider]!;

            // Validate that the install directory exists.
            const installDir = ctx.cocInstallDir;
            try {
                const stat = fs.statSync(installDir);
                if (!stat.isDirectory()) {
                    send500(res, `cocInstallDir is not a directory: ${installDir}`);
                    return;
                }
            } catch {
                send500(res, `cocInstallDir does not exist: ${installDir}`);
                return;
            }

            // If already installed, return 200 to be idempotent.
            if (isPackageInstalled(provider)) {
                installStates.set(provider, { status: 'installed' });
                try {
                    reRegisterProvider(provider);
                } catch {
                    // Re-registration failure is non-fatal; the package is present.
                }
                sendJson(res, { status: 'installed', message: `${pkg} is already installed` });
                return;
            }

            // If an install is already running, return 409.
            const current = installStates.get(provider);
            if (current?.status === 'installing') {
                sendJson(res, { status: 'installing', message: 'Install already in progress' }, 409);
                return;
            }

            // Start the install asynchronously; respond 202 immediately.
            runInstall(provider, pkg, installDir);
            sendJson(res, {
                status: 'installing',
                message: `Installing ${pkg} in ${path.basename(installDir)}`,
            }, 202);
        },
    });
}
