import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
copyFileSync(
  resolve(projectRoot, "dist/frigate-delivery-card.js"),
  resolve(projectRoot, "frigate-delivery-card.js"),
);
