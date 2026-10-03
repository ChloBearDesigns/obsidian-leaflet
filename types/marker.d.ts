import { Icon, TooltipDisplay } from ".";
import { MarkerDivIcon } from "./map";
import type { Marker as MarkerDefinition } from "../src/layer/marker";

export type Marker = MarkerDefinition;
export interface MarkerIcon {
    readonly type: string;
    readonly html: string;
    readonly icon: MarkerDivIcon;
    readonly markerIcon: Icon;
}

export interface MarkerProperties {
    id: string;
    type: string;
    loc: L.LatLng;
    link: string;
    layer: string;
    mutable: boolean;
    command: boolean;
    zoom: number;
    percent: [number, number];
    description: string;
    minZoom?: number;
    maxZoom?: number;
    tooltip?: TooltipDisplay;
    /** Drawn from a note's own `location` frontmatter and editable from the map. */
    source?: "frontmatter";
    /** Vault path of the note a `source: "frontmatter"` marker writes back to. */
    notePath?: string;
    /** Not drawn in player view (`maphidden` on the note, or `hidden` in data.json). */
    hidden?: boolean;
}

export interface SavedMarkerProperties {
    type:
        | string
        | {
              icon: string;
              color: string;
              layer: boolean;
          };
    loc: [number, number];
    percent: [number, number];
    id: string;
    link: string;
    layer: string;
    command: boolean;
    mutable: boolean;
    description: string;
    minZoom: number;
    maxZoom: number;
    tooltip: TooltipDisplay;
    source?: "frontmatter";
    notePath?: string;
    /** Not drawn in player view. Saved for plugin-owned markers only when true. */
    hidden?: boolean;
}
