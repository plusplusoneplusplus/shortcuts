# Design Document: Bundled Pipelines

**Status**: Draft
**Created**: 2025-01-17
**Author**: AI Assistant
**Version**: 1.0

## Overview

This design adds support for pre-defined pipelines that ship with the extension package itself, in addition to the existing user-created pipelines in the workspace folder. Bundled pipelines provide ready-to-use workflows that users can execute immediately or copy to their workspace for customization.

## Goals

1. **Zero-Config Start**: Users can run useful pipelines immediately without creating any files
2. **Best Practices**: Ship curated, well-tested pipeline templates as examples
3. **Discoverability**: Make bundled pipelines visible alongside workspace pipelines
4. **Customizability**: Allow users to copy bundled pipelines to workspace for modification
5. **Separation**: Clearly distinguish bundled (read-only) from workspace (editable) pipelines
6. **Extensibility**: Support adding new bundled pipelines in future releases

## Non-Goals

- User modification of bundled pipelines in-place (they must copy first)
- Remote/cloud pipeline repositories
- Pipeline marketplace or sharing platform
- Auto-updating bundled pipelines after extension installation

---

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                      Pipelines Tree View                         │
├─────────────────────────────────────────────────────────────────┤
│  📦 Bundled Pipelines                          [Extension]       │
│  ├── 📋 Code Review Checklist                  (read-only)       │
│  ├── 📋 Bug Triage                             (read-only)       │
│  └── 📋 Documentation Generator                (read-only)       │
│                                                                   │
│  📁 Workspace Pipelines                        [.vscode/pipelines]│
│  ├── 📋 My Custom Pipeline                     (editable)        │
│  └── 📋 Team Review Workflow                   (editable)        │
└─────────────────────────────────────────────────────────────────┘
```

### Module Structure

Extend the existing `yaml-pipeline` module:

```
src/shortcuts/yaml-pipeline/
├── ui/
│   ├── pipeline-manager.ts      # MODIFY: Add bundled pipeline discovery
│   ├── tree-data-provider.ts    # MODIFY: Show both bundled and workspace
│   ├── commands.ts              # MODIFY: Add copy-to-workspace command
│   └── types.ts                 # MODIFY: Add PipelineSource enum
├── bundled/                     # NEW: Bundled pipeline definitions
│   ├── index.ts                 # Export bundled pipeline registry
│   ├── code-review-checklist/
│   │   ├── pipeline.yaml
│   │   └── checklist-template.md
│   ├── bug-triage/
│   │   ├── pipeline.yaml
│   │   └── sample-input.csv
│   └── doc-generator/
│       └── pipeline.yaml
└── ...
```

### Extension Bundle

Add bundled pipelines to webpack configuration so they're included in the `.vsix` package:

```
resources/
└── bundled-pipelines/           # Bundled at build time
    ├── code-review-checklist/
    │   ├── pipeline.yaml
    │   └── checklist-template.md
    ├── bug-triage/
    │   ├── pipeline.yaml
    │   └── sample-input.csv
    └── doc-generator/
        └── pipeline.yaml
```

---

## Component Details

### 1. Pipeline Source Enum

Add to `ui/types.ts`:

```typescript
export enum PipelineSource {
  /** Bundled with extension - read-only */
  Bundled = 'bundled',
  /** User-created in workspace - editable */
  Workspace = 'workspace'
}

export interface PipelineInfo {
  // Existing fields...
  fileName: string;
  filePath: string;
  relativePath: string;
  name: string;
  description?: string;
  lastModified: Date;
  size: number;
  isValid: boolean;
  validationErrors?: string[];

  // NEW: Source tracking
  source: PipelineSource;

  // NEW: For bundled pipelines, the extension-relative path
  bundledPath?: string;

  // NEW: Resource files included with the pipeline
  resourceFiles?: ResourceFileInfo[];
}

export interface BundledPipelineManifest {
  /** Unique identifier for the bundled pipeline */
  id: string;

  /** Display name */
  name: string;

  /** Short description */
  description: string;

  /** Category for grouping */
  category?: 'code-review' | 'data-processing' | 'documentation' | 'testing' | 'other';

  /** Directory name within bundled-pipelines folder */
  directory: string;

  /** Main pipeline YAML file name (default: pipeline.yaml) */
  entryPoint?: string;

  /** Additional resource files to copy when exporting */
  resources?: string[];

  /** Minimum extension version required */
  minVersion?: string;
}
```

### 2. Bundled Pipeline Registry

Create `bundled/index.ts`:

```typescript
import * as path from 'path';
import * as vscode from 'vscode';
import { BundledPipelineManifest } from '../ui/types';

/**
 * Registry of all bundled pipelines that ship with the extension.
 * Add new entries here when adding bundled pipelines.
 */
export const BUNDLED_PIPELINES: BundledPipelineManifest[] = [
  {
    id: 'code-review-checklist',
    name: 'Code Review Checklist',
    description: 'Generate code review checklists from git diffs',
    category: 'code-review',
    directory: 'code-review-checklist',
    resources: ['checklist-template.md']
  },
  {
    id: 'bug-triage',
    name: 'Bug Triage',
    description: 'Classify and prioritize bug reports from CSV',
    category: 'data-processing',
    directory: 'bug-triage',
    resources: ['sample-input.csv']
  },
  {
    id: 'doc-generator',
    name: 'Documentation Generator',
    description: 'Generate documentation from code files',
    category: 'documentation',
    directory: 'doc-generator'
  }
];

/**
 * Get the absolute path to the bundled pipelines directory.
 * This resolves to the resources folder within the extension.
 */
export function getBundledPipelinesPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, 'resources', 'bundled-pipelines');
}

/**
 * Get manifest for a specific bundled pipeline by ID.
 */
export function getBundledPipelineManifest(id: string): BundledPipelineManifest | undefined {
  return BUNDLED_PIPELINES.find(p => p.id === id);
}
```

### 3. Extended PipelineManager

Modify `ui/pipeline-manager.ts`:

```typescript
import { BUNDLED_PIPELINES, getBundledPipelinesPath } from '../bundled';

export class PipelineManager {
  private context: vscode.ExtensionContext;
  private workspaceRoot: string;

  constructor(workspaceRoot: string, context: vscode.ExtensionContext) {
    this.workspaceRoot = workspaceRoot;
    this.context = context;
  }

  /**
   * Get all pipelines from both bundled and workspace sources.
   */
  async getAllPipelines(): Promise<PipelineInfo[]> {
    const [bundled, workspace] = await Promise.all([
      this.getBundledPipelines(),
      this.getWorkspacePipelines()
    ]);
    return [...bundled, ...workspace];
  }

  /**
   * Get pipelines bundled with the extension.
   */
  async getBundledPipelines(): Promise<PipelineInfo[]> {
    const bundledPath = getBundledPipelinesPath(this.context);
    const pipelines: PipelineInfo[] = [];

    for (const manifest of BUNDLED_PIPELINES) {
      const pipelineDir = path.join(bundledPath, manifest.directory);
      const entryPoint = manifest.entryPoint || 'pipeline.yaml';
      const pipelineFile = path.join(pipelineDir, entryPoint);

      try {
        const exists = await this.fileExists(pipelineFile);
        if (!exists) {
          console.warn(`Bundled pipeline not found: ${pipelineFile}`);
          continue;
        }

        const content = await fs.promises.readFile(pipelineFile, 'utf-8');
        const parsed = yaml.parse(content);
        const stats = await fs.promises.stat(pipelineFile);

        pipelines.push({
          fileName: entryPoint,
          filePath: pipelineFile,
          relativePath: `bundled://${manifest.directory}`,
          name: parsed.name || manifest.name,
          description: parsed.description || manifest.description,
          lastModified: stats.mtime,
          size: stats.size,
          isValid: true, // Bundled pipelines are pre-validated
          source: PipelineSource.Bundled,
          bundledPath: manifest.directory,
          resourceFiles: await this.getResourceFiles(pipelineDir)
        });
      } catch (error) {
        console.error(`Failed to load bundled pipeline ${manifest.id}:`, error);
      }
    }

    return pipelines;
  }

  /**
   * Get user-created pipelines from workspace folder.
   * (Existing implementation, renamed from getPipelines)
   */
  async getWorkspacePipelines(): Promise<PipelineInfo[]> {
    // Existing implementation with source: PipelineSource.Workspace
    const pipelines = await this.scanWorkspacePipelines();
    return pipelines.map(p => ({
      ...p,
      source: PipelineSource.Workspace
    }));
  }

  /**
   * Copy a bundled pipeline to the workspace for customization.
   */
  async copyBundledToWorkspace(
    bundledId: string,
    targetName?: string
  ): Promise<string> {
    const manifest = getBundledPipelineManifest(bundledId);
    if (!manifest) {
      throw new Error(`Bundled pipeline not found: ${bundledId}`);
    }

    const bundledPath = getBundledPipelinesPath(this.context);
    const sourceDir = path.join(bundledPath, manifest.directory);
    const destName = targetName || manifest.directory;
    const destDir = path.join(this.getPipelinesFolder(), destName);

    // Check if destination already exists
    if (await this.directoryExists(destDir)) {
      throw new Error(`Pipeline already exists: ${destName}`);
    }

    // Create destination directory
    await fs.promises.mkdir(destDir, { recursive: true });

    // Copy pipeline.yaml
    const entryPoint = manifest.entryPoint || 'pipeline.yaml';
    await fs.promises.copyFile(
      path.join(sourceDir, entryPoint),
      path.join(destDir, entryPoint)
    );

    // Copy resource files
    if (manifest.resources) {
      for (const resource of manifest.resources) {
        const srcFile = path.join(sourceDir, resource);
        const destFile = path.join(destDir, resource);

        // Create subdirectories if needed
        await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
        await fs.promises.copyFile(srcFile, destFile);
      }
    }

    return destDir;
  }

  /**
   * Check if a bundled pipeline has been copied to workspace.
   */
  async isBundledPipelineInWorkspace(bundledId: string): Promise<boolean> {
    const manifest = getBundledPipelineManifest(bundledId);
    if (!manifest) return false;

    const workspacePath = path.join(this.getPipelinesFolder(), manifest.directory);
    return this.directoryExists(workspacePath);
  }
}
```

### 4. Extended Tree Data Provider

Modify `ui/tree-data-provider.ts`:

```typescript
export class PipelinesTreeDataProvider
  implements vscode.TreeDataProvider<PipelineTreeItem> {

  async getChildren(element?: PipelineTreeItem): Promise<PipelineTreeItem[]> {
    if (!element) {
      // Root level: show category headers
      return this.getRootItems();
    }

    if (element.itemType === 'category') {
      // Category level: show pipelines in that category
      return this.getPipelinesInCategory(element.categoryType);
    }

    if (element.itemType === 'pipeline') {
      // Pipeline level: show resource files
      return this.getResourceItems(element.pipeline);
    }

    return [];
  }

  private async getRootItems(): Promise<PipelineTreeItem[]> {
    const items: PipelineTreeItem[] = [];
    const allPipelines = await this.pipelineManager.getAllPipelines();

    const bundled = allPipelines.filter(p => p.source === PipelineSource.Bundled);
    const workspace = allPipelines.filter(p => p.source === PipelineSource.Workspace);

    // Always show Bundled category (even if empty, for discoverability)
    items.push(new PipelineCategoryItem(
      'Bundled Pipelines',
      'bundled',
      bundled.length,
      'Pre-installed pipeline templates'
    ));

    // Show Workspace category if there are workspace pipelines
    if (workspace.length > 0 || await this.pipelineManager.workspaceFolderExists()) {
      items.push(new PipelineCategoryItem(
        'Workspace Pipelines',
        'workspace',
        workspace.length,
        `Pipelines in ${this.pipelineManager.getRelativePipelinesFolder()}`
      ));
    }

    return items;
  }

  private async getPipelinesInCategory(
    category: 'bundled' | 'workspace'
  ): Promise<PipelineTreeItem[]> {
    const allPipelines = await this.pipelineManager.getAllPipelines();
    const source = category === 'bundled'
      ? PipelineSource.Bundled
      : PipelineSource.Workspace;

    return allPipelines
      .filter(p => p.source === source)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => new PipelineItem(p));
  }
}

/**
 * Category header item (Bundled / Workspace)
 */
export class PipelineCategoryItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly categoryType: 'bundled' | 'workspace',
    count: number,
    tooltip: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `(${count})`;
    this.tooltip = tooltip;
    this.contextValue = `pipelineCategory_${categoryType}`;
    this.iconPath = categoryType === 'bundled'
      ? new vscode.ThemeIcon('package')
      : new vscode.ThemeIcon('folder');
  }

  itemType = 'category' as const;
}

/**
 * Individual pipeline item
 */
export class PipelineItem extends vscode.TreeItem {
  constructor(public readonly pipeline: PipelineInfo) {
    super(
      pipeline.name,
      pipeline.resourceFiles?.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.description = pipeline.source === PipelineSource.Bundled
      ? '(read-only)'
      : pipeline.fileName;

    this.tooltip = this.buildTooltip();

    this.contextValue = pipeline.source === PipelineSource.Bundled
      ? 'pipeline_bundled'
      : 'pipeline_workspace';

    this.iconPath = new vscode.ThemeIcon(
      pipeline.isValid ? 'symbol-method' : 'warning'
    );

    // Click to open the pipeline file
    this.command = {
      command: 'pipelinesViewer.open',
      title: 'Open Pipeline',
      arguments: [this]
    };
  }

  itemType = 'pipeline' as const;

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.pipeline.name}**\n\n`);

    if (this.pipeline.description) {
      md.appendMarkdown(`${this.pipeline.description}\n\n`);
    }

    if (this.pipeline.source === PipelineSource.Bundled) {
      md.appendMarkdown(`📦 *Bundled with extension (read-only)*\n\n`);
      md.appendMarkdown(`Right-click to copy to workspace for editing.`);
    } else {
      md.appendMarkdown(`📁 *Workspace pipeline*\n\n`);
      md.appendMarkdown(`Path: \`${this.pipeline.relativePath}\``);
    }

    return md;
  }
}
```

### 5. New Commands

Add to `ui/commands.ts`:

```typescript
export class PipelineCommands {
  registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
    return [
      // Existing commands...

      // NEW: Copy bundled pipeline to workspace
      vscode.commands.registerCommand(
        'pipelinesViewer.copyToWorkspace',
        async (item: PipelineItem) => {
          if (item.pipeline.source !== PipelineSource.Bundled) {
            vscode.window.showWarningMessage('This pipeline is already in your workspace.');
            return;
          }

          const bundledId = item.pipeline.bundledPath;
          if (!bundledId) return;

          // Check if already exists
          const exists = await this.pipelineManager.isBundledPipelineInWorkspace(bundledId);
          if (exists) {
            const choice = await vscode.window.showWarningMessage(
              `Pipeline "${item.pipeline.name}" already exists in workspace.`,
              'Open Existing',
              'Create Copy'
            );

            if (choice === 'Open Existing') {
              const workspacePath = path.join(
                this.pipelineManager.getPipelinesFolder(),
                bundledId
              );
              await this.openPipelineFolder(workspacePath);
              return;
            }

            if (choice === 'Create Copy') {
              const newName = await vscode.window.showInputBox({
                prompt: 'Enter a name for the copied pipeline',
                value: `${bundledId}-copy`,
                validateInput: this.validatePipelineName.bind(this)
              });

              if (!newName) return;

              await this.copyBundledPipeline(bundledId, newName);
              return;
            }

            return;
          }

          await this.copyBundledPipeline(bundledId);
        }
      ),

      // NEW: View bundled pipeline (read-only)
      vscode.commands.registerCommand(
        'pipelinesViewer.viewBundled',
        async (item: PipelineItem) => {
          if (item.pipeline.source !== PipelineSource.Bundled) return;

          const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.file(item.pipeline.filePath)
          );

          await vscode.window.showTextDocument(doc, {
            preview: true,
            preserveFocus: false
          });

          // Show info message about read-only
          vscode.window.showInformationMessage(
            'This is a bundled pipeline. Copy to workspace to edit.',
            'Copy to Workspace'
          ).then(choice => {
            if (choice === 'Copy to Workspace') {
              vscode.commands.executeCommand('pipelinesViewer.copyToWorkspace', item);
            }
          });
        }
      )
    ];
  }

  private async copyBundledPipeline(bundledId: string, targetName?: string): Promise<void> {
    try {
      const destPath = await this.pipelineManager.copyBundledToWorkspace(
        bundledId,
        targetName
      );

      this.treeDataProvider.refresh();

      const choice = await vscode.window.showInformationMessage(
        `Pipeline copied to workspace: ${path.basename(destPath)}`,
        'Open Pipeline'
      );

      if (choice === 'Open Pipeline') {
        const pipelineFile = path.join(destPath, 'pipeline.yaml');
        const doc = await vscode.workspace.openTextDocument(pipelineFile);
        await vscode.window.showTextDocument(doc);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to copy pipeline: ${error}`);
    }
  }
}
```

### 6. Package.json Updates

Add new commands and menus:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "pipelinesViewer.copyToWorkspace",
        "title": "Copy to Workspace",
        "category": "Pipelines",
        "icon": "$(copy)"
      },
      {
        "command": "pipelinesViewer.viewBundled",
        "title": "View Pipeline",
        "category": "Pipelines",
        "icon": "$(eye)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "pipelinesViewer.copyToWorkspace",
          "when": "view == pipelinesView && viewItem == pipeline_bundled",
          "group": "pipeline@1"
        },
        {
          "command": "pipelinesViewer.execute",
          "when": "view == pipelinesView && viewItem =~ /^pipeline/",
          "group": "pipeline@2"
        },
        {
          "command": "pipelinesViewer.open",
          "when": "view == pipelinesView && viewItem == pipeline_workspace",
          "group": "pipeline@3"
        },
        {
          "command": "pipelinesViewer.viewBundled",
          "when": "view == pipelinesView && viewItem == pipeline_bundled",
          "group": "pipeline@3"
        }
      ]
    }
  }
}
```

### 7. Webpack Configuration

Update `webpack.config.js` to include bundled pipelines:

```javascript
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  // ... existing config
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: 'resources/bundled-pipelines',
          to: 'resources/bundled-pipelines'
        }
      ]
    })
  ]
};
```

---

## Bundled Pipeline Examples

### 1. Code Review Checklist

`resources/bundled-pipelines/code-review-checklist/pipeline.yaml`:

```yaml
name: "Code Review Checklist"
description: "Generate a code review checklist from git diff"

input:
  type: git-diff
  source: staged  # or 'pending', 'commit:<hash>'

map:
  prompt: |
    Analyze this code change and create a review checklist:

    File: {{file}}
    Change Type: {{changeType}}

    Diff:
    ```
    {{diff}}
    ```

    Create a checklist of items to verify during code review.
    Focus on: correctness, edge cases, security, performance.

  output:
    - checklist_items
    - risk_level
    - suggested_tests

reduce:
  type: ai
  prompt: |
    Combine these file-level checklists into a unified review checklist.

    {{RESULTS}}

    Create a prioritized checklist organized by risk level.
```

### 2. Bug Triage

`resources/bundled-pipelines/bug-triage/pipeline.yaml`:

```yaml
name: "Bug Triage"
description: "Classify and prioritize bug reports"

input:
  type: csv
  path: "bugs.csv"  # User provides this

map:
  prompt: |
    Analyze this bug report:

    Title: {{title}}
    Description: {{description}}
    Reporter Priority: {{priority}}

    Classify the severity, estimate effort, and identify components.

  output:
    - severity
    - category
    - affected_components
    - effort_hours
    - needs_more_info

  parallel: 5

reduce:
  type: table
  columns:
    - title
    - severity
    - category
    - effort_hours
  sortBy: severity
```

### 3. Documentation Generator

`resources/bundled-pipelines/doc-generator/pipeline.yaml`:

```yaml
name: "Documentation Generator"
description: "Generate API documentation from source files"

input:
  type: file-glob
  pattern: "src/**/*.ts"
  filter:
    hasExports: true

map:
  prompt: |
    Generate documentation for this TypeScript file:

    File: {{path}}

    ```typescript
    {{content}}
    ```

    Extract all exported functions, classes, and types.
    Generate JSDoc-style documentation.

  output:
    - exports
    - documentation

reduce:
  type: ai
  prompt: |
    Create a comprehensive API reference from these file documentations:

    {{RESULTS}}

    Organize by module and include a table of contents.
```

---

## Configuration Options

Add new settings:

```json
{
  "workspaceShortcuts.pipelinesViewer.showBundled": {
    "type": "boolean",
    "default": true,
    "description": "Show bundled pipelines in the Pipelines panel"
  },
  "workspaceShortcuts.pipelinesViewer.bundledCategory": {
    "type": "string",
    "enum": ["expanded", "collapsed", "hidden"],
    "default": "expanded",
    "description": "Initial state of the Bundled Pipelines category"
  }
}
```

---

## User Experience

### First-Time User Flow

1. User installs extension
2. Opens Pipelines panel
3. Sees "Bundled Pipelines" category with 3 pre-installed pipelines
4. Clicks on "Bug Triage" to view it
5. Sees read-only YAML with info message
6. Right-clicks → "Copy to Workspace"
7. Pipeline is copied to `.vscode/pipelines/bug-triage/`
8. User can now edit and customize

### Visual Indicators

| State | Icon | Description |
|-------|------|-------------|
| Bundled Pipeline | 📦 | Package icon, "(read-only)" suffix |
| Workspace Pipeline | 📋 | Method icon, file name suffix |
| Copied from Bundled | 📋 | Method icon, editable |
| Invalid Pipeline | ⚠️ | Warning icon with error tooltip |

### Context Menu Actions

**For Bundled Pipelines:**
- Copy to Workspace
- Execute Pipeline
- View Pipeline (read-only)

**For Workspace Pipelines:**
- Execute Pipeline
- Open Pipeline
- Validate Pipeline
- Rename Pipeline
- Delete Pipeline

---

## Implementation Plan

### Phase 1: Core Infrastructure (MVP)

1. Create `resources/bundled-pipelines/` directory structure
2. Add `bundled/index.ts` with pipeline registry
3. Update `PipelineManager` to load bundled pipelines
4. Update constructor to accept `ExtensionContext`
5. Modify `extension.ts` to pass context to manager

### Phase 2: Tree View Updates

1. Add `PipelineSource` enum to types
2. Create `PipelineCategoryItem` class
3. Update `PipelinesTreeDataProvider.getChildren()` for categories
4. Update `PipelineItem` with source-aware rendering
5. Add context values for bundled vs workspace

### Phase 3: Commands and Actions

1. Implement `copyToWorkspace` command
2. Implement `viewBundled` command
3. Add context menu entries in `package.json`
4. Handle name conflicts during copy

### Phase 4: Bundled Pipeline Content

1. Create code-review-checklist pipeline
2. Create bug-triage pipeline with sample CSV
3. Create doc-generator pipeline
4. Test all bundled pipelines

### Phase 5: Polish and Configuration

1. Add configuration options for bundled visibility
2. Add webpack copy plugin configuration
3. Update welcome message for empty state
4. Add unit tests for bundled pipeline loading

---

## Testing Strategy

### Unit Tests

```typescript
describe('BundledPipelines', () => {
  describe('Registry', () => {
    it('should export all bundled pipeline manifests');
    it('should have valid manifest structure');
    it('should have unique IDs');
  });

  describe('PipelineManager', () => {
    it('should load bundled pipelines from extension path');
    it('should return both bundled and workspace pipelines');
    it('should correctly identify pipeline source');
    it('should copy bundled pipeline to workspace');
    it('should handle name conflicts during copy');
  });

  describe('TreeDataProvider', () => {
    it('should show category headers');
    it('should group pipelines by source');
    it('should show correct context values');
  });
});
```

### Integration Tests

1. Verify bundled pipelines are included in `.vsix` package
2. Test copy-to-workspace with resource files
3. Test execution of bundled pipelines (when executor is ready)

### Manual Testing

1. Fresh install: verify bundled pipelines appear
2. Copy to workspace: verify files are copied correctly
3. Upgrade: verify bundled pipelines are updated
4. Configuration: verify show/hide options work

---

## Open Questions

1. **Pipeline Updates**: When the extension updates and bundled pipelines change, should we:
   - Notify users with copied versions about updates?
   - Provide a "diff" or "update" action?
   - Leave copied versions unchanged (current plan)?

2. **Execution Context**: When executing a bundled pipeline:
   - Should input files be resolved relative to workspace or extension?
   - Should we require copy-to-workspace before execution?
   - Should bundled pipelines support execution directly?

3. **Custom Bundled Pipelines**: Should we support:
   - Organization-level bundled pipelines (from settings)?
   - Remote pipeline repositories?
   - Pipeline sharing/importing?

4. **Resource Files**: How to handle bundled pipeline resource files:
   - Copy all resources when copying pipeline?
   - Copy on-demand when referenced?
   - Allow referencing bundled resources from workspace pipelines?

---

## Future Enhancements

1. **Pipeline Marketplace**: Browse and install community pipelines
2. **Version Tracking**: Track which bundled version a workspace copy is based on
3. **Update Notifications**: Notify when bundled pipelines are updated
4. **Template Parameters**: Allow bundled pipelines to prompt for configuration
5. **Organization Bundles**: Support org-specific pipeline bundles via settings

---

## Dependencies

- Existing `yaml-pipeline` module
- `copy-webpack-plugin` for bundling resources
- VSCode Extension Context for path resolution

---

## Success Criteria

1. Users can see bundled pipelines immediately after installation
2. Bundled pipelines are clearly marked as read-only
3. Copy-to-workspace creates a fully functional local copy
4. Resource files are copied along with pipeline YAML
5. Tree view correctly groups pipelines by source
6. Bundled pipelines are included in `.vsix` package
7. All existing workspace pipeline functionality continues to work

---

## References

- [YAML Pipeline Framework Design](./yaml-pipeline-framework.md)
- [Pipeline Panel Design](./pipeline-panel-design.md)
- [VSCode Extension API - ExtensionContext](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)
- [Webpack CopyPlugin](https://webpack.js.org/plugins/copy-webpack-plugin/)
