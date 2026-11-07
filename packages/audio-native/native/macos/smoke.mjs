import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"

// This test enumerates devices and exercises an invalid endpoint only; it plays no audio.
const binary = process.argv[2]
assert.ok(binary)
const list = spawnSync(binary, ["--list"], { encoding: "utf8", timeout: 10_000, maxBuffer: 65_537 })
assert.equal(list.status, 0)
const catalog = JSON.parse(list.stdout)
assert.equal(catalog.version, 1)
assert.ok(Array.isArray(catalog.devices))
assert.ok(catalog.devices.length <= 64)
const input = `${JSON.stringify({ version: 1, sequence: 0, type: "open", id: "ai-pair-missing-device-test-00000000" })}\n`
const invalid = spawnSync(binary, ["--play"], { encoding: "utf8", input, timeout: 10_000, maxBuffer: 4096 })
assert.notEqual(invalid.status, 0)
const events = invalid.stdout
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
assert.deepEqual(events, [
  { version: 1, sequence: 0, type: "failed" },
  { version: 1, sequence: 1, type: "retired" },
])

const eof = spawnSync(binary, ["--play"], { encoding: "utf8", input: "", timeout: 10_000, maxBuffer: 4096 })
assert.equal(eof.status, 0)
assert.deepEqual(
  eof.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)),
  [
    { version: 1, sequence: 0, type: "canceled" },
    { version: 1, sequence: 1, type: "retired" },
  ],
)

for (const badInput of ['{"version":true,"sequence":0,"type":"open","id":"x"}\n', '{"version":1', " ".repeat(2_600_001)]) {
  const bad = spawnSync(binary, ["--play"], { encoding: "utf8", input: badInput, timeout: 10_000, maxBuffer: 4096 })
  assert.notEqual(bad.status, 0)
  assert.deepEqual(
    bad.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [
      { version: 1, sequence: 0, type: "failed" },
      { version: 1, sequence: 1, type: "retired" },
    ],
  )
}

// A short command must be processed while the parent keeps the input pipe open.
const interactive = spawn(binary, ["--play"], { stdio: ["pipe", "pipe", "ignore"] })
let interactiveOutput = ""
interactive.stdout.setEncoding("utf8")
interactive.stdout.on("data", (chunk) => {
  interactiveOutput += chunk
})
const interactiveTimer = setTimeout(() => interactive.kill(), 5000)
const interactiveClosed = new Promise((resolve, reject) => {
  interactive.once("error", reject)
  interactive.once("close", resolve)
})
interactive.stdin.write(`${JSON.stringify({ version: 1, sequence: 0, type: "open", id: "ai-pair-missing-device-test-00000000" })}\n`)
assert.notEqual(await interactiveClosed, 0)
clearTimeout(interactiveTimer)
assert.deepEqual(
  interactiveOutput
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)),
  [
    { version: 1, sequence: 0, type: "failed" },
    { version: 1, sequence: 1, type: "retired" },
  ],
)
