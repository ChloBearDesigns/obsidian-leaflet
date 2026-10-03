/**
 * Pure helpers for note-backed markers: markers drawn from a note's own
 * `location: [lat, lng]` frontmatter that can be edited from the map and written
 * back to that note. No Obsidian or Leaflet imports, so it is unit-testable with
 * `npm test` (plans/leaflet-editable-pins.md in funky-dnd-mcp).
 */

export type Pin = [number, number];

export interface PinBounds {
    height: number;
    width: number;
}

export interface PinChange {
    location?: Pin;
    /** A marker type to write, or `null` to remove `mapmarker`. */
    mapmarker?: string | null;
    /** `true` writes `maphidden: true`; `false` deletes the key (revealed). */
    hidden?: boolean;
    /** Remove `location`, `mapmarker` and `maphidden` (and nothing else). */
    remove?: boolean;
}

/** Whole map pixels — the convention the MCP's `locations` tool validates against. */
export function roundPin(loc: readonly [number, number]): Pin {
    return [Math.round(loc[0]), Math.round(loc[1])];
}

function isPin(value: unknown): value is Pin {
    return (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "number" &&
        typeof value[1] === "number" &&
        Number.isFinite(value[0]) &&
        Number.isFinite(value[1])
    );
}

/**
 * True when a note's frontmatter is a single, plain `[lat, lng]` pin the map can
 * safely rewrite. Multi-location notes, `mapmarkers` lists and non-numeric values
 * stay read-only (the stock plugin behaviour).
 */
export function isEditablePinFrontmatter(
    fm: Record<string, unknown> | null | undefined
): boolean {
    if (!fm) return false;
    if (fm.mapmarkers !== undefined) return false;
    return isPin(fm.location);
}

/** Inside an image map whose origin is [0, 0] and extent is [height, width]. */
export function withinBounds(pin: readonly [number, number], b: PinBounds): boolean {
    return pin[0] >= 0 && pin[0] <= b.height && pin[1] >= 0 && pin[1] <= b.width;
}

export function pinsEqual(a: readonly [number, number], b: readonly [number, number]) {
    return a[0] === b[0] && a[1] === b[1];
}

/** Apply a pin change to a frontmatter object in place; every other key is untouched. */
export function applyPinToFrontmatter(
    fm: Record<string, unknown>,
    change: PinChange
): void {
    if (change.remove) {
        delete fm.location;
        delete fm.mapmarker;
        delete fm.maphidden;
        return;
    }
    if (change.location) fm.location = [change.location[0], change.location[1]];
    if (change.mapmarker === null) delete fm.mapmarker;
    else if (change.mapmarker !== undefined) fm.mapmarker = change.mapmarker;
    if (change.hidden === true) fm.maphidden = true;
    else if (change.hidden === false) delete fm.maphidden;
}

/**
 * Whether a note's `maphidden` value hides its pins from players
 * (plans/leaflet-hidden-pins.md §1 in funky-dnd-mcp). `true` / "true" / "yes" hide;
 * `false` / "false" / "no" / no key show. Anything else hides too: a typo should hide
 * a spoiler, not show it.
 */
export function isHiddenValue(value: unknown): boolean {
    if (value === undefined || value === null || value === false) return false;
    if (value === true) return true;
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (v === "false" || v === "no") return false;
    }
    return true;
}

/** Player view (the default) never draws a hidden pin; DM view draws everything. */
export function shouldDraw(hidden: boolean, dmView: boolean): boolean {
    return !hidden || dmView;
}

/**
 * Obsidian's YAML writer emits numeric lists in block style. Pins are written by the
 * MCP as a flow list (`location: [1705, 729]`); keep the two identical.
 */
export function flowLocationInText(noteText: string): string {
    return noteText.replace(
        /^location:[ \t]*\r?\n[ ]{0,2}- (-?[\d.]+)\r?\n[ ]{0,2}- (-?[\d.]+)$/m,
        "location: [$1, $2]"
    );
}
