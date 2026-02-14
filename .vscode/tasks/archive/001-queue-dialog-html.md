---
status: done
---

# Queue Job Dialog HTML/CSS

Create `src/shortcuts/ai-service/queue-job-dialog.ts` — generates the webview HTML content for the Queue AI Job dialog.

## Requirements

- Follow existing pattern from `ai-task-dialog.ts`
- Tab switching UI: **Prompt** tab and **Skill** tab
- Form fields:
  - Prompt tab: textarea for freeform prompt (required)
  - Skill tab: dropdown for skill selection (required), textarea for additional context (optional)
  - Shared: model dropdown, priority radio group (high/normal/low), working directory input
- Form validation: prompt required in Prompt mode, skill selection required in Skill mode
- Submit and Cancel buttons
- Use VSCode CSS variables for theming (`var(--vscode-*)`)
- Security: use nonce for inline scripts/styles
- Responsive layout

## Reference

- Model after `src/shortcuts/tasks-viewer/ai-task-dialog.ts`
- Use same CSS variable patterns and form group structure
