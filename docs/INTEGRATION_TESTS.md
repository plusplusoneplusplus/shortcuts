# Integration Tests Documentation

## Overview

This document describes the comprehensive integration test system for the Workspace Shortcuts extension. The integration tests use real VSCode instances and actual file system fixtures to validate group operations end-to-end.

## Test Structure

### Fixtures (`src/test/fixtures/`)

The test system includes four fixture workspaces that represent realistic usage scenarios:

#### 1. **Simple Workspace** (`simple-workspace/`)
- Basic project with `package.json`, `README.md`, and `src/` folder
- Pre-configured with 2 logical groups:
  - "Core Files" (package.json, README.md)
  - "Source Code" (src folder and files)
- Use case: Testing basic group and file operations

#### 2. **Nested Groups** (`nested-groups/`)
- Multi-directory structure (frontend/backend)
- Pre-configured with nested group hierarchy:
  - Frontend group with nested "Components" and "Styles" groups
  - Backend group with API routes
- Use case: Testing nested group operations

#### 3. **Multi-Repo** (`multi-repo/`)
- Two repository structure (frontend-repo, backend-repo)
- Pre-configured with base path aliases (`@frontend`, `@backend`)
- Use case: Testing base paths and alias functionality

#### 4. **Empty Workspace** (`empty-workspace/`)
- Minimal workspace with empty configuration
- Use case: Testing group creation from scratch

### Helper Utilities (`src/test/helpers/`)

#### `fixture-loader.ts`
Provides functions for working with test fixtures:

- `Fixture` enum: Available fixtures (SIMPLE_WORKSPACE, NESTED_GROUPS, etc.)
- `getFixturePath()`: Get absolute path to a fixture
- `loadFixtureConfig()`: Load shortcuts configuration from a fixture
- `copyFixture()`: Copy fixture to temp directory for testing
- `createTestFile()`: Create test files in workspace
- `createTestFolder()`: Create test folders in workspace
- `fileExistsInWorkspace()`: Check if file exists

#### `assertion-helpers.ts`
Provides assertion functions for validating configuration:

- `assertGroupExists()`: Verify a group exists
- `assertGroupDoesNotExist()`: Verify a group doesn't exist
- `assertGroupItemCount()`: Verify item count in group
- `assertGroupContainsItem()`: Verify group contains specific item
- `assertGroupDoesNotContainItem()`: Verify group doesn't contain item
- `assertNestedGroupExists()`: Verify nested group exists
- `assertBasePathExists()`: Verify base path alias exists
- `assertItemUsesAlias()`: Verify item uses specific alias
- `assertGroupExistsAtPath()`: Verify group at specific path (e.g., "Parent/Child")

### Integration Test Suite (`src/test/suite/integration.test.ts`)

#### Test Coverage (32 tests, all passing ✅)

##### Group Creation (5 tests)
- ✅ Create new group in empty workspace
- ✅ Create multiple groups
- ✅ Prevent duplicate group names
- ✅ Create nested groups
- ✅ Create deeply nested groups

##### Group Updates (3 tests)
- ✅ Rename a group
- ✅ Prevent renaming to existing group name
- ✅ Update group description

##### Group Deletion (3 tests)
- ✅ Delete a group
- ✅ Delete all groups
- ✅ Handle deleting non-existent group gracefully

##### File Addition to Groups (6 tests)
- ✅ Add file to group
- ✅ Add multiple files to group
- ✅ Prevent adding duplicate file to group
- ✅ Add file with absolute path
- ✅ Add file with relative path
- ✅ Remove file from group

##### Folder Addition to Groups (4 tests)
- ✅ Add folder to group
- ✅ Add nested folder to group
- ✅ Remove folder from group
- ✅ Add folder with files inside

##### Tree Data Provider Integration (4 tests)
- ✅ Load fixture groups correctly
- ✅ Expand group items
- ✅ Refresh after group creation
- ✅ Refresh after adding item to group

##### Nested Groups Integration (2 tests)
- ✅ Load nested groups from fixture
- ✅ Add items to nested groups

##### Base Paths Integration (3 tests)
- ✅ Load base paths from fixture
- ✅ Use aliases in item paths
- ✅ Add file using alias detection

##### End-to-End Workflows (2 tests)
- ✅ Complete workflow: create group, add items, rename, delete item
- ✅ Complex workflow with nested groups

## Running Integration Tests

### Run All Tests
```bash
npm test
```

This will:
1. Compile TypeScript tests
2. Compile extension
3. Run linter
4. Copy fixtures to `out/test/fixtures/`
5. Download and launch VSCode
6. Run all test suites including integration tests

### Run Only Compilation
```bash
npm run compile-tests
```

### Manual Fixture Copy
```bash
mkdir -p out/test/fixtures && cp -r src/test/fixtures/* out/test/fixtures/
```

## Test Execution Flow

1. **Setup Phase**
   - Create temporary directory for test workspace
   - Copy fixture files to temp directory
   - Initialize ConfigurationManager with temp workspace

2. **Test Phase**
   - Load fixture configuration
   - Perform operations (create/update/delete groups, add files/folders)
   - Validate results using assertion helpers

3. **Teardown Phase**
   - Clean up temporary directories
   - Dispose managers and providers

## Key Features

### Real VSCode Integration
- Tests run in actual VSCode instance (not mocked)
- Uses `@vscode/test-electron` to launch VSCode
- Validates real tree view behavior

### Fixture-Based Testing
- Pre-built workspaces simulate real-world scenarios
- No need to build file structures in every test
- Easy to add new fixtures for new scenarios

### Comprehensive Coverage
- Group lifecycle (create, update, delete)
- Item management (add/remove files and folders)
- Nested groups
- Base paths and aliases
- Tree data provider integration
- End-to-end workflows

### Clean Test Isolation
- Each test uses its own temporary directory
- No cross-test contamination
- Automatic cleanup after tests

## Adding New Tests

### Example: Add a new integration test

```typescript
test('should do something with groups', async () => {
    // 1. Copy a fixture to temp workspace
    copyFixture(Fixture.SIMPLE_WORKSPACE, tempDir);

    // 2. Perform operations
    const newFile = createTestFile(tempDir, 'test.ts', 'content');
    await configManager.addToLogicalGroup('Core Files', newFile, 'Test File', 'file');

    // 3. Validate results
    const config = await configManager.loadConfiguration();
    const group = assertGroupExists(config, 'Core Files');
    assertGroupContainsItem(group, 'Test File', 'file');
});
```

### Example: Add a new fixture

1. Create directory structure in `src/test/fixtures/my-fixture/`
2. Add `.vscode/shortcuts.yaml` configuration
3. Add sample files/folders
4. Add fixture to `Fixture` enum in `fixture-loader.ts`
5. Use in tests: `copyFixture(Fixture.MY_FIXTURE, tempDir)`

## Statistics

- **Total Integration Tests**: 32
- **Test Suites**: 8
- **Fixtures**: 4
- **Helper Functions**: 20+
- **Success Rate**: 100% ✅

## Benefits

1. **Real-World Validation**: Tests use actual VSCode and file system
2. **Comprehensive Coverage**: All group operations tested end-to-end
3. **Easy Maintenance**: Fixture-based approach is easy to extend
4. **Clear Assertions**: Semantic assertion helpers make tests readable
5. **Isolated Tests**: Each test is independent with its own workspace
6. **Fast Feedback**: All integration tests complete in ~3 seconds

## Future Enhancements

Potential additions to the integration test system:

- [ ] Drag and drop operations
- [ ] Keyboard navigation testing
- [ ] Search functionality validation
- [ ] Performance benchmarks
- [ ] Multi-workspace scenarios
- [ ] Error recovery scenarios
- [ ] File watcher integration tests

