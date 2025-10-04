# Configuration Migration Guide

This document explains the configuration migration system for the Workspace Shortcuts extension.

## Overview

The extension uses a versioned configuration system that automatically migrates older configuration formats to the current version. This ensures backward compatibility when upgrading the extension.

## Configuration Versions

### Version 1 (Pre-2.0)
**Format:** Physical shortcuts array
```yaml
shortcuts:
  - path: src
    name: Source Code
  - path: docs
    name: Documentation
```

**Features:**
- Simple array of folder shortcuts
- Each shortcut was a single folder
- No grouping or organization

### Version 2 (2.0-2.4)
**Format:** Logical groups without nesting
```yaml
version: 2
logicalGroups:
  - name: Development
    description: Development files
    items:
      - path: src
        name: Source Code
        type: folder
      - path: package.json
        name: Package Config
        type: file
```

**Features:**
- Logical groups for organization
- Support for both files and folders
- Group descriptions and icons
- Base path aliases

### Version 3 (2.5+)
**Format:** Logical groups with nested groups
```yaml
version: 3
logicalGroups:
  - name: Development
    description: Development files
    items:
      - path: src
        name: Source Code
        type: folder
    groups:
      - name: Frontend
        items:
          - path: src/components
            name: Components
            type: folder
      - name: Backend
        items:
          - path: src/api
            name: API
            type: folder
```

**Features:**
- All v2 features
- Nested groups (unlimited depth)
- Command and task items
- Enhanced organization

## Migration Process

### Automatic Migration

The extension automatically migrates your configuration when:
1. You open a workspace with an older configuration
2. The extension detects a version mismatch
3. Migrations are applied sequentially (v1→v2→v3)

### Migration Steps

#### V1 to V2 Migration
1. Each physical shortcut becomes a logical group
2. The group name is taken from the shortcut name
3. The folder becomes a single item in the group
4. Invalid or non-existent paths are skipped with warnings

**Example:**
```yaml
# Before (v1)
shortcuts:
  - path: src
    name: Source Code

# After (v2)
version: 2
logicalGroups:
  - name: Source Code
    items:
      - path: src
        name: src
        type: folder
```

#### V2 to V3 Migration
1. Version number is updated
2. Structure remains compatible (no data changes)
3. Configuration is ready for nested groups

### Manual Migration

If you want to manually migrate your configuration:

1. **Backup your configuration:**
   ```bash
   cp .vscode/shortcuts.yaml .vscode/shortcuts.yaml.backup
   ```

2. **Update the format** according to the version 3 schema

3. **Add version number:**
   ```yaml
   version: 3
   logicalGroups:
     # ... your groups
   ```

## Migration Warnings

During migration, you may see warnings for:

- **Non-existent paths:** Shortcuts pointing to deleted folders/files
- **Invalid data:** Malformed configuration entries
- **Duplicate names:** Groups with conflicting names
- **Type mismatches:** Files marked as folders or vice versa

These warnings are logged to the console and shown in a notification. The migration continues, skipping problematic entries.

## Testing Migrations

The extension includes comprehensive migration tests:

```bash
npm test
```

Test coverage includes:
- Version detection
- V1→V2 migration
- V2→V3 migration
- Multi-version migrations
- Edge cases and error handling
- Data preservation
- Warning generation

## API for Developers

If you're extending the extension, you can use the migration API:

```typescript
import { 
    detectConfigVersion, 
    migrateConfig, 
    canMigrate,
    CURRENT_CONFIG_VERSION 
} from './config-migrations';

// Detect version
const version = detectConfigVersion(config);

// Check if migration is possible
if (canMigrate(config)) {
    // Migrate to current version
    const result = migrateConfig(config, {
        workspaceRoot: '/path/to/workspace',
        verbose: true
    });
    
    console.log(`Migrated from v${result.fromVersion} to v${result.toVersion}`);
    console.log(`Applied: ${result.appliedMigrations.join(', ')}`);
    console.log(`Warnings: ${result.warnings.length}`);
}
```

## Adding New Migrations

When adding a new configuration version:

1. **Increment `CURRENT_CONFIG_VERSION`** in `config-migrations.ts`

2. **Create a migration function:**
   ```typescript
   function migrateV3ToV4(config: any, context: MigrationContext): any {
       // Transform config from v3 to v4
       config.version = 4;
       // ... your changes
       return config;
   }
   ```

3. **Register the migration:**
   ```typescript
   registerMigration(3, migrateV3ToV4);
   ```

4. **Add tests** in `config-migrations.test.ts`

5. **Update this documentation**

## Troubleshooting

### Migration Failed

If migration fails:
1. Check the console for detailed error messages
2. Verify your configuration file is valid YAML
3. Restore from backup if needed
4. Report the issue with your configuration (sanitized)

### Data Loss During Migration

Migrations are designed to be non-destructive, but:
- Always keep backups of your configuration
- Check warnings after migration
- Verify your groups and items are intact

### Version Mismatch

If you see "unsupported version" errors:
- You may be using a configuration from a newer version
- Downgrade is not supported
- Update the extension to the latest version

## Best Practices

1. **Version Control:** Keep your `.vscode/shortcuts.yaml` in git
2. **Backups:** Before major upgrades, backup your configuration
3. **Test:** After migration, verify all groups and items work
4. **Clean Up:** Remove old configurations after successful migration
5. **Document:** If using custom configurations, document your setup

## Future Versions

The migration system is designed to support future versions:
- New features can be added without breaking old configurations
- Migrations are applied sequentially
- Each version builds on the previous one
- Backward compatibility is maintained

## Support

If you encounter migration issues:
1. Check this guide
2. Review the console output
3. Check existing issues on GitHub
4. Create a new issue with:
   - Your configuration (sanitized)
   - Extension version
   - Migration warnings/errors
   - Steps to reproduce
