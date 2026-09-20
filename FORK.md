# ChloBearDesigns/obsidian-leaflet — fork notes

A local fork of [`javalent/obsidian-leaflet`](https://github.com/javalent/obsidian-leaflet)
v6.0.5 for the D&D vaults. Two changes sit on top of upstream; upstream is the `upstream` remote.

| Branch | Change |
|---|---|
| `patch/popout-window-drag` | Map pan + marker drag work in Obsidian pop-out windows. See [POPOUT-WINDOW-PATCH.md](POPOUT-WINDOW-PATCH.md). |
| `feat/editable-frontmatter-pins` (stacked on the above) | Note-backed markers editable from the map, and `data.json` save safety. Below. |

## Note-backed markers (`feat/editable-frontmatter-pins`)

Spec: `funky-dnd-mcp/plans/leaflet-editable-pins.md`.

A marker drawn from a `markerFolder` / `markerFile` note whose frontmatter has exactly one
`location: [lat, lng]` (and no `mapmarkers`) is **note-backed** (`source: "frontmatter"`):

- **Drag** it → the note's `location` is rewritten as a flow list of whole pixels. A drop
  outside an image map's bounds snaps back with a notice.
- **Right-click → Edit Marker** → only the marker type; it is written to `mapmarker`
  (choosing "default" removes the key).
- **Right-click → Delete Marker** → after a confirmation, removes `location` and `mapmarker`
  from the note (nothing else).
- If the note's `location` no longer matches what the map last read, the write is refused, the
  marker reloads from the note, and a notice says so — the note wins.
- Note-backed markers are never written to `data.json`.

Everything else keeps the stock behaviour: code-block `marker:` lines, multi-location notes,
`mapmarkers`, `markerTag`, `linksTo/linksFrom` markers stay read-only; plugin-owned (`data.json`)
markers drag, edit and delete as before.

**`data.json` save safety:** the plugin now implements `onExternalSettingsChange`, so a change to
`data.json` made outside Obsidian (a hand edit, a sync) reloads plugin-owned markers into the open
maps instead of being overwritten by the next save. Overlays and drawn shapes are not refreshed by it.

Pure logic lives in `src/utils/notePin.ts`; Obsidian I/O in `src/layer/notePinIO.ts`.

```
npm test          # unit tests for notePin.ts (node's built-in type stripping, Node >= 22.6)
npm run build     # -> main.js
```

## Deploying

Each vault has its own copy of the plugin. After a build, copy `main.js` into **both**
`Vault_Era1/.obsidian/plugins/obsidian-leaflet-plugin/` and `Vault_Main/...`, keeping the previous
one as a `.bak`, then reload Obsidian (or disable/enable the plugin). Do not update Leaflet from the
community-plugin browser: it overwrites the fork.

## Updating to a new upstream release

Upstream is at **v6.0.5** (checked 2026-09-20), the version this fork is based on. When
`javalent/obsidian-leaflet` releases something newer:

1. **Do not** use Obsidian's community-plugin "Update" button — it overwrites `main.js` in that
   vault with stock Leaflet and silently drops both patches. If it happens, rebuild from this repo
   and copy `main.js` back (or restore `main.js.pre-editable-pins.bak`).
2. `git fetch upstream`, then read the upstream changelog for changes to the code the patches touch:
   `src/layer/marker.ts`, `src/renderer/renderer.ts` (`loadImmutableData`, `getImmutableItems`),
   `src/modals/context.ts`, `src/main.ts` (`saveSettings`), and the bundled `leaflet` version.
3. Rebase in order: `patch/popout-window-drag` onto the new upstream tag, then
   `feat/editable-frontmatter-pins` onto that. If the bundled `leaflet` version changed, the
   `patch-package` patch in `patches/` will not apply — regenerate it (see POPOUT-WINDOW-PATCH.md).
4. `npm install && npm test && npm run build`.
5. Copy `main.js` into **both** vaults' `.obsidian/plugins/obsidian-leaflet-plugin/` (keep the old one
   as a `.bak`), then reload the plugin.
6. Re-run the manual checks in `funky-dnd-mcp/plans/leaflet-editable-pins.md`: at minimum fixtures 5
   (drag persists, flow list, nothing in `data.json`), 7, 8, 9 and 12 (pop-out window).
7. Update the "based on" version in this file and in `campaign-ops/memory/project_leaflet-popout-patched-fork.md`.

If upstream ever ships its own fix for pop-out windows (issue #421) or for editing note-backed
markers, prefer dropping the corresponding patch over carrying it.
