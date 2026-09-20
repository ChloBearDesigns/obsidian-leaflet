import { App, Modal, Setting, TFile } from "obsidian";
import {
    applyPinToFrontmatter,
    flowLocationInText,
    pinsEqual
} from "src/utils/notePin";
import type { Pin, PinChange } from "src/utils/notePin";

/** The note moved, vanished, or its `location` no longer matches what the map drew. */
export class NoteChangedError extends Error {}

function fileFor(app: App, notePath: string): TFile {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
        throw new NoteChangedError(`Note not found: ${notePath}`);
    }
    return file;
}

/** The note's current `location`, from Obsidian's metadata cache (no file read). */
export function readNotePin(app: App, notePath: string): Pin | null {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return null;
    const loc = app.metadataCache.getFileCache(file)?.frontmatter?.location;
    if (
        !Array.isArray(loc) ||
        loc.length !== 2 ||
        typeof loc[0] !== "number" ||
        typeof loc[1] !== "number"
    ) {
        return null;
    }
    return [loc[0], loc[1]];
}

/**
 * Write a pin change into a note's frontmatter, leaving every other key alone.
 * When `expected` is given, refuses (NoteChangedError) if the note's `location`
 * is not what the map last saw — the note wins over a stale drag.
 */
export async function writeNotePin(
    app: App,
    notePath: string,
    change: PinChange,
    expected?: Pin
): Promise<void> {
    const file = fileFor(app, notePath);
    await app.fileManager.processFrontMatter(file, (fm) => {
        if (expected) {
            const cur = fm.location;
            const ok =
                Array.isArray(cur) &&
                cur.length === 2 &&
                pinsEqual([Number(cur[0]), Number(cur[1])], expected);
            if (!ok) throw new NoteChangedError("The note's location changed.");
        }
        applyPinToFrontmatter(fm, change);
    });
    // Obsidian writes numeric lists in block style; keep pins as `location: [lat, lng]`.
    if (change.location) {
        await app.vault.process(file, flowLocationInText);
    }
}

/** Confirmation before a map delete removes `location` + `mapmarker` from a note. */
export function confirmPinRemoval(app: App, noteName: string): Promise<boolean> {
    return new Promise((resolve) => {
        const modal = new Modal(app);
        let answered = false;
        const answer = (value: boolean) => {
            answered = true;
            resolve(value);
            modal.close();
        };
        modal.titleEl.setText("Remove map pin?");
        modal.contentEl.createEl("p", {
            text: `This removes "location" and "mapmarker" from the note "${noteName}". Nothing else in the note changes.`
        });
        new Setting(modal.contentEl)
            .addButton((b) => b.setButtonText("Cancel").onClick(() => answer(false)))
            .addButton((b) =>
                b.setButtonText("Remove pin").setWarning().onClick(() => answer(true))
            );
        modal.onClose = () => {
            if (!answered) resolve(false);
        };
        modal.open();
    });
}
