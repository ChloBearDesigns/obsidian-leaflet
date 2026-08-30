# Pop-out window drag patch

This fork carries one local change on top of upstream `obsidian-leaflet`
(`javalent/obsidian-leaflet`): a patch to the bundled `leaflet@1.7.1` that makes
map panning and marker dragging work when a Leaflet map is displayed in an
**Obsidian pop-out window** — either the core "Move to new window" / "Open in
new window" feature or the **Second Window** plugin (`image-window`), which both
call `workspace.openPopoutLeaf()`.

The change lives entirely in `patches/leaflet+1.7.1.patch` and is re-applied on
every `npm install` by the `postinstall` hook (`patch-package`). No plugin
source (`src/`) is modified.

Upstream tracking issue: <https://github.com/javalent/obsidian-leaflet/issues/421>
("Unable to pan map or move markers in second window").

## Symptoms

In a pop-out window:

- The map zooms (wheel, `+`/`-`) but will not pan by click-drag. The cursor
  shows the "grab" hand.
- Markers cannot be dragged.
- Once a pop-out drag has been attempted, **the same map in the main window also
  stops panning** until the app is reloaded.

## Root causes (three, stacked)

A pop-out window is a separate Electron `BrowserWindow` with its own `window`
and `document`. The bundled Leaflet was written against a single global
`window`/`document`, so several things break at once:

1. **Pointer-event shim binds to the main window.**
   Chromium/Electron always exposes `window.PointerEvent`, so
   `L.Browser.pointer` (and therefore `L.Browser.touch`) is `true` and Leaflet
   routes drag interactions through `DomEvent.Pointer`. That shim registers its
   `_globalPointerMove` / `_globalPointerUp` handlers on the **main window's**
   `document`. Events in the pop-out never reach them, so `Draggable._onMove`
   runs with a zero delta and nothing moves. (This is why panning works in the
   main window — that is where the global listeners live.)

2. **`Draggable` binds move/end on the module-global `document`.**
   `Draggable._onDown` does `on(document, MOVE[e.type], …)` /
   `on(document, END[e.type], …)`, and `finishDrag()` unbinds from the same
   global `document`. When the dragged element is in the pop-out, that is the
   wrong document: `_onMove` never fires, and — because `finishDrag()` never
   runs — `Draggable._dragging` is never cleared, which then blocks dragging on
   *every* Leaflet map until reload.

3. **`requestAnimFrame` is bound to the main window.**
   `Draggable._onMove` schedules the actual pane transform
   (`_updatePosition → setPosition`) via `L.Util.requestAnimFrame`, which calls
   `requestFn.call(window, …)` on the main window. If the pop-out is on a second
   monitor and fully covers the main window, Chromium suspends the main window's
   animation frames and the pane never moves even though `mousemove` events keep
   arriving.

## What the patch does

All in `src/dom/Draggable.js` and `src/core/Browser.js` of the bundled Leaflet:

| # | Change | Effect |
|---|--------|--------|
| 1 | `Browser.pointer = false`, `Browser.touch = false` | Leaflet uses the plain `mousedown`/`mousemove`/`mouseup` path; the pointer/touch shim is never engaged. Desktop-only plugin; browsers still synthesise mouse events for touchscreen input. |
| 2 | `Draggable._onDown` binds `_onMove`/`_onUp` on **every** relevant document — `document`, `element.ownerDocument`, `element.getRootNode()` — de-duplicated, and records the set. `finishDrag()` unbinds from all of them and also clears `leaflet-dragging` on the pop-out `<body>`. | The pop-out's `mousemove`/`mouseup` reach `Draggable`; `finishDrag()` always runs, so `Draggable._dragging` is always cleared. |
| 3 | `Draggable._onMove` schedules `_updatePosition` on `element.ownerDocument.defaultView.requestAnimationFrame` (fallback: synchronous). `finishDrag()` cancels on that window and flushes a final `_updatePosition()`. | The pane transform runs on the visible pop-out window's frame clock. |
| — | `Draggable._onDown` also calls `on(win, 'dragstart', preventDefault)` for each involved window (undone in `finishDrag()`). | `disableImageDrag()` only covers the main window; this stops a native image drag hijacking the gesture in the pop-out. |

## Upgrading Leaflet / rebasing on upstream

1. `npm install` (or bump `leaflet` in `package.json`).
2. If the `leaflet` version changed, `patches/leaflet+1.7.1.patch` will fail to
   apply — delete it, re-apply the four changes above by hand against the new
   source (they are small and clearly commented with `obsidian-leaflet pop-out
   patch`), then `npx patch-package leaflet`.
3. `npm run build`, copy `main.js` into
   `<vault>/.obsidian/plugins/obsidian-leaflet-plugin/`.

## Toward an upstream fix

Changes 2 and 3 are genuine cross-window correctness fixes and are candidates
for a PR to `Leaflet/Leaflet` (they still apply in spirit to Leaflet 1.9.x):
bind on `this._element.ownerDocument` instead of `document`, and drive the drag
frame loop from `this._element.ownerDocument.defaultView`.

Change 1 is a **workaround, not an upstream fix** — the correct upstream fix is
to make `DomEvent.Pointer`'s global listeners multi-document aware (register
them on the target element's `ownerDocument`). Until then, forcing the mouse
path is the pragmatic option for a desktop Electron host.
