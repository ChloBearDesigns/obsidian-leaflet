import { App, Menu, Notice, setIcon } from "obsidian";
import type {
    MarkerIcon,
    DivIconMarker,
    MarkerDivIcon,
    TooltipDisplay,
    MarkerProperties,
    SavedMarkerProperties,
    BaseMapType
} from "../../types";
import { MarkerContextModal } from "src/modals";
import { divIconMarker, markerDivIcon } from "src/map";
import { Layer } from "../layer/layer";
import { popup } from "src/map/popup";
import { MODIFIER_KEY, OBSIDIAN_LEAFLET_POPOVER_SOURCE } from "src/utils";
import { copyToClipboard, formatLatLng } from "src/utils";
import { roundPin, shouldDraw, withinBounds } from "src/utils/notePin";
import type { Pin } from "src/utils/notePin";
import {
    NoteChangedError,
    confirmPinRemoval,
    readNotePin,
    writeNotePin
} from "./notePinIO";

import { LeafletSymbol } from "../utils/leaflet-import";
import t from "src/l10n/locale";
import { icon as faIcon } from "src/utils/icons";
let L = window[LeafletSymbol];

abstract class MarkerTarget {
    abstract text: string;
    abstract display: HTMLElement;
    abstract run(evt: L.LeafletMouseEvent): void;
}

class Text extends MarkerTarget {
    constructor(public text: string) {
        super();
    }
    get display() {
        return createSpan({ text: this.text });
    }
    async run() {}
}

class Link extends MarkerTarget {
    display: HTMLElement;
    get isInternal() {
        return (
            this.app.metadataCache.getFirstLinkpathDest(
                this.text.split(/(\^|\||#)/).shift(),
                ""
            ) != null
        );
    }
    constructor(
        private _text: string,
        private app: App,
        public description?: string
    ) {
        super();
        this.display = this._getDisplay();
    }
    get text() {
        return this._text;
    }
    set text(text: string) {
        this._text = text;
        this.display = this._getDisplay();
    }
    private _getDisplay() {
        if (!this.text) return;
        if (this.external)
            return createEl("a", {
                text: this.text,
                href: this.text,
                cls: "external-link"
            });
        if (this.description?.length) {
            const holder = createDiv();
            holder.createSpan({ text: this.description });
            if (this.text?.length) {
                holder.createEl("br");
                holder.createEl("br");
                holder.createSpan({
                    text: this.text
                        .replace(/(\^)/, " > ^")
                        .replace(/#/, " > ")
                        .split("|")
                        .pop(),
                    cls: "internal-link"
                });
            }
            return holder;
        } else {
            return createSpan({
                text: this.text
                    .replace(/(\^)/, " > ^")
                    .replace(/#/, " > ")
                    .split("|")
                    .pop()
            });
        }
    }
    get external() {
        return (
            !this.isInternal &&
            /((?:https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,4}\b(?:[-a-zA-Z0-9@:%_\+.~#?&//=]*))/.test(
                this.text
            )
        );
    }
    async run(evt: L.LeafletMouseEvent) {
        /* if (!this.external) { */
        await this.app.workspace.openLinkText(
            this._text.replace("^", "#^").split(/\|/).shift(),
            this.app.workspace.getActiveFile()?.path ?? "",
            evt.originalEvent.getModifierState(MODIFIER_KEY)
        );
        /* } */
    }
}
class Command extends MarkerTarget {
    display: HTMLElement;
    constructor(private _text: string, private app: App) {
        super();
        this.display = this._getDisplay();
    }
    get text() {
        return this._text;
    }
    set text(text: string) {
        this._text = text;
        this.display = this._getDisplay();
    }
    get exists() {
        return this.app.commands.findCommand(this._text) != null;
    }
    get command() {
        return this.app.commands.findCommand(this._text);
    }
    private _getDisplay() {
        const div = createDiv({
            attr: {
                style: "display: flex; align-items: center;"
            }
        });
        if (this.exists) {
            setIcon(
                div.createSpan({
                    attr: {
                        style: "margin-right: 0.5em; display: flex; align-items: center;"
                    }
                }),
                "run-command"
            );
            div.createSpan({ text: this.command.name });
        } else {
            setIcon(
                div.createSpan({
                    attr: {
                        style: "margin-right: 0.5em; display: flex; align-items: center;"
                    }
                }),
                "cross"
            );
            div.createSpan({ text: t("No command found!") });
        }
        return div;
    }
    run(evt: L.LeafletMouseEvent) {
        if (this.exists) this.app.commands.executeCommandById(this._text);
    }
}

export class Marker extends Layer<DivIconMarker> {
    target: MarkerTarget;
    private _mutable: boolean;
    private _type: string;
    private _command: boolean;
    leafletInstance: DivIconMarker;
    loc: L.LatLng;
    percent: [number, number];
    id: string;
    layer: string;
    minZoom: number;
    maxZoom: number;
    description: string;
    divIcon: MarkerDivIcon;
    displayed: boolean;
    tooltip?: TooltipDisplay;
    popup = popup(this.map, this);
    private _icon: MarkerIcon;
    isBeingHovered: boolean = false;
    private _link: string;
    /** `"frontmatter"`: drawn from a note's `location`; editable and written back to `notePath`. */
    source?: "frontmatter";
    notePath?: string;
    /** The `location` the note held when the map last read or wrote it. */
    private pinOnDisk?: Pin;
    /** Hidden from players: not drawn in player view, ghosted in DM view. */
    hidden: boolean = false;
    constructor(
        public map: BaseMapType,
        {
            id,
            type,
            loc,
            link,
            layer,
            mutable,
            command,
            percent,
            description,
            minZoom,
            maxZoom,
            tooltip,
            source,
            notePath,
            hidden
        }: MarkerProperties
    ) {
        super();
        this.source = source;
        this.notePath = notePath;
        this.hidden = !!hidden;
        const editable = mutable || source === "frontmatter";

        const markerIcon =
            this.map.markerIcons.get(type) ??
            this.map.markerIcons.get("default");
        if (!markerIcon) {
            new Notice(
                t(
                    "Leaflet: Could not create icon for %1 - does this type exist in settings?",
                    type
                )
            );
            return;
        }
        const marker = markerIcon.markerIcon;
        const icon = markerDivIcon(this.map.plugin.parseIcon(marker));
        this.leafletInstance = divIconMarker(
            loc,
            {
                icon,
                keyboard: editable && !this.map.options.lock,
                draggable: editable && !this.map.options.lock,
                bubblingMouseEvents: true
            },
            {
                link: link,
                mutable: `${mutable}`,
                type: type
            }
        );

        this.id = id;
        this.type = type;
        this.loc = loc;
        this.description = description;
        this.layer = layer;
        this.mutable = mutable;
        if (this.source === "frontmatter") {
            this.pinOnDisk = [loc.lat, loc.lng];
        }
        this.command = command;
        this.divIcon = icon;
        this.percent = percent;
        this.tooltip = tooltip;

        if (command) {
            this.target = new Command(link, this.map.plugin.app);
        } else if (link) {
            this.target = new Link(link, this.map.plugin.app, this.description);
        } else if (description) {
            this.target = new Text(this.description);
        }

        this.link = link;

        this.minZoom = minZoom ?? marker?.minZoom ?? null;
        this.maxZoom = maxZoom ?? marker?.maxZoom ?? null;

        this.checkAndAddToMap();

        this.bindEvents();
    }

    get group() {
        return this.mapLayer?.markers[this.type];
    }

    /** False in player view for a hidden marker: it must not be added to the map at all. */
    get drawable() {
        return shouldDraw(this.hidden, this.map.dmView);
    }

    /** Hide from or reveal to players, in this view only (the caller persists it). */
    setHidden(hidden: boolean) {
        if (this.hidden === hidden) return;
        this.hidden = hidden;
        this.refreshDrawn();
        this.map.trigger("hidden-pins-changed");
    }

    /** Re-apply the player/DM-view gate after `hidden` or the map's view changed. */
    refreshDrawn() {
        if (!this.drawable) {
            this.hide();
        } else if (!this.displayed) {
            this.show();
        }
        this.applyGhost();
        for (const overlay of this.map.overlays) {
            if (overlay.id && overlay.id === this.id) overlay.refreshDrawn();
        }
    }

    /**
     * Match dragging to the map's lock. Leaflet only creates `dragging` the first time a
     * marker is drawn, and then from `options.draggable`, so a marker that was off the map
     * when the lock changed (hidden, filtered out, outside its zoom range) has to have its
     * options updated too, and the lock re-applied each time it is drawn.
     */
    private applyLock() {
        const canDrag = this.editable && !this.map.options.lock;
        this.leafletInstance.options.draggable = canDrag;
        this.leafletInstance.options.keyboard = canDrag;
        const dragging = this.leafletInstance.dragging;
        if (!dragging) return;
        if (canDrag) dragging.enable();
        else dragging.disable();
    }

    /**
     * DM view marks hidden pins (faded, with an eye-slash badge) so the DM can tell
     * them apart. Inline styles, so the fork still deploys as `main.js` alone.
     */
    private applyGhost() {
        const el = this.leafletInstance?.getElement?.();
        if (!el) return;
        const ghost = this.hidden && this.map.dmView;
        el.toggleClass("leaflet-hidden-pin", ghost);
        el.style.filter = ghost ? "grayscale(0.7) opacity(0.5)" : "";
        let badge = el.querySelector<HTMLElement>(".leaflet-hidden-pin-badge");
        if (ghost && !badge) {
            badge = el.createSpan({ cls: "leaflet-hidden-pin-badge" });
            badge.setAttr(
                "style",
                "position:absolute;top:-4px;right:-8px;width:12px;height:12px;" +
                    "pointer-events:none;color:var(--text-error, #e93147);"
            );
            badge.appendChild(
                faIcon({ prefix: "fas", iconName: "eye-slash" }).node[0]
            );
        } else if (!ghost && badge) {
            badge.remove();
        }
    }

    /** Context-menu Hide / Reveal: a note-backed marker writes `maphidden`, a plugin-owned one saves. */
    private async toggleHidden() {
        const hidden = !this.hidden;
        if (this.noteBacked) {
            try {
                await writeNotePin(
                    this.map.plugin.app,
                    this.notePath,
                    { hidden },
                    this.pinOnDisk
                );
            } catch (e) {
                this.recoverFromNote(e);
                return;
            }
            this.setHidden(hidden);
            return;
        }
        this.setHidden(hidden);
        this.map.trigger("marker-updated", this);
        this.map.trigger("should-save");
    }
    private bindEvents() {
        this.leafletInstance
            .on("add", () => this.applyGhost())
            .on("contextmenu", (evt: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(evt);
                if (evt.originalEvent.getModifierState("Shift")) {
                    this.map.beginOverlayDrawingContext(evt, this);
                    return;
                }
                if (!this.editable) {
                    new Notice(
                        t(
                            "This marker cannot be edited because it was defined in the code block."
                        )
                    );
                    return;
                }

                const menu = new Menu();
                menu.setNoIcon();

                menu.addItem((item) => {
                    item.setTitle(t("Edit Marker")).onClick(() =>
                        this.editMarker()
                    );
                });
                menu.addItem((item) => {
                    item.setTitle(
                        this.hidden ? "Reveal to players" : "Hide from players"
                    ).onClick(() => this.toggleHidden());
                });
                if (this.noteBacked) {
                    menu.addItem((item) => {
                        item.setTitle(t("Delete Marker")).onClick(() =>
                            this.deleteFromNote()
                        );
                    });
                    menu.showAtMouseEvent(evt.originalEvent);
                    return;
                }
                menu.addItem((item) => {
                    item.setTitle(t("Convert to Code Block")).onClick(
                        async () => {
                            this.mutable = false;

                            this.map.trigger("create-immutable-layer", this);

                            this.map.trigger("should-save");
                        }
                    );
                });
                menu.addItem((item) => {
                    item.setTitle(t("Delete Marker")).onClick(() => {
                        this.map.removeMarker(this);
                    });
                });
                menu.showAtMouseEvent(evt.originalEvent);
            })
            .on("dblclick", (evt) => {
                if (!this.editable) {
                    new Notice(
                        t(
                            "This marker cannot be edited because it was defined in the code block."
                        )
                    );
                    return;
                }
                L.DomEvent.stopPropagation(evt);
                this.editMarker();
            })
            .on("click", async (evt: L.LeafletMouseEvent) => {
                if (this.map.isDrawing || this.map.controller.isDrawing) {
                    this.map.onMarkerClick(this, evt);
                    return;
                }

                L.DomEvent.stopPropagation(evt);

                if (
                    evt.originalEvent.getModifierState("Alt") ||
                    evt.originalEvent.getModifierState("Shift")
                ) {
                    this.map.onMarkerClick(this, evt);
                    const latlng = formatLatLng(this.latLng);
                    this.popup.open(`[${latlng.lat}, ${latlng.lng}]`);

                    if (
                        this.map.data.copyOnClick &&
                        evt.originalEvent.getModifierState(MODIFIER_KEY)
                    ) {
                        await copyToClipboard(this.loc);
                    }

                    return;
                }
                if (this.target) {
                    this.target.run(evt);
                }
            })
            .on("dragstart", (evt: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(evt);
            })
            .on("drag", (evt: L.LeafletMouseEvent) => {
                this.map.trigger("marker-dragging", this);
                if (this.tooltip === "always" && this.popup) {
                    this.popup.setLatLng(evt.latlng);
                } else if (this.popup.isOpen()) {
                    this.popup.setLatLng(evt.latlng);
                }
            })
            .on("dragend", (evt: L.LeafletMouseEvent) => {
                if (this.noteBacked) {
                    this.dropNoteBacked();
                    return;
                }
                const old = this.loc;
                this.setLatLng(this.leafletInstance.getLatLng());
                this.map.trigger("marker-data-updated", this, old);
            })
            .on("mouseover", (evt: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(evt);
                this.isBeingHovered = true;

                if (this.target) {
                    this.popup.open(this.target.display);
                }
                if (this.map.data.notePreview && this.link) {
                    this.map.plugin.app.workspace.trigger("hover-link", {
                        event: evt.originalEvent,
                        source: this.map.plugin.manifest.id,
                        hoverParent: {
                            state: { source: OBSIDIAN_LEAFLET_POPOVER_SOURCE }
                        },
                        targetEl: this.leafletInstance.getElement(),
                        linktext: this.link
                            .replace("^", "#^")
                            .split("|")
                            .shift(),
                        state: { source: OBSIDIAN_LEAFLET_POPOVER_SOURCE }
                    });
                }
            })
            .on("mouseout", (evt: L.LeafletMouseEvent) => {
                this.leafletInstance.closeTooltip();
                this.isBeingHovered = false;
            });
        this.map.leafletInstance.on("zoomanim", (evt: L.ZoomAnimEvent) => {
            //check markers
            if (this.shouldShow(evt.zoom)) {
                this.map.leafletInstance.once("zoomend", () => this.show());
            } else if (this.shouldHide(evt.zoom)) {
                this.hide();
            }
        });
        this.map.on("lock", () => {
            if (!this.editable) return;
            this.registerForShow(() => this.applyLock());
        });

        this.map.leafletInstance.on(
            "baselayerchange",
            (layer: L.LayersControlEvent) => {
                if (!(layer.layer as L.LayerGroup).hasLayer(this.group)) {
                    this.hide();
                } else {
                    this.show();
                }
            }
        );
    }
    /** True when this marker's source of truth is a note's `location` frontmatter. */
    get noteBacked() {
        return this.source === "frontmatter" && !!this.notePath;
    }
    /** Draggable / editable on the map: plugin-owned markers and note-backed ones. */
    get editable() {
        return this.mutable || this.noteBacked;
    }

    /** Snap the marker back to `pin` without writing anything. */
    private snapTo(pin: Pin) {
        const latlng = L.latLng(pin[0], pin[1]);
        this.loc = latlng;
        this.leafletInstance.setLatLng(latlng);
        this.pinOnDisk = pin;
    }

    /** A note-backed marker was dropped: validate, write the note, or snap back. */
    private async dropNoteBacked() {
        const app = this.map.plugin.app;
        const dropped = this.leafletInstance.getLatLng();
        const pin = roundPin([dropped.lat, dropped.lng]);

        if (this.map.type === "image") {
            const b = this.map.bounds;
            const inside = withinBounds(
                [pin[0] - b.getSouth(), pin[1] - b.getWest()],
                {
                    height: b.getNorth() - b.getSouth(),
                    width: b.getEast() - b.getWest()
                }
            );
            if (!inside) {
                new Notice("That is outside the map. The pin was not moved.");
                this.snapTo(this.pinOnDisk);
                return;
            }
        }

        try {
            await writeNotePin(app, this.notePath, { location: pin }, this.pinOnDisk);
            this.snapTo(pin);
        } catch (e) {
            this.recoverFromNote(e);
        }
    }

    /** The note wins: reload the marker from it and say why the write was refused. */
    private recoverFromNote(e: unknown) {
        const app = this.map.plugin.app;
        const fromNote = readNotePin(app, this.notePath);
        if (fromNote) this.snapTo(fromNote);
        else this.snapTo(this.pinOnDisk);
        new Notice(
            e instanceof NoteChangedError
                ? `The note changed since the map was drawn (${e.message}). Reopen the map to refresh.`
                : `Could not update the note: ${(e as Error)?.message ?? e}`
        );
    }

    /** Delete from the map = remove `location` + `mapmarker` from the note, after confirming. */
    async deleteFromNote() {
        const app = this.map.plugin.app;
        const name = this.notePath.split("/").pop().replace(/\.md$/, "");
        if (!(await confirmPinRemoval(app, name))) return;
        try {
            await writeNotePin(app, this.notePath, { remove: true }, this.pinOnDisk);
        } catch (e) {
            this.recoverFromNote(e);
            return;
        }
        this.map.removeMarker(this);
        this.map.trigger("marker-deleted", this);
    }

    editMarker() {
        let markerSettingsModal = new MarkerContextModal(this, this.map);

        markerSettingsModal.onClose = async () => {
            if (markerSettingsModal.deleted && this.noteBacked) {
                await this.deleteFromNote();
            } else if (markerSettingsModal.deleted) {
                this.map.removeMarker(this);
                this.map.trigger("marker-deleted", this);
            } else {
                this.map.displaying.delete(this.type);
                this.map.displaying.set(
                    markerSettingsModal.tempMarker.type,
                    true
                );
                this.description = markerSettingsModal.tempMarker.description;
                this.link = markerSettingsModal.tempMarker.link;
                this.icon = this.map.markerIcons.get(
                    markerSettingsModal.tempMarker.type
                );
                this.tooltip = markerSettingsModal.tempMarker.tooltip;
                this.minZoom = markerSettingsModal.tempMarker.minZoom;
                this.maxZoom = markerSettingsModal.tempMarker.maxZoom;
                this.command = markerSettingsModal.tempMarker.command;

                if (this.noteBacked) {
                    // Only the marker type is part of the note contract.
                    try {
                        await writeNotePin(this.map.plugin.app, this.notePath, {
                            mapmarker: this.type === "default" ? null : this.type
                        });
                    } catch (e) {
                        new Notice(
                            `Could not update the note: ${(e as Error)?.message ?? e}`
                        );
                    }
                }

                if (
                    this.shouldShow(this.map.leafletInstance.getZoom()) &&
                    !this.displayed
                ) {
                    this.show();
                } else if (
                    this.shouldHide(this.map.leafletInstance.getZoom()) &&
                    this.displayed
                ) {
                    this.hide();
                }

                if (this.tooltip === "always") {
                    this.popup.open(this.target.display);
                } else {
                    this.popup.close();
                }

                this.map.trigger("marker-updated", this);
                this.map.trigger("should-save");
            }
        };
        markerSettingsModal.open();
    }
    get link() {
        return this._link;
    }
    set link(x: string) {
        if (this.leafletInstance.options?.icon) {
            this.leafletInstance.options.icon.setData({
                link: `${x}`
            });
        }
        if (!x || !x.length) {
            if (this.description && this.description.length)
                this.target = new Text(this.description);
            return;
        }
        if (!this.target || this.target instanceof Text) {
            if (this.command) {
                this.target = new Command(x, this.map.plugin.app);
            } else {
                this.target = new Link(
                    x,
                    this.map.plugin.app,
                    this.description
                );
            }
        }
        this._link = x.startsWith("#") ? this.map.options.context + x : x;
        if (this.target) this.target.text = x;
        if (this.popup && this.displayed && this.tooltip === "always")
            this.popup.open(this.target.display);
    }
    get command() {
        return this._command;
    }
    set command(b: boolean) {
        this._command = b;
        if (!this.link) return;
        if (b) {
            this.target = new Command(this.link, this.map.plugin.app);
        } else if (this.link) {
            this.target = new Link(
                this.link,
                this.map.plugin.app,
                this.description
            );
        } else if (this.description) {
            this.target = new Text(this.description);
        }
    }
    get mutable() {
        return this._mutable;
    }
    set mutable(x: boolean) {
        this._mutable = x;
        if (this.leafletInstance.options?.icon) {
            this.leafletInstance.options.icon.setData({
                mutable: `${x}`
            });
        }
    }

    get type() {
        return this._type;
    }
    set type(x: string) {
        this._type = x;
        if (this.leafletInstance.options?.icon) {
            this.leafletInstance.options.icon.setData({
                type: `${x}`
            });
        }
    }
    set icon(x: MarkerIcon) {
        this.type = x.type;
        this._icon = x;
        this.leafletInstance.setIcon(x.icon);
        this.applyGhost();
    }
    get latLng() {
        return this.loc;
    }

    get display() {
        const ret = [this.link];
        if (this.description) {
            ret.unshift(`${this.description} `, "(");
            ret.push(")");
        }
        return ret.join("");
    }

    setLatLng(latlng: L.LatLng) {
        this.loc = latlng;

        if (this.map.rendered && this.map.type === "image") {
            let { x, y } = this.map.leafletInstance.project(
                this.loc,
                this.map.zoom.max - 1
            );
            this.percent = [
                x / this.map.currentGroup.dimensions[0],
                y / this.map.currentGroup.dimensions[1]
            ];
        }
        this.leafletInstance.fire("drag", { latlng });
        this.leafletInstance.setLatLng(latlng);
    }

    show() {
        if (
            this.drawable &&
            this.shouldShow(this.map.getZoom()) &&
            this.group &&
            !this.displayed
        ) {
            this.group.addLayer(this.leafletInstance);
            this.displayed = true;
            this.applyLock();
            if (this.tooltip === "always" && this.target) {
                this.leafletInstance.on("add", () => {
                    this.popup.open(this.target.display);
                });
            }
        }
        this.onShow();
    }
    onShow() {}
    shouldShow(zoom: number) {
        if (this.minZoom == this.maxZoom && this.minZoom == null) return true;
        if (!this.displayed) {
            const min = this.minZoom ?? this.map.zoom.min;
            const max = this.maxZoom ?? this.map.zoom.max;
            if (min <= zoom && zoom <= max) {
                return this.map.displaying.get(this.type) ?? true;
            }
        }
        return false;
    }

    hide() {
        if (this.group && this.displayed) {
            this.remove();
            this.displayed = false;
            this.popup.close();
        }
    }
    shouldHide(zoom: number) {
        if (this.displayed) {
            const min = this.minZoom ?? this.map.zoom.min;
            const max = this.maxZoom ?? this.map.zoom.max;
            if (min > zoom || zoom > max) {
                return true;
            }
        }
    }

    static from(map: BaseMapType, properties: MarkerProperties) {
        return new Marker(map, properties);
    }

    toProperties(): SavedMarkerProperties {
        return {
            id: this.id,
            type: this.type,
            loc: [
                this.leafletInstance.getLatLng().lat,
                this.leafletInstance.getLatLng().lng
            ],
            link: this.link,
            layer: this.layer,
            mutable: this.mutable,
            command: this.command,
            percent: this.percent,
            description: this.description,
            minZoom: this.minZoom,
            maxZoom: this.maxZoom,
            tooltip: this.tooltip,
            ...(this.hidden ? { hidden: true } : {})
        };
    }

    toCodeBlockProperties() {
        return [
            this.type,
            this.latLng.lat,
            this.latLng.lng,
            this.link,
            this.description,
            this.minZoom,
            this.maxZoom
        ];
    }

    remove() {
        this.group && this.group.removeLayer(this.leafletInstance);
        if (this.tooltip == "always") {
            this.popup.leafletInstance?.remove();
        }
    }
}
