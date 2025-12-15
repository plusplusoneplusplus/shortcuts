# Feature Specification: AI Context Clarification Menu

**Feature Branch**: `001-ai-context-clarify`
**Created**: 2025-12-14
**Status**: Draft
**Input**: User description: "I want to add a new feature where a user in the review editor view with a selected section and right click on the mouse, then it will pop up another option to clarify the selected section with the global context and ask some questions. So this would be a different session and core into some command line, for example, co-pilot or cloud or codecs. Can you help to design this feature?"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clarify Selected Section via Context Menu (Priority: P1)

As a user reviewing a document in the review editor, I want to right-click on selected text and choose an option to get AI clarification, so that I can better understand complex sections without leaving my workflow.

**Why this priority**: This is the core functionality that enables AI-assisted document understanding directly from the editor. It provides immediate value by integrating AI clarification into the existing review workflow.

**Independent Test**: Can be fully tested by selecting text in the review editor, right-clicking, choosing "Ask AI" from the context menu, and verifying that an AI assistant receives the selection with document context.

**Acceptance Scenarios**:

1. **Given** a user has text selected in the review editor, **When** they right-click, **Then** the context menu displays an "Ask AI" option alongside existing options (Cut, Copy, Paste, Add Comment).

2. **Given** a user clicks the "Ask AI" option from the context menu, **When** the action is triggered, **Then** the system collects the selected text plus surrounding document context and initiates a clarification session.

3. **Given** a user has no text selected in the review editor, **When** they right-click, **Then** the "Ask AI" option is disabled or hidden (consistent with how "Add Comment" behaves).

---

### User Story 2 - Configure AI Tool Target (Priority: P2)

As a user, I want to configure whether my clarification requests are sent to GitHub Copilot CLI or copied to clipboard, so that I can choose based on my setup and preferences.

**Why this priority**: Different users have different AI tool preferences and subscriptions. Allowing configuration ensures the feature is useful to a broad audience regardless of their AI tooling.

**Independent Test**: Can be fully tested by opening VS Code settings, configuring the preferred AI tool, then triggering "Ask AI" and verifying the correct tool is invoked.

**Acceptance Scenarios**:

1. **Given** a user opens VS Code settings, **When** they search for AI clarification settings, **Then** they can select their preferred AI tool from available options.

2. **Given** a user has configured a specific AI tool, **When** they trigger "Ask AI" from the context menu, **Then** the system routes the request to the configured tool.

3. **Given** a user has not configured any AI tool, **When** they trigger "Ask AI", **Then** the system prompts them to configure a tool or uses a sensible default (clipboard with notification).

---

### User Story 3 - Include Document Context with Selection (Priority: P3)

As a user requesting AI clarification, I want the AI to receive not just my selected text but also relevant surrounding context (file path, document title, nearby sections), so that the AI can provide more accurate and contextual answers.

**Why this priority**: Context-rich queries produce significantly better AI responses. This enhances the quality of the core feature without requiring additional user effort.

**Independent Test**: Can be fully tested by selecting text, triggering "Ask AI", and verifying the prompt sent to the AI includes: the selected text, the file path, document context (surrounding paragraphs or headers), and an instruction to clarify.

**Acceptance Scenarios**:

1. **Given** a user selects text within a document, **When** they trigger "Ask AI", **Then** the generated prompt includes the selected text clearly marked/quoted.

2. **Given** a user selects text under a specific heading, **When** they trigger "Ask AI", **Then** the prompt includes the relevant heading/section title for context.

3. **Given** a user selects text in a markdown file, **When** they trigger "Ask AI", **Then** the prompt includes the file path and overall document structure hints.

---

### Edge Cases

- What happens when the user selects text that spans multiple sections or headings?
  - The system includes all relevant section headers in the context.

- What happens when the configured AI tool is not installed or available?
  - The system falls back to copying the prompt to clipboard and notifies the user with instructions.

- How does the system handle very large selections (e.g., selecting an entire document)?
  - The system truncates context to stay within reasonable prompt limits while preserving the selected text in full. A warning is shown if truncation occurs.

- What happens when the user triggers "Ask AI" in a code block or special element (table, mermaid diagram)?
  - The system preserves the formatting/syntax in the prompt and adds appropriate context about the element type.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST add an "Ask AI" option to the review editor context menu when text is selected.

- **FR-002**: System MUST disable/hide the "Ask AI" option when no text is selected, consistent with existing context menu behavior.

- **FR-003**: System MUST generate a clarification prompt containing: the selected text, surrounding context (headers, paragraphs), file path, and a request for clarification.

- **FR-004**: System MUST support routing clarification requests to configurable AI tools including:
  - GitHub Copilot CLI (via terminal command)
  - Copy to clipboard (fallback/default)

- **FR-005**: System MUST provide VS Code settings for users to configure their preferred AI tool.

- **FR-006**: System MUST gracefully handle cases where the configured AI tool is unavailable by falling back to clipboard copy with user notification.

- **FR-007**: System MUST preserve special formatting (code blocks, tables, mermaid diagrams) when including selected text in the prompt.

- **FR-008**: System MUST limit the total prompt size to 8000 characters maximum, truncating context (not selection) if necessary.

- **FR-009**: System MUST display visual feedback when the "Ask AI" action is triggered (e.g., notification, status message).

### Key Entities

- **ClarificationRequest**: Represents a request for AI clarification containing:
  - Selected text (the text user highlighted)
  - Selection position (line numbers, columns)
  - Document context (surrounding content, headers)
  - File metadata (path, name, type)
  - Target AI tool (where to send the request)

- **AIToolConfiguration**: User's preference for AI tool routing:
  - Tool type (copilot-cli, clipboard)
  - Any tool-specific settings

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can trigger AI clarification in 2 clicks or less (select text, right-click, click option).

- **SC-002**: Time from clicking "Ask AI" to AI tool receiving the prompt is under 2 seconds for typical selections.

- **SC-003**: 90% of clarification prompts successfully reach the configured AI tool without manual intervention.

- **SC-004**: Users can configure their preferred AI tool within 1 minute of discovering the setting.

- **SC-005**: Prompt context improves AI response relevance compared to just sending selected text alone (measured by including file path, section headers, and surrounding paragraphs).

## Clarifications

### Session 2025-12-15

- Q: How should the system invoke Copilot CLI with the clarification prompt? → A: Use `copilot --allow-all-tools -p "<prompt>"`
- Q: What should be the maximum character limit for the generated prompt? → A: 8000 characters

## Assumptions

- Users have VS Code installed with the review editor feature functional.
- GitHub Copilot CLI is available as the `copilot` command and invoked via `copilot --allow-all-tools -p "<prompt>"`.
- The existing context menu infrastructure in the review editor supports adding new menu items.
- The existing prompt generation infrastructure (`prompt-generator.ts`) can be extended for clarification prompts.
- Users understand that AI clarification opens a separate session/window and does not modify the document directly.

## Out of Scope

- Direct AI response integration back into the review editor (responses appear in the AI tool's interface).
- Support for AI tools beyond GitHub Copilot CLI and clipboard copy in the initial release.
- Custom prompt templates or user-editable prompt formats.
- Batch clarification of multiple selections at once.
- AI-generated comments or document modifications.
