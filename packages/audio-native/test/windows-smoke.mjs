import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

// An unknown endpoint must fail closed; this never starts a stream.
const helper = process.argv[2]
assert.ok(helper)
const input = `${JSON.stringify({ version: 1, sequence: 0, type: "open", id: "ai-pair-nonexistent-device-00000000" })}\n`
const result = spawnSync(helper, ["--play"], { input, encoding: "utf8", timeout: 10_000, maxBuffer: 4096 })
assert.notEqual(result.status, 0)
assert.deepEqual(
  result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)),
  [
    { version: 1, sequence: 0, type: "failed" },
    { version: 1, sequence: 1, type: "retired" },
  ],
)
