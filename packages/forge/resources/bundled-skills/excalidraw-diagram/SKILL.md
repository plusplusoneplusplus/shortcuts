---
name: excalidraw-diagram
description: Generate, read, and iteratively modify Excalidraw diagrams from natural language descriptions. Use for flowcharts, relationships, mind maps, architecture, data flow, swimlanes, class diagrams, sequence diagrams, and ER diagrams. Produces interactive canvas previews through `canvas://` markers.
metadata:
  version: "0.2.0"
---

# Excalidraw Diagram

Create and refine Excalidraw diagrams with the canvas tools. This skill provides detailed diagram patterns, templates, schema references, and optional Python helpers for users who explicitly want Excalidraw guidance.

## Attribution

This skill is inherited and adapted from the [`excalidraw-diagram-generator`](https://github.com/github/awesome-copilot/tree/main/skills/excalidraw-diagram-generator) skill in [`github/awesome-copilot`](https://github.com/github/awesome-copilot) (MIT-licensed). Credit goes to its authors and contributors for the workflow design, diagram catalog, templates, references, and helper scripts.

## Canvas tools

| Tool | Purpose |
|---|---|
| `write_canvas` | Create an Excalidraw canvas with `type: "excalidraw"`, or fully replace an existing scene using its `canvasId` and `expectedRevision`. |
| `read_canvas` | Read an existing canvas scene and revision before changing it. |

For a new diagram, call `write_canvas` with a clear title, `type: "excalidraw"`, and the complete scene JSON as `content`. The tool returns a `canvas://<id>` marker; include it verbatim in the final reply so the diagram renders inline and can open in the canvas panel.

For an existing diagram:

1. Call `read_canvas` with its canvas ID unless you created that revision in the same turn.
2. Modify the full scene in memory.
3. Call `write_canvas` with the `canvasId`, the revision from the read as `expectedRevision`, and the full updated scene as `content`.
4. If the revision conflicts, read the latest scene and reapply the requested change.
5. Include the returned `canvas://<id>` marker in the reply.

Excalidraw updates are full-scene rewrites, not targeted text edits. Keep the main result in the canvas and the chat response short.

## When to use this skill

Use this skill for:

- Flowcharts and decision trees
- Relationship and dependency diagrams
- Mind maps
- System and software architecture
- Data flow diagrams
- Business processes and swimlanes
- Class and object-model diagrams
- Sequence and interaction diagrams
- Entity-relationship diagrams
- Updates to an existing Excalidraw canvas

## Workflow

### 1. Understand the request

Identify the diagram type, key elements, relationships, direction of flow, and reasonable level of detail. If the request would create an unreadable scene, start with a clear high-level view and offer focused follow-up diagrams.

### 2. Choose a diagram pattern

| Intent | Pattern | Typical signals |
|---|---|---|
| Steps or decisions | Flowchart | workflow, process, procedure |
| Connections or dependencies | Relationship | relationship, dependency, structure |
| Concept hierarchy | Mind map | topics, ideas, breakdown |
| Components and boundaries | Architecture | system, modules, services |
| Data movement and transformation | Data flow | sources, stores, processing |
| Cross-role handoffs | Swimlane | actors, departments, responsibilities |
| Object structure | Class diagram | classes, inheritance, methods |
| Time-ordered interactions | Sequence diagram | messages, calls, timeline |
| Database structure | ER diagram | entities, keys, cardinality |

For data flow diagrams, model data movement rather than execution order. For sequence diagrams, place participants horizontally and time vertically. For ER diagrams, show primary keys, foreign keys, cardinality, and junction entities where needed.

### 3. Start from a bundled template when useful

Read the nearest template and adapt its scene JSON instead of inventing every property from scratch:

| Diagram type | Template |
|---|---|
| Flowchart | `templates/flowchart-template.excalidraw` |
| Relationship | `templates/relationship-template.excalidraw` |
| Mind map | `templates/mindmap-template.excalidraw` |
| Data flow | `templates/data-flow-diagram-template.excalidraw` |
| Swimlane | `templates/business-flow-swimlane-template.excalidraw` |
| Class | `templates/class-diagram-template.excalidraw` |
| Sequence | `templates/sequence-diagram-template.excalidraw` |
| ER | `templates/er-diagram-template.excalidraw` |

Treat templates as optional advanced guidance. Use them when their structure saves work; a small, valid scene can be authored directly.

### 4. Build the scene

The canvas content is Excalidraw scene JSON:

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

Useful element types include `rectangle`, `ellipse`, `diamond`, `arrow`, `line`, `text`, and `frame`. Give every element a unique `id` and positive `seed`. Prefer bound text using `containerId` and `boundElements`, and attach arrows with valid `startBinding` and `endBinding` references.

Read these bundled references when exact element fields are needed:

- `references/excalidraw-schema.md` — complete scene and element schema
- `references/element-types.md` — element-specific examples and properties

### 5. Lay it out clearly

- Snap to a roughly 20-pixel grid and use round coordinates.
- Leave at least 60 pixels horizontally and 40 pixels vertically between shapes; increase this for dense diagrams.
- Prefer left-to-right flow for pipelines and top-to-bottom flow for hierarchies and sequences.
- Keep shapes in the same tier similarly sized; 160–240 pixels wide and 60–100 pixels tall is a useful default.
- Use orthogonal or gently routed arrows and avoid crossing labels.
- Group related elements with frames or proximity.
- Use 16–24 pixel body text and 28–36 pixel titles.

Suggested palette:

| Role | Fill |
|---|---|
| Primary | `#a5d8ff` |
| Process | `#b2f2bb` |
| Highlight | `#ffec99` |
| Warning | `#ffc9c9` |
| Secondary | `#d0bfff` |
| Neutral | `#e9ecef` |

Use `#1e1e1e` for default strokes and `#ffffff` for the background unless the user asks for another theme.

### 6. Write and respond

Call `write_canvas`, then reply with:

- the returned `canvas://<id>` marker;
- one short sentence describing what the diagram shows or what changed.

## Complexity guidance

Aim for 3–10 flow steps, 3–8 relationship entities, 4–6 primary mind-map branches, and fewer than 30 total elements. Treat 50 elements as a practical hard cap. Split a larger request into an overview plus focused diagrams when clarity would otherwise suffer.

## Optional helper scripts

The `scripts/` directory contains Python 3 helpers for advanced local scene preparation:

| Script | Purpose |
|---|---|
| `scripts/split-excalidraw-library.py` | Split an `*.excalidrawlib` file into per-icon JSON and a lookup table. |
| `scripts/add-icon-to-diagram.py` | Add a library icon to a local `.excalidraw` scene while handling transforms and ID collisions. |
| `scripts/add-arrow.py` | Append a styled, optionally labeled arrow to a local scene. |

These helpers prepare scene JSON; submit the final complete scene through `write_canvas`. See `scripts/README.md` for usage. If no icon library is installed, use clear basic shapes and labels.

## Validation checklist

- The content is valid JSON with `type: "excalidraw"`, `elements`, and `appState`.
- IDs and seeds are unique and bindings reference real element IDs.
- Shapes and labels do not overlap.
- Arrows communicate the intended direction and relationship.
- The level of detail remains readable.
- Updates use the latest revision through `expectedRevision`.
- The final reply contains the returned `canvas://<id>` marker.
