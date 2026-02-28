# Cloud Configuration Sync

**Category:** Configuration & Persistence

## Overview

The Cloud Configuration Sync component synchronizes the shortcuts YAML configuration across multiple devices using VS Code's built-in Settings Sync infrastructure. It consists of a `SyncManager` orchestrator that coordinates across pluggable `ISyncProvider` implementations, a `VSCodeSyncProvider` that persists config into VS Code `globalState`/`workspaceState` (which is then transparently propagated by VS Code's own sync), and a `CloudSyncProvider` abstract base class providing retry logic and authentication error detection for future remote-storage backends.

---

## Architecture

```
┌─────────────────────────────────────┐
│        Configuration Manager        │
│   (triggers sync on config changes) │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│            SyncManager              │
│  • orchestrates all providers       │
│  • last-write-wins conflict res.    │
│  • debounce (2 s) + periodic poll   │
│  • per-device ID tracking           │
└────────────────┬────────────────────┘
                 │ ISyncProvider
       ┌─────────┴──────────┐
       ▼                    ▼
┌─────────────┐    ┌───────────────────────┐
│ VSCodeSync  │    │ CloudSyncProvider      │
│ Provider    │    │ (abstract base)        │
│ • globalState│   │ • exponential backoff  │
│ • workspace │    │ • auth error detect    │
│   State     │    │ • checksum util        │
└──────┬──────┘    └───────────────────────┘
       │
       ▼
VS Code Settings Sync Service
(Microsoft / GitHub account)
```

**Source files:**

| File | Role |
|---|---|
| `src/shortcuts/sync/sync-manager.ts` | Orchestrator – upload / download / debounce / periodic sync |
| `src/shortcuts/sync/sync-provider.ts` | `ISyncProvider` interface + `SyncResult`, `SyncedConfig`, `SyncStatus` types |
| `src/shortcuts/sync/vscode-sync-provider.ts` | VS Code Memento-backed provider |
| `src/shortcuts/sync/cloud-sync-provider.ts` | Abstract base class with retry & auth helpers |
| `src/shortcuts/sync/AGENTS.md` | Developer reference |

---

## Key Concepts

### SyncedConfig envelope

Every payload written to storage is wrapped in a `SyncedConfig` envelope:

```typescript
interface SyncedConfig {
    config: ShortcutsConfig;   // the actual YAML-parsed configuration
    metadata: {
        lastModified: number;  // Unix ms – drives last-write-wins
        deviceId: string;      // "<hostname>-<random>" – set once per device
        version: number;       // CURRENT_CONFIG_VERSION constant
    };
}
```

### Conflict resolution

`SyncManager.syncFromCloud()` downloads from **all** providers in parallel then picks the entry with the **largest `lastModified` timestamp** (last-write-wins). The winning provider name and timestamp are logged for auditing.

### Debounced auto-sync

`scheduleSyncToCloud()` resets a 2-second debounce timer on every call, so rapid consecutive config edits produce only one upload per burst.

### Periodic update check

When `syncConfig.syncInterval > 0`, `SyncManager` starts a `setInterval` loop that calls `checkForUpdates()`. Stale-detection is timestamp-only; the actual download is left to the caller (typically `ConfigurationManager`) so it can decide whether to prompt the user.

### Device identity

Both `SyncManager` and `VSCodeSyncProvider` independently call `getOrCreateDeviceId()`, which stores a `"<hostname>-<randomPart>"` string in `context.globalState` under the key `workspaceShortcuts.deviceId`. The same value is stamped into every `SyncedConfig.metadata` written by that device.

---

## Configuration

### VS Code settings

```json
{
  "workspaceShortcuts.sync.enabled": true,
  "workspaceShortcuts.sync.autoSync": true,
  "workspaceShortcuts.sync.syncInterval": 300,
  "workspaceShortcuts.sync.provider": "vscode",
  "workspaceShortcuts.sync.vscode.scope": "global"
}
```

### shortcuts.yaml

```yaml
sync:
  enabled: true
  autoSync: true
  syncInterval: 300       # seconds between update checks (0 = disabled)
  providers:
    vscodeSync:
      enabled: true
      scope: global       # 'global' syncs across all workspaces; 'workspace' is local
```

---

## SyncStatus enum

```
NotConfigured  – provider not yet initialized
Ready          – last operation succeeded
Syncing        – operation in progress
Error          – last operation failed (lastError field is populated)
AuthRequired   – upload/download rejected with 401/403-class error
```

---

## ISyncProvider interface

Any custom backend must implement:

```typescript
interface ISyncProvider {
    getName(): string;
    isConfigured(): Promise<boolean>;
    getStatus(): Promise<SyncStatus>;
    initialize(): Promise<boolean>;
    upload(config: SyncedConfig): Promise<SyncResult>;
    download(): Promise<SyncResult & { config?: SyncedConfig }>;
    getLastModified(): Promise<number | undefined>;
    delete(): Promise<boolean>;
    dispose(): void;
}
```

### Extending CloudSyncProvider

`CloudSyncProvider` wraps the interface with automatic retry (3 attempts, 1 s → 2 s → 4 s exponential backoff), status transitions, and an `isAuthError()` heuristic that short-circuits retries on 401/403 responses. Subclasses implement four protected methods:

```typescript
protected abstract uploadImpl(config: SyncedConfig): Promise<SyncResult>;
protected abstract downloadImpl(): Promise<SyncResult & { config?: SyncedConfig }>;
protected abstract initializeImpl(): Promise<boolean>;
protected abstract disposeImpl(): void;
```

---

## Usage examples

### Basic setup (inside ConfigurationManager)

```typescript
const syncManager = new SyncManager(context, syncConfig);
await syncManager.initialize();

// Trigger upload whenever the config is saved
configManager.onDidChangeConfig(config => {
    if (syncManager.isAutoSyncEnabled()) {
        syncManager.scheduleSyncToCloud(config);  // debounced
    }
});

// Pull latest on startup
const { config, source } = await syncManager.syncFromCloud();
if (config) await configManager.applyConfig(config);
```

### Manual sync command

```typescript
vscode.commands.registerCommand('shortcuts.sync.now', async () => {
    const results = await syncManager.syncToCloud(configManager.getConfig());
    const failed = [...results.values()].filter(r => !r.success);
    if (failed.length === 0) {
        vscode.window.showInformationMessage('Sync completed successfully.');
    } else {
        vscode.window.showErrorMessage(`Sync failed: ${failed[0].error}`);
    }
});
```

### Checking for remote updates

```typescript
const { hasUpdates, source, timestamp } = await syncManager.checkForUpdates();
if (hasUpdates) {
    const action = await vscode.window.showInformationMessage(
        `New config available from ${source}`, 'Apply'
    );
    if (action === 'Apply') {
        const { config } = await syncManager.syncFromCloud();
        if (config) await configManager.applyConfig(config);
    }
}
```

### Implementing a custom provider

```typescript
import { CloudSyncProvider, SyncedConfig, SyncResult } from '../sync';

class S3SyncProvider extends CloudSyncProvider {
    getName() { return 'Amazon S3'; }
    async isConfigured() { return !!this.bucket; }

    protected async initializeImpl() {
        this.client = new S3Client({ region: this.region });
        return true;
    }

    protected async uploadImpl(config: SyncedConfig): Promise<SyncResult> {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: 'shortcuts-config.json',
            Body: JSON.stringify(config),
        }));
        return { success: true, timestamp: config.metadata.lastModified };
    }

    protected async downloadImpl() {
        const obj = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket, Key: 'shortcuts-config.json',
        }));
        const config: SyncedConfig = JSON.parse(await streamToString(obj.Body));
        return { success: true, config };
    }

    async getLastModified() { /* read S3 object metadata */ }
    async delete() { /* delete S3 object */ return true; }
    protected disposeImpl() { /* close client */ }
}
```

---

## Commands

| Command | Description |
|---|---|
| `shortcuts.sync.configure` | Interactive sync provider configuration wizard |
| `shortcuts.sync.enable` | Enable cloud synchronization |
| `shortcuts.sync.disable` | Disable cloud synchronization |
| `shortcuts.sync.now` | Manually trigger immediate sync |
| `shortcuts.sync.status` | Show per-provider sync status |

---

## Testing

Integration tests live in `src/test/suite/sync-integration.test.ts`. They create a temporary workspace, inject a `MockMemento` context, and exercise the full `ConfigurationManager ↔ SyncManager ↔ VSCodeSyncProvider` stack without network I/O.

---

## Limitations and design notes

- **VS Code Settings Sync dependency** – `VSCodeSyncProvider` works only when the user has VS Code Settings Sync configured. The extension never enables or disables VS Code sync itself.
- **No merge strategy** – conflict resolution is strictly last-write-wins. Manual merging is not supported in the current version.
- **Single active provider** – the current `SyncConfig` schema only exposes `vscodeSync`; the multi-provider parallel-upload path in `SyncManager` is forward-compatible with additional backends.
- **Periodic sync is check-only** – `checkForUpdates()` detects a newer remote timestamp but does **not** automatically download; the caller decides whether to apply.
