import { stageAssets } from "../src/stage.ts"

const [source, extensionRoot, mode] = process.argv.slice(2)
if (!source || !extensionRoot || (mode !== undefined && mode !== "--universal") || process.argv.length > 5) {
  throw new Error("Usage: node stage.mjs <artifact-directory> <companion-root> [--universal]")
}
await stageAssets(source, extensionRoot, mode === "--universal")
