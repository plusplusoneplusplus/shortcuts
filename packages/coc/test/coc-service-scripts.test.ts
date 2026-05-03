import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..', '..');
const scriptsRoot = resolve(repoRoot, 'scripts');

const readScript = (name: string) => readFileSync(resolve(scriptsRoot, name), 'utf-8');

describe('CoC service PowerShell scripts', () => {
  const serveLoop = readScript('coc-serve-loop.ps1');
  const configDevTunnel = readScript('config-devtunnel.ps1');
  const manager = readScript('Manage-CoCService.ps1');

  describe('config-devtunnel.ps1', () => {
    it('owns devtunnel installation and stable tunnel id configuration', () => {
      expect(configDevTunnel).toMatch(/\[string\]\$TunnelId = "\$\(\$env:COMPUTERNAME\.ToLower\(\)\)-coc"/);
      expect(configDevTunnel).toContain('function Install-DevTunnelCli');
      expect(configDevTunnel).toContain('function Invoke-EnsureTunnel');
    });

    it('installs devtunnel with winget first and falls back to the documented download URL', () => {
      expect(configDevTunnel).toContain('winget install Microsoft.devtunnel');
      expect(configDevTunnel).toContain('https://aka.ms/TunnelsCliDownload/win-x64');
      expect(configDevTunnel).toContain(".coc\\bin");
      expect(configDevTunnel).toContain('$env:PATH = "$localBin;$env:PATH"');
    });

    it('creates the tunnel and HTTP port idempotently while surfacing auth failures', () => {
      expect(configDevTunnel).toContain("@('create', $TunnelId)");
      expect(configDevTunnel).toContain("@('port', 'create', $TunnelId, '-p', \"$Port\", '--protocol', 'http')");
      expect(configDevTunnel).toContain('function Test-DevTunnelAlreadyConfigured');
      expect(configDevTunnel).toMatch(/already exists\|conflict with existing entity/);
      expect(configDevTunnel).toContain('-not (Test-DevTunnelAlreadyConfigured $create.Output)');
      expect(configDevTunnel).toContain('-not (Test-DevTunnelAlreadyConfigured $portCreate.Output)');
      expect(configDevTunnel).toMatch(/not logged in\|not authenticated\|login required\|log in\|401\|unauthorized/);
      expect(configDevTunnel).toContain("devtunnel user login");
    });

    it('does not host the dev tunnel', () => {
      expect(configDevTunnel).not.toContain("@('host', $TunnelId)");
      expect(configDevTunnel).not.toContain('Start-Process devtunnel');
    });
  });

  describe('coc-serve-loop.ps1 dev tunnel host support', () => {
    it('exposes a Tunnel switch and stable computer-name based tunnel id', () => {
      expect(serveLoop).toMatch(/\[switch\]\$Tunnel/);
      expect(serveLoop).toContain('$tunnelId = "$($env:COMPUTERNAME.ToLower())-coc"');
    });

    it('does not install or configure devtunnel from the server loop', () => {
      expect(serveLoop).not.toContain('function Install-DevTunnelCli');
      expect(serveLoop).not.toContain('function Invoke-EnsureTunnel');
      expect(serveLoop).not.toContain('winget install Microsoft.devtunnel');
      expect(serveLoop).not.toContain("@('port', 'create', $TunnelId");
      expect(serveLoop).toContain('Run .\\scripts\\config-devtunnel.ps1');
    });

    it('hosts devtunnel as a subprocess and parses the public URL from output', () => {
      expect(serveLoop).toContain('function Start-DevTunnel');
      expect(serveLoop).toContain("Start-Process $devTunnelCommand -ArgumentList @('host', $TunnelId)");
      expect(serveLoop).toContain("https://[^\\s]+devtunnels\\.ms[^\\s,]*");
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
    it('documents and exposes the Tunnel switch', () => {
      expect(manager).toMatch(/\.PARAMETER Tunnel/);
      expect(manager).toContain('.\\scripts\\Manage-CoCService.ps1 install -Tunnel');
      expect(manager).toMatch(/\[switch\]\$Tunnel/);
    });

    it('preserves the Tunnel flag when relaunching elevated and when registering the loop task', () => {
      expect(manager).toContain("if ($Tunnel) { $argParts += '-Tunnel' }");
      expect(manager).toContain("if ($Tunnel) { $loopArgs += ' -Tunnel' }");
    });

    it('includes hosted devtunnel processes in service stop cleanup', () => {
      expect(manager).toContain("devtunnel host .*-coc");
    });
  });
});
