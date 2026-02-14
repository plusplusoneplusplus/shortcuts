# Skills Integration Plan

## Overview

Integrate a Skills system into the VSCode extension that allows users to discover and trigger skill-based actions (like the existing `deep-planner` skill in `.github/skills/`) directly from the IDE interface.

**Goals:**
1. Auto-discover skills from `.github/skills/` directory
2. Display skills in a dedicated tree view within the Shortcuts extension
3. Allow users to trigger skills via commands, context menus, and quick palette
4. Support skill configuration and state management
5. Integrate with existing AI Service infrastructure for AI-powered skills

---

## Architecture Design

### Core Components

```
src/shortcuts/skills/
├── skill-types.ts              # Core interfaces and types
├── skill-registry.ts           # Discovery and loading system
├── skill-manager.ts            # Lifecycle and execution manager
├── skill-executor.ts           # Execution engine with AI integration
├── ui/
│   ├── skills-tree-provider.ts # TreeDataProvider for skills view
│   ├── skills-commands.ts      # Command handlers
│   └── skill-tree-items.ts     # Tree item classes
├── parsers/
│   └── skill-metadata-parser.ts # Parse SKILL.md files
└── built-in/
    └── (placeholder for future built-in skills)
```

---

## Implementation Steps

### Phase 1: Core Infrastructure (Foundation)

#### 1.1 Define Type System (`skill-types.ts`)

```typescript
export interface ISkill {
  readonly id: string;              // Unique identifier (from directory name)
  readonly name: string;            // Display name (from SKILL.md frontmatter)
  readonly description: string;     // Short description
  readonly path: string;            // Filesystem path to skill directory
  readonly enabled: boolean;        // User-controlled enable/disable
  readonly metadata: SkillMetadata; // Parsed from SKILL.md
}

export interface SkillMetadata {
  name: string;
  description: string;
  category?: string;                // Optional category for grouping
  aiRequired?: boolean;             // Requires AI service
  version?: string;                 // Skill version
  author?: string;                  // Skill author
}

export interface SkillExecutionContext {
  workspaceRoot: string;
  extensionContext: vscode.ExtensionContext;
  aiProcessManager?: IAIProcessManager;
  configManager: ConfigurationManager;
}

export interface SkillExecutionResult {
  success: boolean;
  message: string;
  processId?: string;               // If using AI Service
  output?: unknown;                 // Optional structured output
}
```

**Files to create:**
- `src/shortcuts/skills/skill-types.ts`

---

#### 1.2 Metadata Parser (`parsers/skill-metadata-parser.ts`)

Parse SKILL.md frontmatter (YAML between `---` delimiters):

```typescript
export class SkillMetadataParser {
  /**
   * Parse SKILL.md file to extract metadata
   * Reads YAML frontmatter: ---\nname: ...\ndescription: ...\n---
   */
  static async parseSkillFile(skillPath: string): Promise<SkillMetadata | null> {
    const skillFilePath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillFilePath)) return null;
    
    const content = await fs.promises.readFile(skillFilePath, 'utf-8');
    
    // Extract frontmatter between --- delimiters
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;
    
    // Parse YAML using js-yaml (already a dependency)
    const yaml = require('js-yaml');
    const metadata = yaml.load(frontmatterMatch[1]);
    
    return {
      name: metadata.name || 'Unnamed Skill',
      description: metadata.description || '',
      category: metadata.category,
      aiRequired: metadata.aiRequired,
      version: metadata.version,
      author: metadata.author
    };
  }
}
```

**Files to create:**
- `src/shortcuts/skills/parsers/skill-metadata-parser.ts`

---

#### 1.3 Skill Registry (`skill-registry.ts`)

Discovery system that scans `.github/skills/` directory:

```typescript
export class SkillRegistry {
  private skills: Map<string, ISkill> = new Map();
  private skillsBasePath: string;
  
  constructor(workspaceRoot: string) {
    this.skillsBasePath = path.join(workspaceRoot, '.github', 'skills');
  }
  
  /**
   * Discover and register all skills from .github/skills/
   */
  async discoverSkills(): Promise<ISkill[]> {
    if (!fs.existsSync(this.skillsBasePath)) {
      return [];
    }
    
    const skillDirs = await fs.promises.readdir(this.skillsBasePath, { withFileTypes: true });
    const skills: ISkill[] = [];
    
    for (const dir of skillDirs) {
      if (!dir.isDirectory()) continue;
      
      const skillPath = path.join(this.skillsBasePath, dir.name);
      const metadata = await SkillMetadataParser.parseSkillFile(skillPath);
      
      if (metadata) {
        const skill: ISkill = {
          id: dir.name,
          name: metadata.name,
          description: metadata.description,
          path: skillPath,
          enabled: true,  // Default enabled, user can disable
          metadata
        };
        
        this.skills.set(skill.id, skill);
        skills.push(skill);
      }
    }
    
    return skills;
  }
  
  getSkill(id: string): ISkill | undefined {
    return this.skills.get(id);
  }
  
  getAllSkills(): ISkill[] {
    return Array.from(this.skills.values());
  }
}
```

**Files to create:**
- `src/shortcuts/skills/skill-registry.ts`

---

#### 1.4 Skill Manager (`skill-manager.ts`)

Central manager for lifecycle and execution:

```typescript
export class SkillManager {
  private registry: SkillRegistry;
  private context: SkillExecutionContext;
  
  constructor(
    workspaceRoot: string,
    extensionContext: vscode.ExtensionContext,
    configManager: ConfigurationManager,
    aiProcessManager?: IAIProcessManager
  ) {
    this.registry = new SkillRegistry(workspaceRoot);
    this.context = {
      workspaceRoot,
      extensionContext,
      configManager,
      aiProcessManager
    };
  }
  
  async initialize(): Promise<void> {
    await this.registry.discoverSkills();
    // Load user preferences from config
    await this.loadUserConfig();
  }
  
  private async loadUserConfig(): Promise<void> {
    // Load skill enabled/disabled state from .vscode/shortcuts.yaml
    // Format: skills: { "skill-id": { enabled: true/false } }
  }
  
  async executeSkill(skillId: string): Promise<SkillExecutionResult> {
    const skill = this.registry.getSkill(skillId);
    if (!skill) {
      return { success: false, message: `Skill not found: ${skillId}` };
    }
    
    if (!skill.enabled) {
      return { success: false, message: `Skill is disabled: ${skill.name}` };
    }
    
    // Skills are invoked via GitHub Copilot CLI's skill system
    // We trigger the skill context but let Copilot handle execution
    return {
      success: true,
      message: `Skill ${skill.name} triggered successfully`
    };
  }
  
  getSkills(): ISkill[] {
    return this.registry.getAllSkills();
  }
}
```

**Files to create:**
- `src/shortcuts/skills/skill-manager.ts`

---

### Phase 2: UI Integration (Tree View & Commands)

#### 2.1 Tree Data Provider (`ui/skills-tree-provider.ts`)

Display skills in a dedicated tree view:

```typescript
export class SkillsTreeDataProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  constructor(private skillManager: SkillManager) {}
  
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
  
  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }
  
  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (!element) {
      // Root level: group by category or show all
      const skills = this.skillManager.getSkills();
      return skills.map(skill => new SkillTreeItem(skill));
    }
    return [];
  }
}

export class SkillTreeItem extends vscode.TreeItem {
  constructor(public readonly skill: ISkill) {
    super(skill.name, vscode.TreeItemCollapsibleState.None);
    
    this.description = skill.description;
    this.tooltip = `${skill.name}\n${skill.description}`;
    this.contextValue = skill.enabled ? 'skill_enabled' : 'skill_disabled';
    
    // Icon
    this.iconPath = new vscode.ThemeIcon(
      skill.enabled ? 'zap' : 'circle-slash',
      new vscode.ThemeColor(skill.enabled ? 'charts.yellow' : 'disabledForeground')
    );
    
    // Click to execute
    this.command = {
      command: 'skills.execute',
      title: 'Execute Skill',
      arguments: [skill.id]
    };
  }
}
```

**Files to create:**
- `src/shortcuts/skills/ui/skills-tree-provider.ts`
- `src/shortcuts/skills/ui/skill-tree-items.ts`

---

#### 2.2 Commands (`ui/skills-commands.ts`)

Command handlers following existing patterns:

```typescript
export class SkillsCommands {
  constructor(
    private skillManager: SkillManager,
    private treeProvider: SkillsTreeDataProvider
  ) {}
  
  registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    
    // Execute skill
    disposables.push(
      vscode.commands.registerCommand('skills.execute', async (skillId: string) => {
        await this.executeSkill(skillId);
      })
    );
    
    // Quick palette access
    disposables.push(
      vscode.commands.registerCommand('skills.quickAccess', async () => {
        await this.showQuickPalette();
      })
    );
    
    // Refresh skills
    disposables.push(
      vscode.commands.registerCommand('skills.refresh', () => {
        this.treeProvider.refresh();
      })
    );
    
    // Toggle enabled/disabled
    disposables.push(
      vscode.commands.registerCommand('skills.toggle', async (skillId: string) => {
        await this.toggleSkill(skillId);
      })
    );
    
    return disposables;
  }
  
  private async executeSkill(skillId: string): Promise<void> {
    const result = await this.skillManager.executeSkill(skillId);
    
    if (result.success) {
      NotificationManager.showInfo(result.message);
    } else {
      NotificationManager.showError(result.message);
    }
  }
  
  private async showQuickPalette(): Promise<void> {
    const skills = this.skillManager.getSkills().filter(s => s.enabled);
    const items = skills.map(skill => ({
      label: `$(zap) ${skill.name}`,
      description: skill.description,
      skillId: skill.id
    }));
    
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a skill to execute'
    });
    
    if (selected) {
      await this.executeSkill(selected.skillId);
    }
  }
  
  private async toggleSkill(skillId: string): Promise<void> {
    // Toggle in config and refresh
    // Implementation: Update .vscode/shortcuts.yaml
  }
}
```

**Files to create:**
- `src/shortcuts/skills/ui/skills-commands.ts`

---

### Phase 3: Extension Integration

#### 3.1 Wire into Extension Activation (`src/extension.ts`)

Add skills initialization to the main extension activation:

**Changes needed:**

1. **Import skills modules** (after line 42):
```typescript
import { SkillManager, SkillsTreeDataProvider, SkillsCommands } from './shortcuts/skills';
```

2. **Initialize skills** (after configuration manager initialization, around line 110):
```typescript
// Initialize Skills Manager
const skillManager = new SkillManager(
    workspaceRoot,
    context,
    configManager,
    aiProcessManager
);
await skillManager.initialize();

// Create Skills Tree Provider
const skillsTreeProvider = new SkillsTreeDataProvider(skillManager);
const skillsTreeView = vscode.window.createTreeView('skillsView', {
    treeDataProvider: skillsTreeProvider,
    canSelectMany: false
});
context.subscriptions.push(skillsTreeView);

// Register Skills Commands
const skillsCommands = new SkillsCommands(skillManager, skillsTreeProvider);
const skillsCommandDisposables = skillsCommands.registerCommands(context);
context.subscriptions.push(...skillsCommandDisposables);
```

**Files to modify:**
- `src/extension.ts` (lines ~42, ~110-130)

---

#### 3.2 Update package.json Configuration

Add skills view and commands to package.json:

**Changes needed:**

1. **Add skills view to viewsContainers** (around line 50):
```json
"views": {
  "shortcuts": [
    {
      "id": "skillsView",
      "name": "Skills",
      "icon": "$(zap)",
      "contextualTitle": "Skills"
    }
  ]
}
```

2. **Add commands** (around line 200+):
```json
{
  "command": "skills.execute",
  "title": "Execute Skill",
  "category": "Skills"
},
{
  "command": "skills.quickAccess",
  "title": "Quick Access Skills",
  "category": "Skills",
  "icon": "$(zap)"
},
{
  "command": "skills.refresh",
  "title": "Refresh Skills",
  "category": "Skills",
  "icon": "$(refresh)"
},
{
  "command": "skills.toggle",
  "title": "Toggle Skill",
  "category": "Skills"
}
```

3. **Add menus** (around line 800+):
```json
"view/title": [
  {
    "command": "skills.refresh",
    "when": "view == skillsView",
    "group": "navigation"
  },
  {
    "command": "skills.quickAccess",
    "when": "view == skillsView",
    "group": "navigation"
  }
],
"view/item/context": [
  {
    "command": "skills.execute",
    "when": "view == skillsView && viewItem == skill_enabled",
    "group": "inline@1"
  },
  {
    "command": "skills.toggle",
    "when": "view == skillsView && viewItem =~ /skill_/",
    "group": "1_modification@1"
  }
]
```

4. **Add activation event**:
```json
"activationEvents": [
  "onView:skillsView"
]
```

**Files to modify:**
- `package.json` (lines 32, 200+, 800+)

---

#### 3.3 Configuration Schema (`shortcuts.yaml`)

Add skills configuration support:

```yaml
# Example configuration in .vscode/shortcuts.yaml
skills:
  enabled: true
  skills:
    deep-planner:
      enabled: true
    # Future skills...
```

**Files to modify:**
- Update `ConfigurationManager` to support skills config section

---

### Phase 4: Skill Execution Integration

#### 4.1 Skill Executor (`skill-executor.ts`)

Bridge between VSCode extension and GitHub Copilot CLI skill system:

```typescript
export class SkillExecutor {
  constructor(
    private context: SkillExecutionContext,
    private aiProcessManager?: IAIProcessManager
  ) {}
  
  /**
   * Execute a skill by invoking it via the @skill tool in GitHub Copilot
   * This doesn't directly execute the skill - it provides the skill context
   * to Copilot, which then handles the execution.
   */
  async execute(skill: ISkill): Promise<SkillExecutionResult> {
    // Skills are meant to be invoked via Copilot's skill system
    // We can't directly execute them, but we can:
    // 1. Show instructions to the user
    // 2. Copy the invocation command to clipboard
    // 3. Open Copilot chat with pre-filled skill invocation
    
    const invocationText = `@skill ${skill.id}`;
    
    // Option 1: Show notification with instructions
    const action = await vscode.window.showInformationMessage(
      `Ready to invoke skill: ${skill.name}`,
      'Copy Command',
      'Open Copilot Chat',
      'Cancel'
    );
    
    if (action === 'Copy Command') {
      await vscode.env.clipboard.writeText(invocationText);
      NotificationManager.showInfo('Skill invocation command copied to clipboard');
    } else if (action === 'Open Copilot Chat') {
      // Open Copilot chat with pre-filled message
      await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
      // Note: VSCode API doesn't support pre-filling chat, so user will need to paste
      await vscode.env.clipboard.writeText(invocationText);
      NotificationManager.showInfo('Paste the command from clipboard into Copilot Chat');
    }
    
    return {
      success: true,
      message: `Skill ${skill.name} invocation prepared`
    };
  }
}
```

**Files to create:**
- `src/shortcuts/skills/skill-executor.ts`

---

### Phase 5: Export & Module Structure

#### 5.1 Create index.ts (`src/shortcuts/skills/index.ts`)

Export all public APIs:

```typescript
// Core
export * from './skill-types';
export * from './skill-manager';
export * from './skill-registry';
export * from './skill-executor';

// UI
export * from './ui/skills-tree-provider';
export * from './ui/skills-commands';
export * from './ui/skill-tree-items';

// Parsers
export * from './parsers/skill-metadata-parser';
```

**Files to create:**
- `src/shortcuts/skills/index.ts`

---

## Configuration Schema

### VSCode Settings (package.json)

```json
"workspaceShortcuts.skills.enabled": {
  "type": "boolean",
  "default": true,
  "description": "Enable or disable the Skills feature"
}
```

### Workspace Config (.vscode/shortcuts.yaml)

```yaml
skills:
  enabled: true
  skills:
    deep-planner:
      enabled: true
```

---

## Testing Strategy

### Unit Tests

Create test files:
- `src/test/suite/skills/skill-registry.test.ts` - Test skill discovery
- `src/test/suite/skills/skill-metadata-parser.test.ts` - Test metadata parsing
- `src/test/suite/skills/skills-tree-provider.test.ts` - Test tree provider

### Integration Testing

1. **Manual Testing Steps:**
   - Create a test skill in `.github/skills/test-skill/SKILL.md`
   - Reload extension and verify skill appears in Skills view
   - Click skill to verify execution flow
   - Toggle skill enabled/disabled
   - Use quick palette to access skills

2. **Test Scenarios:**
   - Empty skills directory (no errors)
   - Invalid SKILL.md format (graceful failure)
   - Multiple skills with categories
   - Skill with AI requirements

---

## Verification Checklist

After implementation, verify:

- [ ] Skills tree view appears in Shortcuts sidebar
- [ ] `deep-planner` skill is discovered and shown
- [ ] Clicking skill prepares invocation command
- [ ] Quick palette shows all enabled skills
- [ ] Refresh command updates skills list
- [ ] Toggle command enables/disables skills
- [ ] Configuration persists in shortcuts.yaml
- [ ] No errors in extension host logs
- [ ] Tree view icons match enabled/disabled state
- [ ] Context menus appear correctly

---

## Files Summary

### New Files
1. `src/shortcuts/skills/skill-types.ts` - Type definitions
2. `src/shortcuts/skills/skill-registry.ts` - Discovery system
3. `src/shortcuts/skills/skill-manager.ts` - Lifecycle manager
4. `src/shortcuts/skills/skill-executor.ts` - Execution engine
5. `src/shortcuts/skills/ui/skills-tree-provider.ts` - Tree view
6. `src/shortcuts/skills/ui/skills-commands.ts` - Commands
7. `src/shortcuts/skills/ui/skill-tree-items.ts` - Tree items
8. `src/shortcuts/skills/parsers/skill-metadata-parser.ts` - Parser
9. `src/shortcuts/skills/index.ts` - Module exports

### Modified Files
1. `src/extension.ts` - Add skills initialization (lines ~42, ~110-130)
2. `package.json` - Add views, commands, menus, activation events

---

## Future Enhancements

After initial implementation, consider:

1. **Skill Categories** - Group skills by category in tree view
2. **Skill Settings UI** - Dedicated settings panel for each skill
3. **Skill Templates** - Wizard to create new skills
4. **Skill Marketplace** - Browse and install community skills
5. **Keyboard Shortcuts** - Bind hotkeys to frequently used skills
6. **Skill History** - Track skill executions and results
7. **Direct Execution** - For simple skills, execute without Copilot

---

## Dependencies

All required dependencies already present:
- `js-yaml` - Parse YAML frontmatter ✓
- `@types/node` - File system operations ✓
- `vscode` API - Tree views, commands ✓

No new npm packages needed.

---

## Timeline Estimate

- **Phase 1 (Core)**: 3-4 hours
- **Phase 2 (UI)**: 2-3 hours  
- **Phase 3 (Integration)**: 1-2 hours
- **Phase 4 (Execution)**: 1-2 hours
- **Phase 5 (Testing)**: 2-3 hours

**Total**: ~10-14 hours
