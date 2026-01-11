# Sync Module - Developer Reference

This module provides cloud synchronization capabilities for shortcuts configuration across devices. It uses VSCode Settings Sync as the backend provider.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Configuration Manager                        │
│            (Triggers sync on config changes)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Sync operations
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Sync Module                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   SyncManager                               ││
│  │  - Orchestrates sync across providers                       ││
│  │  - Handles conflicts (last-write-wins)                      ││
│  │  - Manages periodic sync                                    ││
│  │  - Debounces rapid changes                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   ISyncProvider                             ││
│  │  - Interface for sync providers                             ││
│  │  - upload(), download(), getStatus()                        ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                VSCodeSyncProvider                           ││
│  │  - Uses VSCode Settings Sync                                ││
│  │  - Global or workspace scope                                ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                CloudSyncProvider                            ││
│  │  - Generic cloud provider interface                         ││
│  │  - For future cloud backends                                ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Storage
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              VSCode Settings Sync Service                       │
│       (Synced via user's Microsoft/GitHub account)             │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### SyncManager

Orchestrates synchronization across all configured providers.

```typescript
import { SyncManager } from '../sync';

// Create and initialize
const syncManager = new SyncManager(context, syncConfig);
await syncManager.initialize();

// Check if sync is enabled
if (syncManager.isEnabled()) {
    // Sync to cloud
    const results = await syncManager.syncToCloud(config);
    
    for (const [provider, result] of results) {
        if (result.success) {
            console.log(`Synced to ${provider}`);
        } else {
            console.error(`Failed: ${result.error}`);
        }
    }
}

// Sync from cloud
const { config, source } = await syncManager.syncFromCloud();
if (config) {
    console.log(`Got config from ${source}`);
}

// Schedule debounced sync
syncManager.scheduleSyncToCloud(config);

// Get status
const status = await syncManager.getSyncStatus();

// Clean up
syncManager.dispose();
```

### VSCodeSyncProvider

Sync provider using VSCode's built-in Settings Sync.

```typescript
import { VSCodeSyncProvider } from '../sync';

// Create provider with scope
const provider = new VSCodeSyncProvider(context, 'global');
await provider.initialize();

// Upload config
const uploadResult = await provider.upload({
    config: shortcutsConfig,
    metadata: {
        lastModified: Date.now(),
        deviceId: 'device-123',
        version: 4
    }
});

// Download config
const downloadResult = await provider.download();
if (downloadResult.success && downloadResult.config) {
    const { config, metadata } = downloadResult.config;
    console.log(`Config from device ${metadata.deviceId}`);
}

// Get last modified timestamp
const timestamp = await provider.getLastModified();

// Get status
const status = await provider.getStatus();
```

### ISyncProvider Interface

Interface for implementing custom sync providers.

```typescript
import { ISyncProvider, SyncedConfig, SyncResult, SyncStatus } from '../sync';

class MyCloudProvider implements ISyncProvider {
    async initialize(): Promise<void> {
        // Set up connection
    }
    
    async upload(config: SyncedConfig): Promise<SyncResult> {
        // Upload to cloud
        return { success: true };
    }
    
    async download(): Promise<SyncResult> {
        // Download from cloud
        return { success: true, config: syncedConfig };
    }
    
    async getLastModified(): Promise<number | undefined> {
        // Return timestamp
        return Date.now();
    }
    
    async getStatus(): Promise<SyncStatus> {
        return {
            connected: true,
            lastSync: new Date(),
            error: undefined
        };
    }
    
    getName(): string {
        return 'My Cloud Provider';
    }
    
    dispose(): void {
        // Clean up
    }
}
```

## Configuration

Sync settings in VSCode:

```json
{
  "workspaceShortcuts.sync.enabled": true,
  "workspaceShortcuts.sync.autoSync": true,
  "workspaceShortcuts.sync.syncInterval": 300,
  "workspaceShortcuts.sync.provider": "vscode",
  "workspaceShortcuts.sync.vscode.scope": "global"
}
```

Sync configuration in `shortcuts.yaml`:

```yaml
sync:
  enabled: true
  autoSync: true
  syncInterval: 300  # seconds
  providers:
    vscodeSync:
      enabled: true
      scope: global  # or 'workspace'
```

## Usage Examples

### Example 1: Basic Sync Setup

```typescript
import { SyncManager } from '../sync';

async function setupSync(
    context: vscode.ExtensionContext,
    configManager: ConfigurationManager
) {
    const syncConfig = configManager.getSyncConfig();
    
    if (!syncConfig?.enabled) {
        return null;
    }
    
    const syncManager = new SyncManager(context, syncConfig);
    await syncManager.initialize();
    
    // Sync on config changes
    configManager.onDidChangeConfig(async (config) => {
        if (syncManager.isAutoSyncEnabled()) {
            syncManager.scheduleSyncToCloud(config);
        }
    });
    
    // Initial sync from cloud
    const { config } = await syncManager.syncFromCloud();
    if (config) {
        await configManager.applyConfig(config);
    }
    
    return syncManager;
}
```

### Example 2: Manual Sync Commands

```typescript
// Sync now command
vscode.commands.registerCommand('shortcuts.sync.now', async () => {
    const config = configManager.getConfig();
    const results = await syncManager.syncToCloud(config);
    
    const failures = Array.from(results.values()).filter(r => !r.success);
    if (failures.length === 0) {
        vscode.window.showInformationMessage('Sync completed successfully');
    } else {
        vscode.window.showErrorMessage(`Sync failed: ${failures[0].error}`);
    }
});

// Check for updates command
vscode.commands.registerCommand('shortcuts.sync.check', async () => {
    const { hasUpdates, source } = await syncManager.checkForUpdates();
    
    if (hasUpdates) {
        const action = await vscode.window.showInformationMessage(
            `Updates available from ${source}`,
            'Apply'
        );
        
        if (action === 'Apply') {
            const { config } = await syncManager.syncFromCloud();
            if (config) {
                await configManager.applyConfig(config);
            }
        }
    } else {
        vscode.window.showInformationMessage('Configuration is up to date');
    }
});
```

### Example 3: Implementing a Custom Provider

```typescript
import { ISyncProvider, SyncedConfig, SyncResult } from '../sync';

class FirebaseSyncProvider implements ISyncProvider {
    private db: Firestore;
    private userId: string;
    
    constructor(private readonly context: vscode.ExtensionContext) {}
    
    async initialize(): Promise<void> {
        // Initialize Firebase
        this.db = initializeFirestore(firebaseConfig);
        this.userId = await this.authenticate();
    }
    
    async upload(config: SyncedConfig): Promise<SyncResult> {
        try {
            const docRef = this.db.collection('shortcuts').doc(this.userId);
            await docRef.set({
                config: JSON.stringify(config.config),
                metadata: config.metadata
            });
            return { success: true };
        } catch (error) {
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }
    
    async download(): Promise<SyncResult> {
        try {
            const docRef = this.db.collection('shortcuts').doc(this.userId);
            const doc = await docRef.get();
            
            if (!doc.exists) {
                return { success: true }; // No config yet
            }
            
            const data = doc.data();
            return {
                success: true,
                config: {
                    config: JSON.parse(data.config),
                    metadata: data.metadata
                }
            };
        } catch (error) {
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }
    
    // ... other methods
}
```

### Example 4: Conflict Resolution

```typescript
async function resolveConflict(
    localConfig: ShortcutsConfig,
    localTimestamp: number,
    remoteConfig: ShortcutsConfig,
    remoteTimestamp: number
): Promise<ShortcutsConfig> {
    // Last-write-wins (default strategy)
    if (remoteTimestamp > localTimestamp) {
        return remoteConfig;
    }
    return localConfig;
    
    // Alternative: Ask user
    const choice = await vscode.window.showQuickPick([
        { label: 'Use Local', description: `Modified: ${new Date(localTimestamp)}` },
        { label: 'Use Remote', description: `Modified: ${new Date(remoteTimestamp)}` },
        { label: 'Merge', description: 'Combine both configurations' }
    ], { placeHolder: 'Configuration conflict detected' });
    
    switch (choice?.label) {
        case 'Use Local': return localConfig;
        case 'Use Remote': return remoteConfig;
        case 'Merge': return mergeConfigs(localConfig, remoteConfig);
        default: throw new Error('Conflict resolution cancelled');
    }
}
```

## Types

### SyncConfig

```typescript
interface SyncConfig {
    /** Whether sync is enabled */
    enabled: boolean;
    /** Auto-sync on changes */
    autoSync: boolean;
    /** Sync interval in seconds */
    syncInterval: number;
    /** Provider configurations */
    providers: {
        vscodeSync?: {
            enabled: boolean;
            scope: 'global' | 'workspace';
        };
    };
}
```

### SyncedConfig

```typescript
interface SyncedConfig {
    /** The shortcuts configuration */
    config: ShortcutsConfig;
    /** Sync metadata */
    metadata: {
        /** Last modification timestamp */
        lastModified: number;
        /** Device identifier */
        deviceId: string;
        /** Config version */
        version: number;
    };
}
```

### SyncResult

```typescript
interface SyncResult {
    /** Whether operation succeeded */
    success: boolean;
    /** Downloaded config (for download operations) */
    config?: SyncedConfig;
    /** Error message (if failed) */
    error?: string;
}
```

### SyncStatus

```typescript
interface SyncStatus {
    /** Whether provider is connected */
    connected: boolean;
    /** Last successful sync */
    lastSync?: Date;
    /** Last error */
    error?: string;
}
```

## Commands

| Command | Description |
|---------|-------------|
| `shortcuts.sync.enable` | Enable cloud synchronization |
| `shortcuts.sync.disable` | Disable cloud synchronization |
| `shortcuts.sync.now` | Manually trigger sync |
| `shortcuts.sync.status` | Show sync status |
| `shortcuts.sync.configure` | Open sync configuration wizard |

## Best Practices

1. **Debounce changes**: Use `scheduleSyncToCloud` to avoid rapid syncs.

2. **Handle conflicts**: Implement clear conflict resolution strategy.

3. **Device identification**: Use unique device IDs for tracking changes.

4. **Version compatibility**: Check config version before applying.

5. **Error handling**: Handle network failures gracefully.

6. **User feedback**: Show sync status and errors to users.

## See Also

- `src/shortcuts/configuration-manager.ts` - Configuration management
- `docs/SYNC_IMPLEMENTATION.md` - Implementation details
- `docs/SYNC_INTEGRATION_TESTING.md` - Testing documentation
