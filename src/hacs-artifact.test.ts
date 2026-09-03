import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(projectRoot, "hacs.json"), "utf8"));
const artifactPath = resolve(projectRoot, manifest.filename);
const artifact = readFileSync(artifactPath, "utf8");
const releaseWorkflow = readFileSync(resolve(projectRoot, ".github/workflows/release.yml"), "utf8");

describe("release download artifact", () => {
  it("keeps the exact filename used by HACS and hacs-downloads", () => {
    expect(manifest.filename).toBe("frigate-delivery-card.js");
    expect(statSync(artifactPath).size).toBeGreaterThan(0);
    expect(releaseWorkflow).toMatch(/gh release upload[\s\S]*frigate-delivery-card\.js/);
  });

  it("ships a self-contained browser module", () => {
    expect(artifact).toContain('customElements.define("frigate-delivery-card"');
    expect(artifact).not.toMatch(/^\s*import\s/m);
    expect(artifact).not.toMatch(/\sfrom\s+["']\.\//);
  });
});
