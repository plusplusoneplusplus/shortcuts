---
name: excalidraw-diagram
description: Generate, read, and iteratively modify Excalidraw diagrams during conversations. Produces interactive previews inline in chat via excalidraw:// links.
metadata:
  version: "0.0.1"
---

# Excalidraw Diagram

Create and refine Excalidraw diagrams using the `create_or_update_excalidraw` and `read_excalidraw` tools. Diagrams render inline in chat as interactive previews and can be opened in a dedicated viewer.

## When to Use

- The user asks for a diagram, flowchart, architecture sketch, wireframe, sequence diagram, mind map, or any visual illustration.
- You need to visualize relationships, flows, or layouts to explain a concept.
- The user asks to update, refine, or iterate on an existing diagram.

## Available Tools

| Tool | Purpose |
|------|---------|
| `create_or_update_excalidraw` | Create a new diagram or fully replace an existing one. Returns an `excalidrawLink` to embed in your response. |
| `read_excalidraw` | Read an existing diagram's full scene JSON before modifying it. |

## Workflow

1. **Create** — call `create_or_update_excalidraw` with a `filename` and `content` (the Excalidraw scene JSON).
2. **Show** — include the returned `excalidrawLink` (e.g. `excalidraw://ws-abc123/architecture.excalidraw`) in your response text. The chat UI renders it as an interactive preview.
3. **Iterate** — to modify, first call `read_excalidraw` to get the current scene, adjust the elements, then call `create_or_update_excalidraw` with the updated scene (full replace, not a patch).

## Scene JSON Structure

Every diagram is a standard Excalidraw scene object:

```json
{
  "type": "excalidraw",
  "version": 2,
  "elements": [ ... ],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  }
}
```

### Common Element Types

All elements share these base properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier (use a random 8-char alphanumeric string) |
| `type` | string | Element type (see below) |
| `x`, `y` | number | Top-left position in canvas coordinates |
| `width`, `height` | number | Dimensions (not used by arrows/lines) |
| `angle` | number | Rotation in radians (usually `0`) |
| `strokeColor` | string | Border/line color (e.g. `"#1e1e1e"`) |
| `backgroundColor` | string | Fill color (e.g. `"#a5d8ff"`, or `"transparent"`) |
| `fillStyle` | string | `"solid"`, `"hachure"`, `"cross-hatch"` |
| `strokeWidth` | number | Line thickness (`1`, `2`, or `4`) |
| `roughness` | number | `0` = architect (clean), `1` = artist (hand-drawn), `2` = cartoonist |
| `opacity` | number | `0`–`100` |
| `roundness` | object/null | `{ "type": 3 }` for rounded corners, `null` for sharp |
| `isDeleted` | boolean | Always `false` for visible elements |
| `seed` | number | Random integer for roughness rendering |
| `groupIds` | string[] | Groups this element belongs to |
| `boundElements` | array/null | References to bound text/arrows |

#### Rectangle

```json
{
  "type": "rectangle",
  "x": 100, "y": 100,
  "width": 200, "height": 80,
  "backgroundColor": "#a5d8ff",
  "fillStyle": "solid",
  "roundness": { "type": 3 }
}
```

#### Ellipse

```json
{
  "type": "ellipse",
  "x": 400, "y": 100,
  "width": 120, "height": 120,
  "backgroundColor": "#b2f2bb",
  "fillStyle": "solid"
}
```

#### Diamond

```json
{
  "type": "diamond",
  "x": 300, "y": 250,
  "width": 140, "height": 100,
  "backgroundColor": "#ffec99",
  "fillStyle": "solid"
}
```

#### Text

```json
{
  "type": "text",
  "x": 130, "y": 125,
  "width": 140, "height": 25,
  "text": "Service A",
  "fontSize": 20,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle"
}
```

- `fontFamily`: `1` = hand-drawn (Virgil), `2` = normal (Helvetica), `3` = code (Cascadia)
- For text bound inside a shape, add `"containerId": "<shape-id>"` and set `textAlign: "center"`, `verticalAlign: "middle"`.
- On the parent shape, set `"boundElements": [{ "id": "<text-id>", "type": "text" }]`.

#### Arrow

```json
{
  "type": "arrow",
  "x": 300, "y": 140,
  "width": 100, "height": 0,
  "points": [[0, 0], [100, 0]],
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "startBinding": { "elementId": "<source-id>", "focus": 0, "gap": 1, "fixedPoint": null },
  "endBinding": { "elementId": "<target-id>", "focus": 0, "gap": 1, "fixedPoint": null }
}
```

- `points` is relative to `(x, y)`. For a horizontal arrow: `[[0, 0], [length, 0]]`.
- Bind to shapes by setting `startBinding`/`endBinding` with the shape's `id`.
- On bound shapes, add `"boundElements": [{ "id": "<arrow-id>", "type": "arrow" }]`.

#### Line

Same as arrow but `"type": "line"` and no arrowheads.

#### Frame

```json
{
  "type": "frame",
  "x": 50, "y": 50,
  "width": 500, "height": 400,
  "name": "Module Overview"
}
```

Use frames to visually group related elements.

### Color Palette

Use these colors for consistency:

| Purpose | Color | Hex |
|---------|-------|-----|
| Blue fill | Light blue | `#a5d8ff` |
| Green fill | Light green | `#b2f2bb` |
| Yellow fill | Light yellow | `#ffec99` |
| Red fill | Light red | `#ffc9c9` |
| Purple fill | Light purple | `#d0bfff` |
| Orange fill | Light orange | `#ffd8a8` |
| Gray fill | Light gray | `#e9ecef` |
| White fill | White | `#ffffff` |
| Default stroke | Dark gray | `#1e1e1e` |
| Background | White | `#ffffff` |

## Layout Heuristics

Follow these guidelines to produce clean, readable diagrams:

1. **Grid alignment** — snap elements to a 20px grid. Use round coordinates (multiples of 20).
2. **Spacing** — leave at least 60px between shapes horizontally, 40px vertically.
3. **Flow direction** — prefer left-to-right for pipelines/sequences, top-to-bottom for hierarchies.
4. **Shape sizing** — rectangles: 160–240px wide, 60–100px tall. Keep shapes in the same tier the same size.
5. **Text inside shapes** — always bind text to the shape (use `containerId` / `boundElements`). Center-align both axes.
6. **Arrow routing** — keep arrows orthogonal when possible. Use intermediate points for L-shaped routes.
7. **Grouping** — use frames or visual proximity to cluster related elements. Add a label frame above each group.
8. **Max elements** — keep diagrams under 50 elements for readability. Split complex systems into multiple diagrams.
9. **Unique IDs** — generate a random 8-character alphanumeric string for each element's `id` and `seed`.

## ID Generation

Generate element IDs as random 8-character alphanumeric strings (e.g. `"a1b2c3d4"`). Generate `seed` values as random positive integers (e.g. `1234567890`). Every element must have a unique `id` and `seed`.

## Best Practices

- **Read before update**: always call `read_excalidraw` before modifying an existing diagram to get the current state.
- **Full replace**: `create_or_update_excalidraw` replaces the entire file. Include all elements, not just changed ones.
- **Descriptive filenames**: use kebab-case names that describe the diagram content (e.g. `auth-flow`, `system-architecture`, `database-schema`).
- **Include the link**: always include the `excalidrawLink` from the tool result in your response so the user sees the inline preview.
- **Explain the diagram**: briefly describe what the diagram shows alongside the link.
- **Iterate incrementally**: when making changes, describe what you changed so the user can follow along.
- **Keep it simple**: prefer fewer, larger shapes over many small ones. Use whitespace generously.
