# Sync Integration Testing Guide

This guide explains how to test the cloud sync functionality with real VSCode integration.

## Overview

The sync integration tests (`src/test/suite/sync-integration.test.ts`) test the actual behavior of sync configuration using a real VSCode extension context.

## Running Integration Tests

### Run All Tests
```bash
npm test
```

### Run Only Sync Integration Tests
```bash
npm test -- --grep "Sync Integration"
```

## Test Structure

### Test Categories

1. **Provider Configuration Tests**
   - Initialize with no sync configuration
   - Configure VSCode sync provider
   - Disable sync completely
   - Switch between global and workspace scope

2. **Sync Operations Tests**
   - Sync to cloud after configuration
   - Get sync status for active provider
   - Handle auto-sync setting toggle

3. **Settings Validation Tests**
   - Handle missing provider setting gracefully
   - Separate sync settings from shortcuts data

## Writing New Integration Tests

### Basic Test Template

```typescript
test('should do something with sync', async () => {
    // 1. Configure sync settings
    await mockSyncConfig.update('enabled', true);
    await mockSyncConfig.update('provider', 'vscode');
    await mockSyncConfig.update('vscode.scope', 'global');

    // 2. Initialize sync manager
    await configManager.initializeSyncManager();

    // 3. Get sync manager
    const syncManager = configManager.getSyncManager();

    // 4. Perform assertions
    assert.ok(syncManager, 'Sync manager should exist');
    assert.strictEqual(syncManager.isEnabled(), true, 'Sync should be enabled');
});
```

## Testing Provider Configurations

### VSCode Settings Sync

**Global Scope:**
```typescript
await mockSyncConfig.update('enabled', true);
await mockSyncConfig.update('provider', 'vscode');
await mockSyncConfig.update('vscode.scope', 'global');
```

**Workspace Scope:**
```typescript
await mockSyncConfig.update('enabled', true);
await mockSyncConfig.update('provider', 'vscode');
await mockSyncConfig.update('vscode.scope', 'workspace');
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
3. Choose scope (Global or Workspace)
4. Enable when prompted
5. Verify toolbar shows sync buttons

#### Scenario 2: Test Manual Sync

1. Ensure sync is configured
2. Make changes to shortcuts configuration
3. Run `Shortcuts: Sync Now`
4. Observe progress notification
5. Check console for sync results

#### Scenario 3: Disable Sync

1. Run `Shortcuts: Disable Cloud Sync`
2. Verify sync buttons disappear from toolbar
3. Make changes - they should not auto-sync
4. Re-enable with `Shortcuts: Enable Cloud Sync`

## Debugging Integration Tests

### Enable Verbose Logging

Add console.log statements in tests:

```typescript
test('should configure sync', async () => {
    console.log('Starting sync configuration test...');

    // ... test code ...

    console.log('Sync configuration completed');
});
```

### Inspect Test Workspace

The integration tests create a temporary workspace in:
```
/tmp/shortcuts-sync-test-{timestamp}/
```

### Debug Test in VSCode

1. Set breakpoints in your test file
2. Open Debug panel
3. Select "Extension Tests" configuration
4. Press F5 to start debugging
5. Breakpoints will be hit during test execution

## Common Issues and Solutions

### Issue: "Extension not found"

**Solution:** Make sure the extension is properly installed:
```bash
npm run compile
npm run package
```

### Issue: Sync operations fail in tests

**Solution:** This is expected behavior in test environment with mock context. The tests verify configuration and provider setup, not actual cloud operations.

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

## Best Practices

1. **Always Clean Up:** Dispose sync managers and delete test files in teardown
2. **Use Temporary Directories:** Never modify actual workspace files
3. **Mock External Services:** Don't make real API calls in tests
4. **Test Edge Cases:** Include tests for error conditions and invalid configurations
5. **Verify State Changes:** Always assert before and after state
6. **Isolate Tests:** Each test should be independent
7. **Use Descriptive Names:** Test names should clearly describe what they're testing
