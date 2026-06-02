import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..', '..');
const scriptsRoot = resolve(repoRoot, 'scripts');

const readScript = (name: string) => readFileSync(resolve(scriptsRoot, name), 'utf-8');
const readScriptBytes = (name: string) => readFileSync(resolve(scriptsRoot, name));
const hasUtf8Bom = (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
const hasNonAsciiText = (bytes: Buffer) =>
  [...bytes.toString('utf-8').replace(/^\uFEFF/, '')].some((char) => (char.codePointAt(0) ?? 0) > 0x7f);

const findPowerShell = () => {
  for (const command of ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    if (!result.error && result.status === 0) {
      return command;
    }
  }
  return null;
};

const powerShellCommand = findPowerShell();
const describePowerShell = powerShellCommand ? describe : describe.skip;

const hasBash = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf-8', stdio: 'pipe' }).status === 0;
const describeBash = process.platform !== 'win32' && hasBash ? describe : describe.skip;

const runBashFile = (scriptName: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync('bash', [resolve(scriptsRoot, scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout: 20_000,
  });

const runPowerShellFile = (scriptName: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  if (!powerShellCommand) {
    throw new Error('PowerShell is not available');
  }

  return spawnSync(
    powerShellCommand,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve(scriptsRoot, scriptName), ...args],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      timeout: 20_000,
    }
  );
};

const createFakeDevTunnel = (mode: 'none' | 'one' | 'multi' | 'host-wrong-first') => {
  const dir = mkdtempSync(join(tmpdir(), 'coc-devtunnel-test-'));
  const logPath = join(dir, 'devtunnel.log');
  const cocLogPath = join(dir, 'coc.log');
  const fakeJsPath = join(dir, 'fake-devtunnel.js');
  const fakeCocJsPath = join(dir, 'fake-coc.js');

  writeFileSync(
    fakeJsPath,
    `
const fs = require('fs');
const args = process.argv.slice(2);
const logPath = process.env.FAKE_DEVTUNNEL_LOG;
if (logPath) {
  fs.appendFileSync(logPath, args.join('\\t') + '\\n');
}
const mode = process.env.FAKE_DEVTUNNEL_MODE || 'none';
if (args[0] === 'create') {
  process.exit(0);
}
if (args[0] === 'port' && args[1] === 'list') {
  if (mode === 'one') {
    console.log('Port Number  Protocol');
    console.log('51234        http');
  } else if (mode === 'host-wrong-first') {
    console.log('Port Number  Protocol');
    console.log('53910        http');
  } else if (mode === 'multi') {
    console.log('Port Number  Protocol');
    console.log('4000         http');
    console.log('51234        http');
  } else {
    console.log('No ports found');
  }
  process.exit(0);
}
if (args[0] === 'port' && args[1] === 'create') {
  process.exit(0);
}
if (args[0] === 'host') {
  if (mode === 'host-wrong-first') {
    console.log('Connect via https://fake.devtunnels.ms:4000');
    console.log('Connect via https://fake.devtunnels.ms:53910');
  } else {
    console.log('Connect via https://fake.devtunnels.ms');
  }
  setInterval(() => {}, 60000);
} else {
  console.error('unexpected devtunnel args: ' + args.join(' '));
  process.exit(3);
}
`,
    'utf-8'
  );

  writeFileSync(join(dir, 'devtunnel.cmd'), '@echo off\r\nnode "%~dp0fake-devtunnel.js" %*\r\n', 'utf-8');
  writeFileSync(
    join(dir, 'devtunnel'),
    '#!/bin/sh\nSCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nnode "$SCRIPT_DIR/fake-devtunnel.js" "$@"\n',
    'utf-8'
  );
  chmodSync(join(dir, 'devtunnel'), 0o755);

  writeFileSync(
    fakeCocJsPath,
    `
const fs = require('fs');
const args = process.argv.slice(2);
const logPath = process.env.FAKE_COC_LOG;
if (logPath) {
  fs.appendFileSync(logPath, args.join('\\t') + '\\n');
}
process.exit(Number(process.env.FAKE_COC_EXIT_CODE || 0));
`,
    'utf-8'
  );
  writeFileSync(join(dir, 'coc.cmd'), '@echo off\r\nnode "%~dp0fake-coc.js" %*\r\n', 'utf-8');
  writeFileSync(
    join(dir, 'coc'),
    '#!/bin/sh\nSCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nnode "$SCRIPT_DIR/fake-coc.js" "$@"\n',
    'utf-8'
  );
  chmodSync(join(dir, 'coc'), 0o755);

  return {
    logPath,
    cocLogPath,
    env: {
      PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_DEVTUNNEL_LOG: logPath,
      FAKE_DEVTUNNEL_MODE: mode,
      FAKE_COC_LOG: cocLogPath,
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

const readDevTunnelLog = (logPath: string) =>
  readFileSync(logPath, 'utf-8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

const readLogLines = (logPath: string) =>
  existsSync(logPath)
    ? readFileSync(logPath, 'utf-8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
    : [];

describe('CoC service PowerShell scripts', () => {
  const serveLoop = readScript('coc-serve-loop.ps1');
  const configDevTunnel = readScript('config-devtunnel.ps1');
  const devTunnelUtils = readScript('devtunnel-utils.ps1');
  const manager = readScript('Manage-CoCService.ps1');

  describe('config-devtunnel.ps1', () => {
    it('owns persistent tunnel id to HTTP port binding', () => {
      expect(configDevTunnel).toMatch(/\[Nullable\[int\]\]\$Port = \$null/);
      expect(configDevTunnel).toMatch(/\[string\]\$TunnelId = "\$\(\$env:COMPUTERNAME\.ToLower\(\)\)-coc"/);
      expect(configDevTunnel).toContain('function Install-DevTunnelCli');
      expect(configDevTunnel).toContain('function Invoke-EnsureTunnel');
      expect(configDevTunnel).toContain("'port', 'list', $TunnelId");
      expect(configDevTunnel).toContain('Get-RandomFreePort');
      expect(configDevTunnel).toContain("'port', 'create', $TunnelId, '-p', \"$resolvedPort\", '--protocol', 'http'");
    });

    it('installs devtunnel with winget first and falls back to the documented download URL', () => {
      expect(configDevTunnel).toContain('winget install Microsoft.devtunnel');
      expect(configDevTunnel).toContain('https://aka.ms/TunnelsCliDownload/win-x64');
      expect(configDevTunnel).toContain(".coc\\bin");
      expect(configDevTunnel).toContain('$env:PATH = "$localBin;$env:PATH"');
    });

    it('reuses exactly one HTTP port and rejects ambiguous tunnel port bindings', () => {
      expect(configDevTunnel).toContain('$existingHttpPorts = @(Get-HttpDevTunnelPorts -Output $portList.Output)');
      expect(configDevTunnel).toContain('$existingHttpPorts.Count -eq 1');
      expect(configDevTunnel).toContain('$existingHttpPorts.Count -gt 1');
      expect(configDevTunnel).toContain('already has HTTP port');
      expect(configDevTunnel).toContain('has multiple HTTP ports');
    });

    it('does not host the dev tunnel', () => {
      expect(configDevTunnel).not.toContain("@('host', $TunnelId)");
      expect(configDevTunnel).not.toContain('Start-Process devtunnel');
    });
  });

  describe('devtunnel-utils.ps1', () => {
    it('parses JSON, table, and key-value style HTTP port output', () => {
      expect(devTunnelUtils).toContain('ConvertFrom-Json');
      expect(devTunnelUtils).toContain("Get-DevTunnelObjectPropertyValue -Object $item -Names @('protocol', 'protocols')");
      expect(devTunnelUtils).toContain("Get-DevTunnelObjectPropertyValue -Object $item -Names @('portNumber', 'port', 'port_number', 'number')");
      expect(devTunnelUtils).toContain("foreach ($line in ($Output -split '\\r?\\n'))");
      expect(devTunnelUtils).toContain("if ($text -match '(?i)\\bhttp\\b')");
      expect(devTunnelUtils).toContain('Select-Object -Unique');
    });
  });

  describe('coc-serve-loop.ps1 dev tunnel host support', () => {
    it('uses TunnelId as the only tunnel-mode selector', () => {
      expect(serveLoop).toMatch(/\[string\]\$TunnelId = ''/);
      expect(serveLoop).not.toMatch(/\[switch\]\$Tunnel/);
      expect(serveLoop).toContain('$tunnelEnabled = -not [string]::IsNullOrWhiteSpace($TunnelId)');
    });

    it('rejects explicit Port when TunnelId is provided', () => {
      expect(serveLoop).toContain("$portWasProvided = $PSBoundParameters.ContainsKey('Port')");
      expect(serveLoop).toContain(
        '-Port cannot be used with -TunnelId. Configure the tunnel port with config-devtunnel.ps1, then start the loop with only -TunnelId.'
      );
    });

    it('reads exactly one configured HTTP port before building in tunnel mode', () => {
      expect(serveLoop).toContain('function Resolve-ConfiguredDevTunnelPort');
      expect(serveLoop).toContain("'port', 'list', $TunnelId");
      expect(serveLoop).toContain('$httpPorts.Count -eq 0');
      expect(serveLoop).toContain('$httpPorts.Count -gt 1');
      expect(serveLoop.indexOf('Resolve-ConfiguredDevTunnelPort -TunnelId $TunnelId')).toBeLessThan(
        serveLoop.indexOf('while ($true)')
      );
      expect(serveLoop).not.toContain("'port', 'create', $TunnelId");
    });

    it('hosts devtunnel as a subprocess and parses the public URL from output', () => {
      expect(serveLoop).toContain('function Start-DevTunnel');
      expect(serveLoop).toContain('function Select-DevTunnelUrl');
      expect(serveLoop).toContain('function Test-DevTunnelUrlMatchesPort');
      expect(serveLoop).toContain("Start-Process $devTunnelCommand -ArgumentList @('host', $TunnelId)");
      expect(serveLoop).toContain('Start-DevTunnel -TunnelId $TunnelId -Port $Port');
      expect(serveLoop).toContain("https://[^\\s,]+devtunnels\\.ms[^\\s,]*");
      expect(serveLoop).toContain('Dev tunnel URL:');
    });

    it('can launch a devtunnel CLI installed by the config script fallback', () => {
      expect(serveLoop).toContain("Join-Path $env:USERPROFILE '.coc\\bin\\devtunnel.exe'");
      expect(serveLoop).toContain('if (Test-Path $localExe) { return $localExe }');
    });

    it('stops the devtunnel process tree after every serve iteration', () => {
      expect(serveLoop).toContain('function Stop-ProcessTree');
      expect(serveLoop).toContain('Where-Object { $_.ParentProcessId -eq $ProcessId }');
      expect(serveLoop).toContain('Stop-DevTunnel -TunnelSession $tunnelSession');
      expect(serveLoop).toContain('} finally {');
      expect(serveLoop.indexOf('Stop-DevTunnel -TunnelSession $tunnelSession')).toBeLessThan(
        serveLoop.indexOf('Restart requested (exit code $RESTART_EXIT_CODE)')
      );
    });
  });

  describe('Manage-CoCService.ps1 tunnel forwarding', () => {
    it('documents and exposes TunnelId without passing Port in tunnel mode', () => {
      expect(manager).toMatch(/\.PARAMETER TunnelId/);
      expect(manager).toContain('.\\scripts\\Manage-CoCService.ps1 install -TunnelId my-remote-coc');
      expect(manager).toMatch(/\[string\]\$TunnelId = ''/);
      expect(manager).not.toMatch(/\[switch\]\$Tunnel/);
      expect(manager).toContain('$loopArgs += " -TunnelId `"$TunnelId`""');
    });

    it('preserves TunnelId when relaunching elevated and rejects explicit Port with TunnelId', () => {
      expect(manager).toContain('-Port cannot be used with -TunnelId. Configure the tunnel port with config-devtunnel.ps1');
      expect(manager).toContain('$argParts += @(\'-TunnelId\', "`"$TunnelId`"")');
      expect(manager).toContain('$argParts += @(\'-Port\', $Port)');
    });

    it('includes hosted devtunnel processes in service stop cleanup', () => {
      expect(manager).toContain('devtunnel host .*-coc');
    });
  });
});

describe('PowerShell script encoding', () => {
  it('uses a UTF-8 BOM for scripts containing non-ASCII text', () => {
    const scriptsMissingBom = readdirSync(scriptsRoot)
      .filter((name) => name.endsWith('.ps1'))
      .filter((name) => {
        const bytes = readScriptBytes(name);
        return hasNonAsciiText(bytes) && !hasUtf8Bom(bytes);
      });

    expect(scriptsMissingBom).toEqual([]);
  });
});

describePowerShell('CoC service PowerShell script behavior', () => {
  it('passes PowerShell parser checks', () => {
    const command = `
$errors = @()
foreach ($file in @('build-coc-publish.ps1','devtunnel-utils.ps1','config-devtunnel.ps1','coc-serve-loop.ps1','Manage-CoCService.ps1')) {
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path '${scriptsRoot.replace(/'/g, "''")}' $file), [ref]$null, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) {
    $errors += $parseErrors | ForEach-Object { "\${file}:$($_.Message)" }
  }
}
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}
`;

    const result = spawnSync(powerShellCommand!, ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 20_000,
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('configures an explicit HTTP port when the tunnel has no HTTP port', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runPowerShellFile('config-devtunnel.ps1', ['-TunnelId', 'my-remote-coc', '-Port', '51234'], fake.env);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("Dev tunnel 'my-remote-coc' is configured for HTTP port 51234.");

      const log = readDevTunnelLog(fake.logPath);
      expect(log).toContain('create\tmy-remote-coc');
      expect(log).toContain('port\tlist\tmy-remote-coc');
      expect(log).toContain('port\tcreate\tmy-remote-coc\t-p\t51234\t--protocol\thttp');
    } finally {
      fake.cleanup();
    }
  });

  it('generates a persistent HTTP port when no Port is provided', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runPowerShellFile('config-devtunnel.ps1', ['-TunnelId', 'generated-coc'], fake.env);
      expect(result.status, result.stderr || result.stdout).toBe(0);

      const portCreate = readDevTunnelLog(fake.logPath).find((line) => line.startsWith('port\tcreate\tgenerated-coc\t-p\t'));
      expect(portCreate).toBeTruthy();
      const createdPort = Number(portCreate!.split('\t')[4]);
      expect(createdPort).toBeGreaterThanOrEqual(1);
      expect(createdPort).toBeLessThanOrEqual(65535);
      expect(result.stdout).toContain(`Dev tunnel 'generated-coc' is configured for HTTP port ${createdPort}.`);
    } finally {
      fake.cleanup();
    }
  });

  it('reuses an existing single HTTP port instead of mutating tunnel ports', () => {
    const fake = createFakeDevTunnel('one');
    try {
      const result = runPowerShellFile('config-devtunnel.ps1', ['-TunnelId', 'existing-coc', '-Port', '4000'], fake.env);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("already has HTTP port 51234; reusing it instead of requested port 4000");
      expect(result.stdout).toContain("Dev tunnel 'existing-coc' is configured for HTTP port 51234.");
      expect(readDevTunnelLog(fake.logPath)).not.toContain('port\tcreate\texisting-coc\t-p\t4000\t--protocol\thttp');
    } finally {
      fake.cleanup();
    }
  });

  it('fails configuration when multiple HTTP ports exist', () => {
    const fake = createFakeDevTunnel('multi');
    try {
      const result = runPowerShellFile('config-devtunnel.ps1', ['-TunnelId', 'ambiguous-coc'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(2);
      expect(output).toContain("Dev tunnel 'ambiguous-coc' has multiple HTTP ports (4000, 51234).");
      expect(readDevTunnelLog(fake.logPath).some((line) => line.startsWith('port\tcreate\tambiguous-coc'))).toBe(false);
    } finally {
      fake.cleanup();
    }
  });

  it('rejects Port with TunnelId before building', () => {
    const result = runPowerShellFile('coc-serve-loop.ps1', ['-TunnelId', 'my-remote-coc', '-Port', '51234', '-SkipInitialBuild']);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status, output).toBe(2);
    expect(output).toContain(
      '-Port cannot be used with -TunnelId. Configure the tunnel port with config-devtunnel.ps1, then start the loop with only -TunnelId.'
    );
    expect(output).not.toContain('=== Installing dependencies ===');
  });

  it('fails tunnel mode with a clear error when no HTTP port is configured', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runPowerShellFile('coc-serve-loop.ps1', ['-TunnelId', 'missing-port-coc', '-SkipInitialBuild'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(2);
      expect(output).toContain("Dev tunnel 'missing-port-coc' has no configured HTTP port.");
      expect(output).not.toContain('=== Installing dependencies ===');

      const log = readDevTunnelLog(fake.logPath);
      expect(log).toContain('port\tlist\tmissing-port-coc');
      expect(log.some((line) => line.startsWith('host\tmissing-port-coc'))).toBe(false);
    } finally {
      fake.cleanup();
    }
  });

  it('starts non-tunnel mode on the default port', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runPowerShellFile('coc-serve-loop.ps1', ['-SkipInitialBuild'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain('=== Starting coc serve (host 127.0.0.1, port 4000) ===');
      expect(readLogLines(fake.cocLogPath)).toContain('serve\t--no-open\t--port\t4000\t--host\t127.0.0.1');
      expect(readLogLines(fake.logPath)).toEqual([]);
    } finally {
      fake.cleanup();
    }
  });

  it('starts non-tunnel mode on an explicit port', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runPowerShellFile('coc-serve-loop.ps1', ['-SkipInitialBuild', '-Port', '51235'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain('=== Starting coc serve (host 127.0.0.1, port 51235) ===');
      expect(readLogLines(fake.cocLogPath)).toContain('serve\t--no-open\t--port\t51235\t--host\t127.0.0.1');
      expect(readLogLines(fake.logPath)).toEqual([]);
    } finally {
      fake.cleanup();
    }
  });

  it.skipIf(process.platform !== 'win32')('starts tunnel mode on the configured HTTP port', () => {
    const fake = createFakeDevTunnel('one');
    try {
      const result = runPowerShellFile('coc-serve-loop.ps1', ['-TunnelId', 'existing-coc', '-SkipInitialBuild'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain("Using dev tunnel 'existing-coc' configured HTTP port 51234.");
      expect(output).toContain('Dev tunnel URL: https://fake.devtunnels.ms');
      expect(readLogLines(fake.cocLogPath)).toContain('serve\t--no-open\t--port\t51234\t--host\t127.0.0.1');
      expect(readDevTunnelLog(fake.logPath)).toEqual(['port\tlist\texisting-coc', 'host\texisting-coc']);
    } finally {
      fake.cleanup();
    }
  });

  it.skipIf(process.platform !== 'win32')('reports the dev tunnel URL for the configured HTTP port', () => {
    const fake = createFakeDevTunnel('host-wrong-first');
    try {
      const result = runPowerShellFile('coc-serve-loop.ps1', ['-TunnelId', 'existing-coc', '-SkipInitialBuild'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain("Using dev tunnel 'existing-coc' configured HTTP port 53910.");
      expect(output).toContain('=== Starting coc serve (host 127.0.0.1, port 53910) ===');
      expect(output).toContain('Dev tunnel URL: https://fake.devtunnels.ms:53910');
      expect(output).not.toContain('Dev tunnel URL: https://fake.devtunnels.ms:4000');
      expect(readLogLines(fake.cocLogPath)).toContain('serve\t--no-open\t--port\t53910\t--host\t127.0.0.1');
      expect(readDevTunnelLog(fake.logPath)).toEqual(['port\tlist\texisting-coc', 'host\texisting-coc']);
    } finally {
      fake.cleanup();
    }
  });
});

describe('CoC service bash scripts', () => {
  const serveLoopSh = readScript('coc-serve-loop.sh');
  const configDevTunnelSh = readScript('config-devtunnel.sh');
  const devTunnelUtilsSh = readScript('devtunnel-utils.sh');

  it('shares dev tunnel helpers via devtunnel-utils.sh', () => {
    expect(devTunnelUtilsSh).toContain('is_devtunnel_auth_error()');
    expect(devTunnelUtilsSh).toContain('get_http_devtunnel_ports()');
    expect(devTunnelUtilsSh).toContain('get_random_free_port()');
    for (const script of [serveLoopSh, configDevTunnelSh]) {
      expect(script).toContain('. "$SCRIPT_DIR/devtunnel-utils.sh"');
    }
  });

  it('config-devtunnel.sh owns the tunnel-id to HTTP port binding without hosting', () => {
    expect(configDevTunnelSh).toContain('port list "$TUNNEL_ID"');
    expect(configDevTunnelSh).toContain('port create "$TUNNEL_ID" -p "$resolved_port" --protocol http');
    expect(configDevTunnelSh).toContain('get_random_free_port');
    expect(configDevTunnelSh).not.toContain('host "$TUNNEL_ID"');
  });

  it('coc-serve-loop.sh uses --tunnel-id as the only tunnel selector and rejects --port with it', () => {
    expect(serveLoopSh).toContain('-t|--tunnel-id)');
    expect(serveLoopSh).toContain(
      '--port cannot be used with --tunnel-id. Configure the tunnel port with config-devtunnel.sh, then start the loop with only --tunnel-id.'
    );
    expect(serveLoopSh).toContain('resolve_configured_devtunnel_port');
    expect(serveLoopSh).toContain('start_devtunnel_host');
    expect(serveLoopSh).toContain('stop_devtunnel_host');
    expect(serveLoopSh).toContain('trap stop_devtunnel_host EXIT');
    expect(serveLoopSh).toContain("trap 'stop_devtunnel_host; exit 130' INT");
    expect(serveLoopSh).toContain("trap 'stop_devtunnel_host; exit 143' TERM");
  });

  it('coc-serve-loop.sh resolves the configured port before building and stops the host after serving', () => {
    expect(serveLoopSh.indexOf('resolve_configured_devtunnel_port "$TUNNEL_ID"')).toBeLessThan(
      serveLoopSh.indexOf('while true; do')
    );
    expect(serveLoopSh).toContain('port list "$id"');
    expect(serveLoopSh.indexOf('stop_devtunnel_host')).toBeGreaterThan(serveLoopSh.indexOf('coc serve --no-open'));
    expect(serveLoopSh).not.toContain('port create');
  });
});

describeBash('CoC service bash script behavior', () => {
  it('passes bash syntax checks', () => {
    for (const file of ['devtunnel-utils.sh', 'config-devtunnel.sh', 'coc-serve-loop.sh']) {
      const result = spawnSync('bash', ['-n', resolve(scriptsRoot, file)], { encoding: 'utf-8' });
      expect(result.status, `${file}: ${result.stderr}`).toBe(0);
    }
  });

  it('rejects --port with --tunnel-id before building', () => {
    const result = runBashFile('coc-serve-loop.sh', [
      '--tunnel-id',
      'my-remote-coc',
      '--port',
      '51234',
      '--skip-initial-build',
    ]);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status, output).toBe(2);
    expect(output).toContain(
      '--port cannot be used with --tunnel-id. Configure the tunnel port with config-devtunnel.sh, then start the loop with only --tunnel-id.'
    );
    expect(output).not.toContain('=== Installing dependencies ===');
  });

  it('fails tunnel mode with a clear error when no HTTP port is configured', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runBashFile('coc-serve-loop.sh', ['--tunnel-id', 'missing-port-coc', '--skip-initial-build'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(2);
      expect(output).toContain("Dev tunnel 'missing-port-coc' has no configured HTTP port.");
      expect(output).not.toContain('=== Installing dependencies ===');

      const log = readDevTunnelLog(fake.logPath);
      expect(log).toContain('port\tlist\tmissing-port-coc');
      expect(log.some((line) => line.startsWith('host\tmissing-port-coc'))).toBe(false);
    } finally {
      fake.cleanup();
    }
  });

  it('starts non-tunnel mode on the default port', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runBashFile('coc-serve-loop.sh', ['--skip-initial-build'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain('=== Starting coc serve (host 127.0.0.1, port 4000) ===');
      expect(readLogLines(fake.cocLogPath)).toContain('serve\t--no-open\t--port\t4000\t--host\t127.0.0.1');
      expect(readLogLines(fake.logPath)).toEqual([]);
    } finally {
      fake.cleanup();
    }
  });

  it('starts non-tunnel mode on an explicit port', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runBashFile('coc-serve-loop.sh', ['--skip-initial-build', '--port', '51235'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain('=== Starting coc serve (host 127.0.0.1, port 51235) ===');
      expect(readLogLines(fake.cocLogPath)).toContain('serve\t--no-open\t--port\t51235\t--host\t127.0.0.1');
      expect(readLogLines(fake.logPath)).toEqual([]);
    } finally {
      fake.cleanup();
    }
  });

  it('starts tunnel mode on the configured HTTP port and reports the URL', () => {
    const fake = createFakeDevTunnel('one');
    try {
      const result = runBashFile('coc-serve-loop.sh', ['--tunnel-id', 'existing-coc', '--skip-initial-build'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain("Using dev tunnel 'existing-coc' configured HTTP port 51234.");
      expect(output).toContain('Dev tunnel URL: https://fake.devtunnels.ms');
      expect(readLogLines(fake.cocLogPath)).toContain('serve\t--no-open\t--port\t51234\t--host\t127.0.0.1');
      expect(readDevTunnelLog(fake.logPath)).toEqual(['port\tlist\texisting-coc', 'host\texisting-coc']);
    } finally {
      fake.cleanup();
    }
  });

  it('selects the dev tunnel URL matching the configured HTTP port', () => {
    const fake = createFakeDevTunnel('host-wrong-first');
    try {
      const result = runBashFile('coc-serve-loop.sh', ['--tunnel-id', 'existing-coc', '--skip-initial-build'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain("Using dev tunnel 'existing-coc' configured HTTP port 53910.");
      expect(output).toContain('=== Starting coc serve (host 127.0.0.1, port 53910) ===');
      expect(output).toContain('Dev tunnel URL: https://fake.devtunnels.ms:53910');
      expect(output).not.toContain('Dev tunnel URL: https://fake.devtunnels.ms:4000');
      expect(readLogLines(fake.cocLogPath)).toContain('serve\t--no-open\t--port\t53910\t--host\t127.0.0.1');
      expect(readDevTunnelLog(fake.logPath)).toEqual(['port\tlist\texisting-coc', 'host\texisting-coc']);
    } finally {
      fake.cleanup();
    }
  });

  it('config-devtunnel.sh configures an explicit HTTP port when the tunnel has none', () => {
    const fake = createFakeDevTunnel('none');
    try {
      const result = runBashFile('config-devtunnel.sh', ['--tunnel-id', 'my-remote-coc', '--port', '51234'], fake.env);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("Dev tunnel 'my-remote-coc' is configured for HTTP port 51234.");

      const log = readDevTunnelLog(fake.logPath);
      expect(log).toContain('create\tmy-remote-coc');
      expect(log).toContain('port\tlist\tmy-remote-coc');
      expect(log).toContain('port\tcreate\tmy-remote-coc\t-p\t51234\t--protocol\thttp');
    } finally {
      fake.cleanup();
    }
  });

  it('config-devtunnel.sh reuses an existing single HTTP port', () => {
    const fake = createFakeDevTunnel('one');
    try {
      const result = runBashFile('config-devtunnel.sh', ['--tunnel-id', 'existing-coc', '--port', '4000'], fake.env);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain('already has HTTP port 51234; reusing it instead of requested port 4000');
      expect(result.stdout).toContain("Dev tunnel 'existing-coc' is configured for HTTP port 51234.");
      expect(readDevTunnelLog(fake.logPath)).not.toContain('port\tcreate\texisting-coc\t-p\t4000\t--protocol\thttp');
    } finally {
      fake.cleanup();
    }
  });

  it('config-devtunnel.sh fails when multiple HTTP ports exist', () => {
    const fake = createFakeDevTunnel('multi');
    try {
      const result = runBashFile('config-devtunnel.sh', ['--tunnel-id', 'ambiguous-coc'], fake.env);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status, output).toBe(2);
      expect(output).toContain("Dev tunnel 'ambiguous-coc' has multiple HTTP ports (4000 51234).");
      expect(readDevTunnelLog(fake.logPath).some((line) => line.startsWith('port\tcreate\tambiguous-coc'))).toBe(false);
    } finally {
      fake.cleanup();
    }
  });
});
