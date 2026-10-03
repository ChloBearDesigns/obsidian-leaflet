import { BaseMapType } from "../types";
import { FontAwesomeControl, FontAwesomeControlOptions } from "./controls";

/**
 * DM View toggle (plans/leaflet-hidden-pins.md §2 in funky-dnd-mcp). Shows hidden
 * pins, ghosted, in this view only. Drawn only while the map has a hidden pin; the
 * setting is never saved, so every map starts in player view.
 */
export class HiddenPinsControl extends FontAwesomeControl {
    map: BaseMapType;
    constructor(opts: FontAwesomeControlOptions, map: BaseMapType) {
        super(opts, map.leafletInstance);
        this.map = map;
        this.map.on("hidden-pins-changed", () => this.update());
        this.map.on("markers-updated", () => this.update());
    }
    added() {
        this.update();
    }
    onClick(evt: MouseEvent) {
        evt.preventDefault();
        this.map.setDmView(!this.map.dmView);
    }
    setState(dmView: boolean) {
        this.setIcon(dmView ? "eye" : "eye-slash");
        this.setTooltip(
            dmView
                ? "Hide hidden pins (player view)"
                : "Show hidden pins (DM view)"
        );
        this.controlEl.toggleClass("is-dm-view", dmView);
    }
    /** Inline display, so the fork still deploys as `main.js` alone. */
    update() {
        this.controlEl.style.display = this.map.hasHiddenPins ? "" : "none";
    }
}

export function hiddenPinsControl(opts: L.ControlOptions, map: BaseMapType) {
    const options: FontAwesomeControlOptions = {
        ...opts,
        icon: "eye-slash",
        cls: "leaflet-control-hidden-pins",
        tooltip: "Show hidden pins (DM view)"
    };
    return new HiddenPinsControl(options, map);
}
