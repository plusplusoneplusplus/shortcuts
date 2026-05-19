---
name: excalidraw-diagram
description: Generate, read, and iteratively modify Excalidraw diagrams from natural language descriptions. Use when asked to "create a diagram", "make a flowchart", "visualize a process", "draw a system architecture", "create a mind map", or "iterate on an existing diagram". Supports flowcharts, relationship diagrams, mind maps, system architecture, data flow, swimlane, class, sequence, and ER diagrams. Produces interactive previews inline in chat via `excalidraw://` links.
metadata:
  version: "0.1.0"
---

# Excalidraw Diagram

Create and refine Excalidraw diagrams using the `create_or_update_excalidraw` and `read_excalidraw` tools. Diagrams render inline in chat as interactive previews and can be opened in a dedicated viewer. This skill bundles diagram templates, element/schema references, and Python helper scripts for advanced workflows.

## Attribution

This skill is **inherited and adapted** from the [`excalidraw-diagram-generator`](https://github.com/github/awesome-copilot/tree/main/skills/excalidraw-diagram-generator) skill in [`github/awesome-copilot`](https://github.com/github/awesome-copilot) (MIT-licensed). Credit to the original authors and contributors of that repository for the workflow design, supported diagram type catalog, templates under `templates/`, element/schema references under `references/`, and Python helper scripts under `scripts/`.

Local adaptations on top of the upstream skill:

- Replaced the raw `.excalidraw` file I/O workflow with the in-repo `create_or_update_excalidraw` / `read_excalidraw` tools that write to `~/.coc/repos/<workspaceId>/diagrams/` and return inline `excalidraw://` preview links.
- Reframed templates as starting points to read, mutate, and submit through the tool (rather than as files saved directly to disk).
- Re-scoped the helper scripts as optional advanced-workflow utilities (icon libraries, batch edits) rather than the primary path.

## When to Use This Skill

Use this skill when users request:

- "Create a diagram showing..."
- "Make a flowchart for..."
- "Visualize the process of..."
- "Draw the system architecture of..."
- "Generate a mind map about..."
- "Create an Excalidraw file for..."
- "Show the relationship between..."
- "Diagram the workflow of..."
- "Update / refine / iterate on this diagram..."

**Supported diagram types:**

- **Flowcharts** — sequential processes, workflows, decision trees
- **Relationship Diagrams** — entity relationships, system components, dependencies
- **Mind Maps** — concept hierarchies, brainstorming results, topic organization
- **Architecture Diagrams** — system design, module interactions, data flow
- **Data Flow Diagrams (DFD)** — data flow visualization, data transformation processes
- **Business Flow (Swimlane)** — cross-functional workflows, actor-based process flows
- **Class Diagrams** — object-oriented design, class structures and relationships
- **Sequence Diagrams** — object interactions over time, message flows
- **ER Diagrams** — database entity relationships, data models

## Available Tools

| Tool | Purpose |
|------|---------|
| `create_or_update_excalidraw` | Create a new diagram or fully replace an existing one. Returns an `excalidrawLink` to embed in your response. |
| `read_excalidraw` | Read an existing diagram's full scene JSON before modifying it. |

Diagrams are stored under `~/.coc/repos/<workspaceId>/diagrams/<filename>.excalidraw`. Filenames must not contain path separators or `..`; the `.excalidraw` extension is added automatically if missing.

## Prerequisites

- Clear description of what should be visualized
- Identification of key entities, steps, or concepts
- Understanding of relationships or flow between elements

## Step-by-Step Workflow

### Step 1: Understand the Request

Analyze the user's description to determine:

1. **Diagram type** (flowchart, relationship, mind map, architecture, etc.)
2. **Key elements** (entities, steps, concepts)
3. **Relationships** (flow, connections, hierarchy)
4. **Complexity** (number of elements)

### Step 2: Choose the Appropriate Diagram Type

| User Intent | Diagram Type | Example Keywords |
|-------------|--------------|------------------|
| Process flow, steps, procedures | **Flowchart** | "workflow", "process", "steps", "procedure" |
| Connections, dependencies, associations | **Relationship Diagram** | "relationship", "connections", "dependencies", "structure" |
| Concept hierarchy, brainstorming | **Mind Map** | "mind map", "concepts", "ideas", "breakdown" |
| System design, components | **Architecture Diagram** | "architecture", "system", "components", "modules" |
| Data flow, transformation processes | **Data Flow Diagram (DFD)** | "data flow", "data processing", "data transformation" |
| Cross-functional processes, actor responsibilities | **Business Flow (Swimlane)** | "business process", "swimlane", "actors", "responsibilities" |
| Object-oriented design, class structures | **Class Diagram** | "class", "inheritance", "OOP", "object model" |
| Interaction sequences, message flows | **Sequence Diagram** | "sequence", "interaction", "messages", "timeline" |
| Database design, entity relationships | **ER Diagram** | "database", "entity", "relationship", "data model" |

### Step 3: Extract Structured Information

**For Flowcharts:**
- List of sequential steps
- Decision points (if any)
- Start and end points

**For Relationship Diagrams:**
- Entities/nodes (name + optional description)
- Relationships between entities (from → to, with label)

**For Mind Maps:**
- Central topic
- Main branches (3–6 recommended)
- Sub-topics for each branch (optional)

**For Data Flow Diagrams (DFD):**
- Data sources and destinations (external entities)
- Processes (data transformations)
- Data stores (databases, files)
- Data flows (arrows showing data movement from left-to-right or top-left to bottom-right)
- **Important**: model data flow only, not process execution order

**For Business Flow (Swimlane):**
- Actors/roles (departments, systems, people) — displayed as header columns
- Process lanes (vertical lanes under each actor)
- Process boxes (activities within each lane)
- Flow arrows (connecting process boxes, including cross-lane handoffs)

**For Class Diagrams:**
- Classes with names
- Attributes with visibility (`+`, `-`, `#`)
- Methods with visibility and parameters
- Relationships: inheritance (solid line + hollow triangle), implementation (dashed line + hollow triangle), association (solid line), dependency (dashed line), aggregation (solid line + hollow diamond), composition (solid line + filled diamond)
- Multiplicity notations (`1`, `0..1`, `1..*`, `*`)

**For Sequence Diagrams:**
- Objects/actors (arranged horizontally at top)
- Lifelines (vertical lines from each object)
- Messages (horizontal arrows between lifelines)
- Synchronous messages (solid arrow), asynchronous messages (dashed arrow)
- Return values (dashed arrows)
- Activation boxes (rectangles on lifelines during execution)
- Time flows from top to bottom

**For ER Diagrams:**
- Entities (rectangles with entity names)
- Attributes (listed inside entities)
- Primary keys (underlined or marked with `PK`)
- Foreign keys (marked with `FK`)
- Relationships (lines connecting entities)
- Cardinality: `1:1`, `1:N`, `N:M`
- Junction/associative entities for many-to-many relationships (dashed rectangles)

### Step 4: Start From a Template (Recommended)

This skill ships with starter templates under `templates/`. Read the one closest to the requested diagram type and adapt it instead of authoring scene JSON from scratch.

| Diagram Type | Template |
|--------------|----------|
| Flowchart | `templates/flowchart-template.excalidraw` |
| Relationship | `templates/relationship-template.excalidraw` |
| Mind Map | `templates/mindmap-template.excalidraw` |
| Data Flow (DFD) | `templates/data-flow-diagram-template.excalidraw` |
| Swimlane | `templates/business-flow-swimlane-template.excalidraw` |
| Class | `templates/class-diagram-template.excalidraw` |
| Sequence | `templates/sequence-diagram-template.excalidraw` |
| ER | `templates/er-diagram-template.excalidraw` |

Open the template, copy its scene JSON, mutate the elements (positions, text, colors, IDs) to match the user request, and submit through `create_or_update_excalidraw`.

### Step 5: Generate the Excalidraw Scene JSON

Construct the scene with appropriate elements:

**Available element types:**
- `rectangle` — boxes for entities, steps, components
- `ellipse` — start/end points, states, emphasis
- `diamond` — decision points
- `arrow` — directional connections
- `line` — non-directional connections, dividers
- `text` — labels, titles, annotations
- `frame` — visual grouping of related elements

**Key properties to set:**
- **Position**: `x`, `y` coordinates
- **Size**: `width`, `height`
- **Style**: `strokeColor`, `backgroundColor`, `fillStyle`
- **Font**: `fontFamily` (`1` = Virgil hand-drawn, `2` = Helvetica, `3` = Cascadia code, `5` = Excalifont)
- **Text**: bound text via `containerId`/`boundElements` (preferred) or standalone `text` elements
- **Connections**: `points` array for arrows; `startBinding`/`endBinding` to attach to shapes

Full scene shape:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": 20
  },
  "files": {}
}
```

For exhaustive per-element properties and examples, read:

- `references/excalidraw-schema.md` — complete schema reference
- `references/element-types.md` — detailed element type specifications

### Step 6: Submit Via Tool and Embed the Link

1. Call `create_or_update_excalidraw` with `filename` (kebab-case, no path separators) and `content` (the full scene JSON).
2. Include the returned `excalidrawLink` (e.g. `excalidraw://ws-abc123/architecture.excalidraw`) verbatim in your response so the chat UI renders the inline preview.
3. Briefly summarise what the diagram shows.

### Step 7: Iterate

To modify an existing diagram:

1. Call `read_excalidraw` with the filename to fetch the current scene JSON.
2. Adjust the elements in memory (add/remove/move/restyle/relabel).
3. Call `create_or_update_excalidraw` with the **full updated scene** — this tool always performs a full replace, never a patch.
4. Include the refreshed `excalidrawLink` in your reply and describe what changed.

## Best Practices

### Element Count Guidelines

| Diagram Type | Recommended Count | Maximum |
|--------------|-------------------|---------|
| Flowchart steps | 3–10 | 15 |
| Relationship entities | 3–8 | 12 |
| Mind map branches | 4–6 | 8 |
| Mind map sub-topics per branch | 2–4 | 6 |
| Total elements per diagram | < 30 | 50 |

### Layout Tips

1. **Grid alignment** — snap elements to a 20px grid; prefer round coordinates.
2. **Spacing** — leave at least 60px between shapes horizontally, 40px vertically. For complex diagrams use 200–300px horizontal gaps and 100–150px vertical gaps.
3. **Flow direction** — prefer left-to-right for pipelines/sequences, top-to-bottom for hierarchies.
4. **Shape sizing** — rectangles 160–240px wide, 60–100px tall. Keep shapes in the same tier the same size.
5. **Text inside shapes** — bind text to the shape (use `containerId` + `boundElements`); center-align both axes.
6. **Arrow routing** — keep arrows orthogonal when possible. Use intermediate points for L-shaped routes.
7. **Grouping** — use frames or visual proximity to cluster related elements; add a label above each group.
8. **Colors** — use a consistent palette (see below).
9. **Text sizing** — 16–24px body, 28–36px titles.

### Color Palette

| Purpose | Color | Hex |
|---------|-------|-----|
| Blue fill (primary) | Light blue | `#a5d8ff` |
| Green fill (process) | Light green | `#b2f2bb` |
| Yellow fill (highlight/central) | Light yellow | `#ffec99` / `#ffd43b` |
| Red fill (warning) | Light red | `#ffc9c9` |
| Purple fill | Light purple | `#d0bfff` |
| Orange fill | Light orange | `#ffd8a8` |
| Gray fill | Light gray | `#e9ecef` |
| White fill | White | `#ffffff` |
| Default stroke | Dark gray | `#1e1e1e` |
| Background | White | `#ffffff` |

### ID & Seed Generation

Every element must have a unique `id` and `seed`:

- `id`: random 8+ character alphanumeric string (e.g. `"a1b2c3d4"`).
- `seed`: random positive integer.

### Complexity Management

If a request implies too many elements:

- Suggest breaking it into multiple diagrams.
- Focus on main elements first.
- Offer to create detailed sub-diagrams.

**Example response:**

```
"Your request includes 15 components. For clarity, I recommend:
1. High-level architecture diagram (6 main components)
2. Detailed diagram for each subsystem

Would you like me to start with the high-level view?"
```

## Example Prompts and Responses

### Example 1: Simple Flowchart

**User:** "Create a flowchart for user registration"

**Agent workflow:**
1. Extract steps: "Enter email" → "Verify email" → "Set password" → "Complete".
2. Read `templates/flowchart-template.excalidraw` as a starting point.
3. Mutate to 4 rectangles + 3 arrows with the step labels.
4. Call `create_or_update_excalidraw` with `filename: "user-registration-flow"`.
5. Include the returned `excalidrawLink` in the response with a one-line summary.

### Example 2: Relationship Diagram

**User:** "Diagram the relationship between User, Post, and Comment entities"

**Agent workflow:**
1. Entities: `User`, `Post`, `Comment`.
2. Relationships: `User → Post` ("creates"), `User → Comment` ("writes"), `Post → Comment` ("contains").
3. Adapt `templates/relationship-template.excalidraw`.
4. Submit as `user-content-relationships` and embed the link.

### Example 3: Mind Map

**User:** "Mind map about machine learning concepts"

**Agent workflow:**
1. Center: `Machine Learning`.
2. Branches: `Supervised`, `Unsupervised`, `Reinforcement`, `Deep Learning`.
3. Add sub-topics per branch.
4. Adapt `templates/mindmap-template.excalidraw` and submit as `machine-learning-mindmap`.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Elements overlap | Increase spacing between coordinates |
| Text doesn't fit in boxes | Increase box width or reduce font size |
| Too many elements | Break into multiple diagrams |
| Unclear layout | Use grid (rows/columns) or radial (mind maps) layouts |
| Colors inconsistent | Define a palette upfront based on element role |
| Arrow disconnects from shape after moves | Re-add `startBinding`/`endBinding` with the shape's `id` and matching `boundElements` |
| Inline preview not rendering | Ensure the response text contains the full `excalidrawLink` returned by the tool |

## Advanced Techniques

### Grid Layout (for Relationship Diagrams)

```javascript
const columns = Math.ceil(Math.sqrt(entityCount));
const x = startX + (index % columns) * horizontalGap;
const y = startY + Math.floor(index / columns) * verticalGap;
```

### Radial Layout (for Mind Maps)

```javascript
const angle = (2 * Math.PI * index) / branchCount;
const x = centerX + radius * Math.cos(angle);
const y = centerY + radius * Math.sin(angle);
```

### Auto-Generated IDs

```javascript
const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
```

## Bundled Helper Scripts (Optional)

The `scripts/` directory contains Python 3 helpers for advanced file-based workflows (icon libraries, batch edits of existing `.excalidraw` files). They operate directly on `.excalidraw` files on disk — useful when the user is editing a saved diagram outside the tool, or when you want to compose a complex diagram from a downloaded icon library before submitting it through `create_or_update_excalidraw`.

| Script | Purpose |
|--------|---------|
| `scripts/split-excalidraw-library.py` | Split a downloaded `*.excalidrawlib` file into per-icon JSON files and generate a `reference.md` lookup table |
| `scripts/add-icon-to-diagram.py` | Add an icon from a split library to an existing `.excalidraw` file (handles coordinate transforms and ID collision) |
| `scripts/add-arrow.py` | Append a straight arrow (optionally labeled, styled, colored) between two coordinates in an existing `.excalidraw` file |

See `scripts/README.md` for full usage and `scripts/.gitignore` for excluded local artifacts.

### Icon Libraries

For polished cloud-architecture diagrams (AWS, GCP, Azure, Kubernetes, …):

1. Download a library from <https://libraries.excalidraw.com/> as a `*.excalidrawlib` file.
2. Create `libraries/<icon-set-name>/` next to this skill.
3. Place the downloaded file there and run:
   ```bash
   python scripts/split-excalidraw-library.py libraries/<icon-set-name>/
   ```
4. After the split, use `scripts/add-icon-to-diagram.py` to drop specific icons into a `.excalidraw` file by name.

If no library is installed, fall back to basic shapes (rectangles, ellipses, color coding, text labels) — the diagram is still clear, just less polished.

## Output Format

Always provide in your response:

1. The `excalidrawLink` returned by `create_or_update_excalidraw` (so the inline preview renders).
2. A brief summary of what was created or changed.
3. Element count and diagram type.
4. For iterations, a short delta describing what changed.

**Example summary:**

```
Created: user-workflow.excalidraw
Type: Flowchart
Elements: 7 rectangles, 6 arrows, 1 title text (14 total)

excalidraw://ws-abc123/user-workflow.excalidraw
```

## Validation Checklist

Before sending the response:

- [ ] All elements have unique `id` and `seed` values
- [ ] Coordinates avoid overlap (respect spacing guidelines)
- [ ] Text is readable (font size ≥ 16 for body text)
- [ ] Arrows connect logically; bindings reference real element IDs
- [ ] Colors follow a consistent scheme
- [ ] Scene JSON is valid (object with `type: "excalidraw"`, `elements`, `appState`)
- [ ] Element count is reasonable (< 30 for clarity, hard cap 50)
- [ ] Response includes the `excalidrawLink` from the tool result

## References

- `references/excalidraw-schema.md` — complete Excalidraw JSON schema
- `references/element-types.md` — detailed element type specifications
- `templates/flowchart-template.excalidraw` — basic flowchart starter
- `templates/relationship-template.excalidraw` — relationship diagram starter
- `templates/mindmap-template.excalidraw` — mind map starter
- `templates/data-flow-diagram-template.excalidraw` — DFD starter
- `templates/business-flow-swimlane-template.excalidraw` — swimlane starter
- `templates/class-diagram-template.excalidraw` — class diagram starter
- `templates/sequence-diagram-template.excalidraw` — sequence diagram starter
- `templates/er-diagram-template.excalidraw` — ER diagram starter
- `scripts/README.md` — documentation for bundled Python helper scripts
- `scripts/split-excalidraw-library.py` — split `.excalidrawlib` into per-icon files
- `scripts/add-icon-to-diagram.py` — inject icons into an existing diagram
- `scripts/add-arrow.py` — append a labeled arrow to an existing diagram

## Limitations

- Complex curves are simplified to straight or basic curved lines.
- Hand-drawn roughness is set to default (1) unless overridden.
- No embedded images in auto-generation.
- Recommended maximum: 30 elements per diagram (hard cap 50).
- No automatic collision detection — follow spacing guidelines.
- `create_or_update_excalidraw` always performs a full replace; partial patches are not supported.
