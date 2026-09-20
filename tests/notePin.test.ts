import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyPinToFrontmatter,
    flowLocationInText,
    isEditablePinFrontmatter,
    roundPin,
    withinBounds
} from "../src/utils/notePin.ts";

test("roundPin rounds to whole map pixels", () => {
    assert.deepEqual(roundPin([1704.6, 729.4]), [1705, 729]);
    assert.deepEqual(roundPin([1426.5, 727.5]), [1427, 728]);
    assert.deepEqual(roundPin([1705, 729]), [1705, 729]);
});

test("isEditablePinFrontmatter accepts only a single plain [lat, lng]", () => {
    assert.equal(isEditablePinFrontmatter({ location: [1705, 729] }), true);
    assert.equal(isEditablePinFrontmatter({ location: [[1, 2], [3, 4]] }), false);
    assert.equal(isEditablePinFrontmatter({ location: [1] }), false);
    assert.equal(isEditablePinFrontmatter({ location: [1, 2, 3] }), false);
    assert.equal(isEditablePinFrontmatter({ location: [NaN, 1] }), false);
    assert.equal(isEditablePinFrontmatter({ location: ["1", "2"] }), false);
    assert.equal(isEditablePinFrontmatter({ location: "[[Elarion]]" }), false);
    assert.equal(isEditablePinFrontmatter({ location: [1, 2], mapmarkers: [] }), false);
    assert.equal(isEditablePinFrontmatter({}), false);
    assert.equal(isEditablePinFrontmatter(undefined), false);
});

test("withinBounds checks an image map with origin [0, 0]", () => {
    const b = { height: 4608, width: 6144 };
    assert.equal(withinBounds([5000, 100], b), false);
    assert.equal(withinBounds([4608, 6144], b), true);
    assert.equal(withinBounds([0, 0], b), true);
    assert.equal(withinBounds([-1, 10], b), false);
    assert.equal(withinBounds([10, 6145], b), false);
});

test("applyPinToFrontmatter sets the pin and keeps every other key", () => {
    const fm: Record<string, unknown> = { region: "Sapphire Coast", size: "Hamlet", tags: "settlement" };
    applyPinToFrontmatter(fm, { location: [1, 2] });
    assert.deepEqual(fm, { region: "Sapphire Coast", size: "Hamlet", tags: "settlement", location: [1, 2] });
    applyPinToFrontmatter(fm, { mapmarker: "City" });
    assert.equal(fm.mapmarker, "City");
    assert.deepEqual(fm.location, [1, 2]);
});

test("applyPinToFrontmatter remove deletes location and mapmarker only", () => {
    const fm: Record<string, unknown> = { region: "X", location: [1, 2], mapmarker: "City", icon: "city" };
    applyPinToFrontmatter(fm, { remove: true });
    assert.deepEqual(fm, { region: "X", icon: "city" });
});

test("flowLocationInText turns Obsidian's block list into a flow list", () => {
    const block = "---\nregion: X\nlocation:\n  - 1705\n  - 729\nmapmarker: City\n---\nbody\n";
    assert.equal(
        flowLocationInText(block),
        "---\nregion: X\nlocation: [1705, 729]\nmapmarker: City\n---\nbody\n"
    );
    const already = "---\nlocation: [1, 2]\n---\n";
    assert.equal(flowLocationInText(already), already);
    const other = "---\ntags:\n  - a\n  - b\n---\n";
    assert.equal(flowLocationInText(other), other);
});
