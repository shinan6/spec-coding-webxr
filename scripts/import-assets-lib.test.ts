import { describe, expect, it } from "vitest";
import {
  buildAttributionMarkdown,
  getAssetManifest,
  validateManifest
} from "./import-assets-lib.mjs";

describe("import asset manifest", () => {
  it("contains the expected local filenames", () => {
    const manifest = getAssetManifest();
    const names = manifest.map((entry) => entry.fileName);

    expect(names).toEqual([
      "player-car.glb",
      "traffic-car-a.glb",
      "traffic-car-b.glb",
      "traffic-car-c.glb"
    ]);
  });

  it("passes manifest validation for https URLs and unique names", () => {
    expect(validateManifest(getAssetManifest())).toEqual([]);
  });

  it("builds attribution markdown containing source and license entries", () => {
    const markdown = buildAttributionMarkdown(getAssetManifest());

    expect(markdown).toContain("# Imported Vehicle Assets");
    expect(markdown).toContain("player-car.glb");
    expect(markdown).toContain("License");
    expect(markdown).toContain("Source");
  });
});
