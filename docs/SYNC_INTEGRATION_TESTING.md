# Sync Integration Testing Guide

This guide explains how to test the cloud sync functionality with real VSCode integration and how to switch between providers.

## Overview

The sync integration tests (`src/test/suite/sync-integration.test.ts`) test the actual behavior of switching between sync providers using a real VSCode extension context.

## Running Integration Tests

### Run All Tests
```bash
npm test
```

### Run Only Sync Integration Tests
```bash
npm test -- --grep "Sync Integration"
```

### Run Specific Test Suites
```bash
# Provider switching tests
npm test -- --grep "Provider Switching"

# Sync operations tests
npm test -- --grep "Sync Operations with Provider Switching"

# Error handling tests
npm test -- --grep "Error Handling"
```

## Test Structure

### Test Categories

1. **Provider Switching Tests**
   - Initialize with no sync configuration
   - Configure VSCode sync provider
   - Switch from VSCode to Azure provider
   - Enable both providers simultaneously
   - Disable sync completely
   - Switch between global and workspace scope

2. **Sync Operations Tests**
   - Sync to cloud after provider switch
   - Get sync status for active providers
   - Handle auto-sync setting toggle

3. **Error Handling Tests**
   - Handle missing sync configuration gracefully
   - Handle sync manager reinitialization

## Writing New Integration Tests

### Basic Test Template

```typescript
test('should do something with sync', async () => {
    // 1. Create configuration
    const config: ShortcutsConfig = {
        logicalGroups: [],
        sync: {
            enabled: true,
            autoSync: true,
            providers: {
                vscodeSync: {
                    enabled: true,
                    scope: 'global'
                }
            }
        }
    };

    // 2. Save and initialize
    await configManager.saveConfiguration(config);
    await configManager.initializeSyncManager();

    // 3. Get sync manager
    const syncManager = configManager.getSyncManager();

    // 4. Perform assertions
    assert.ok(syncManager, 'Sync manager should exist');
    assert.strictEqual(syncManager.isEnabled(), true, 'Sync should be enabled');
});
```

### Provider Switching Template

```typescript
test('should switch providers', async () => {
    // Start with Provider A
    let config: ShortcutsConfig = {
        logicalGroups: [],
        sync: {
            enabled: true,
            autoSync: true,
            providers: {
                vscodeSync: {
                    enabled: true,
                    scope: 'global'
                }
            }
        }
    };

    await configManager.saveConfiguration(config);
    await configManager.initializeSyncManager();

    // Verify Provider A
    let syncManager = configManager.getSyncManager();
    assert.ok(syncManager?.getProviders().has('vscode'), 'Should have VSCode provider');

    // Switch to Provider B
    config.sync.providers = {
        azure: {
            enabled: true,
            container: 'test-container',
            accountName: 'testaccount'
        }
    };

    await configManager.saveConfiguration(config);
    await configManager.initializeSyncManager();

    // Verify Provider B
    syncManager = configManager.getSyncManager();
    assert.ok(syncManager?.getProviders().has('azure'), 'Should have Azure provider');
    assert.ok(!syncManager?.getProviders().has('vscode'), 'Should not have VSCode provider');
});
```

## Testing Provider Configurations

### VSCode Settings Sync

**Global Scope:**
```typescript
providers: {
    vscodeSync: {
        enabled: true,
        scope: 'global'
    }
}
```

**Workspace Scope:**
```typescript
providers: {
    vscodeSync: {
        enabled: true,
        scope: 'workspace'
    }
}
```

### Azure Blob Storage

```typescript
providers: {
    azure: {
        enabled: true,
        container: 'test-container',
        accountName: 'testaccount'
    }
}
```

### Multiple Providers

```typescript
providers: {
    vscodeSync: {
        enabled: true,
        scope: 'global'
    },
    azure: {
        enabled: true,
        container: 'test-container',
        accountName: 'testaccount'
    }
}
```

## Manual Testing in VSCode

### Setup

1. **Open Extension Development Host:**
   - Press `F5` in VSCode to launch Extension Development Host
   - Or use Run > Start Debugging

2. **Open Test Workspace:**
   - Create a new folder or open existing workspace
   - The extension will activate automatically

### Test Scenarios

#### Scenario 1: Configure VSCode Sync

1. Open Command Palette (`Cmd+Shift+P`)
2. Run: `Shortcuts: Configure Cloud Sync`
3. Select `VSCode Settings Sync`
4. Choose scope (Global or Workspace)
5. Enable when prompted
6. Verify toolbar shows sync buttons

#### Scenario 2: Switch to Azure

1. Open `.vscode/shortcuts.yaml`
2. Modify sync configuration:
   ```yaml
   sync:
     enabled: true
     autoSync: true
     providers:
       azure:
         enabled: true
         container: my-container
         accountName: myaccount
   ```
3. Save the file
4. Extension should reinitialize with Azure provider

#### Scenario 3: Enable Both Providers

1. Configure both providers in YAML:
   ```yaml
   sync:
     enabled: true
     autoSync: true
     providers:
       vscodeSync:
         enabled: true
         scope: global
       azure:
         enabled: true
         container: my-container
         accountName: myaccount
   ```
2. Save and observe both providers active
3. Run `Shortcuts: Show Sync Status` to verify

#### Scenario 4: Test Manual Sync

1. Ensure sync is configured
2. Make changes to shortcuts configuration
3. Run `Shortcuts: Sync Now`
4. Observe progress notification
5. Check console for sync results

#### Scenario 5: Disable Sync

1. Run `Shortcuts: Disable Cloud Sync`
2. Verify sync buttons disappear from toolbar
3. Make changes - they should not auto-sync
4. Re-enable with `Shortcuts: Enable Cloud Sync`

## Debugging Integration Tests

### Enable Verbose Logging

Add console.log statements in tests:

```typescript
test('should switch providers', async () => {
    console.log('Starting provider switch test...');
    
    // ... test code ...
    
    console.log('Provider switch completed');
});
```

### Inspect Test Workspace

The integration tests create a temporary workspace in:
```
/tmp/shortcuts-sync-test-{timestamp}/
```

You can inspect this directory during test execution to see the actual configuration files created.

### Debug Test in VSCode

1. Set breakpoints in your test file
2. Open Debug panel
3. Select "Extension Tests" configuration
4. Press F5 to start debugging
5. Breakpoints will be hit during test execution

### View Test Output

Test output appears in:
- VSCode Debug Console
- Terminal where `npm test` was run
- Test Explorer panel (if using VSCode Testing extensions)

## Common Issues and Solutions

### Issue: "Extension not found"

**Solution:** Make sure the extension is properly installed:
```bash
npm run compile
npm run package
```

### Issue: Sync operations fail in tests

**Solution:** This is expected behavior in test environment with mock context. The tests verify configuration and provider setup, not actual cloud operations.

Wrap cloud operations in try-catch:
```typescript
try {
    await configManager.syncToCloud();
} catch (error) {
    console.log('Sync failed (expected in test):', error);
}
```

### Issue: Test timeout

**Solution:** Increase timeout for slow operations:
```typescript
suite('My Suite', function() {
    this.timeout(30000); // 30 seconds
    
    test('slow test', async () => {
        // ...
    });
});
```

### Issue: Cleanup fails

**Solution:** Ensure proper cleanup in teardown:
```typescript
teardown(async function() {
    const syncManager = configManager.getSyncManager();
    if (syncManager) {
        syncManager.dispose();
    }
});
```

## Best Practices

1. **Always Clean Up:** Dispose sync managers and delete test files in teardown
2. **Use Temporary Directories:** Never modify actual workspace files
3. **Mock External Services:** Don't make real API calls to cloud providers in tests
4. **Test Edge Cases:** Include tests for error conditions and invalid configurations
5. **Verify State Changes:** Always assert before and after state when switching providers
6. **Isolate Tests:** Each test should be independent and not rely on previous test state
7. **Use Descriptive Names:** Test names should clearly describe what they're testing
8. **Add Console Logs:** Help debug failing tests with strategic logging

## CI/CD Integration

### GitHub Actions

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '16'
      - run: npm install
      - run: npm test
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test-results/
```

### Running Tests Headlessly

For CI environments, tests run in headless mode automatically. To run locally in headless mode:

```bash
npm test -- --headless
```

## Additional Resources

- [VSCode Extension Testing Guide](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Mocha Testing Framework](https://mochajs.org/)
- [VSCode Extension API](https://code.visualstudio.com/api/references/vscode-api)

## Example: Complete Integration Test

```typescript
test('complete provider lifecycle', async function() {
    this.timeout(10000);
    
    console.log('1. Starting with no sync...');
    let config = await configManager.loadConfiguration();
    assert.strictEqual(config.sync, undefined);
    
    console.log('2. Enabling VSCode sync...');
    config.sync = {
        enabled: true,
        autoSync: true,
        providers: {
            vscodeSync: { enabled: true, scope: 'global' }
        }
    };
    await configManager.saveConfiguration(config);
    await configManager.initializeSyncManager();
    
    let syncManager = configManager.getSyncManager();
    assert.ok(syncManager?.getProviders().has('vscode'));
    
    console.log('3. Adding Azure provider...');
    config.sync.providers.azure = {
        enabled: true,
        container: 'test',
        accountName: 'test'
    };
    await configManager.saveConfiguration(config);
    await configManager.initializeSyncManager();
    
    syncManager = configManager.getSyncManager();
    assert.strictEqual(syncManager?.getProviders().size, 2);
    
    console.log('4. Removing VSCode provider...');
    delete config.sync.providers.vscodeSync;
    await configManager.saveConfiguration(config);
    await configManager.initializeSyncManager();
    
    syncManager = configManager.getSyncManager();
    assert.strictEqual(syncManager?.getProviders().size, 1);
    assert.ok(syncManager?.getProviders().has('azure'));
    
    console.log('5. Disabling sync...');
    config.sync.enabled = false;
    await configManager.saveConfiguration(config);
    await configManager.initializeSyncManager();
    
    syncManager = configManager.getSyncManager();
    assert.strictEqual(syncManager?.isEnabled(), false);
    
    console.log('✅ Complete lifecycle test passed');
});
```

This test demonstrates a complete lifecycle: no sync → VSCode → both providers → Azure only → disabled.

