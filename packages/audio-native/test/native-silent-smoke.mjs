import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createInterface } from "node:readline"

// Only zero-valued PCM is used. No speech, user device changes, or cloud calls.
const binary = process.argv[2]
assert.ok(binary)
const listed = spawnSync(binary, ["--list"], { encoding: "utf8", timeout: 10_000, maxBuffer: 65_536 })
assert.equal(listed.status, 0, "Native device discovery failed")
const catalog = JSON.parse(listed.stdout)
assert.equal(catalog.version, 1)
assert.ok(Array.isArray(catalog.devices))
if (catalog.defaultId === null) {
  console.log("SKIP: no default output endpoint available on this runner")
  process.exit(0)
}
assert.equal(typeof catalog.defaultId, "string")
assert.ok(catalog.devices.some((device) => device.id === catalog.defaultId))

function silentWav() {
  const bytes = Buffer.alloc(44 + 24_000 * 2 * 2)
  bytes.write("RIFF", 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write("WAVEfmt ", 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24_000, 24)
  bytes.writeUInt32LE(48_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  return bytes.toString("base64")
}

async function run(cancel) {
  const child = spawn(binary, ["--play"], { stdio: ["pipe", "pipe", "ignore"] })
  const lines = createInterface({ input: child.stdout })
  const pending = []
  let wake
  lines.on("line", (line) => {
    pending.push(JSON.parse(line))
    wake?.()
  })
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  const timer = setTimeout(() => child.kill(), 12_000)
  let inputSequence = 0
  let outputSequence = 0
  function send(type, data = {}) {
    child.stdin.write(`${JSON.stringify({ version: 1, sequence: inputSequence++, type, ...data })}\n`)
  }
  async function event(type) {
    while (pending.length === 0) {
      await Promise.race([
        new Promise((resolve) => {
          wake = resolve
        }),
        closed.then(() => {
          throw new Error("Helper closed before expected event")
        }),
      ])
      wake = undefined
    }
    assert.deepEqual(pending.shift(), { version: 1, sequence: outputSequence++, type })
  }
  try {
    send("open", { id: catalog.defaultId })
    await event("ready")
    send("play", { wav: silentWav() })
    await event("started")
    send("pause")
    await event("paused")
    if (cancel) {
      child.stdin.end()
      await event("canceled")
    } else {
      send("resume")
      await event("resumed")
      await event("ended")
      child.stdin.end()
    }
    await event("retired")
    assert.equal(await closed, 0)
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill()
  }
}

await run(false)
await run(true)
console.log("PASS: silent native playback drained; pause/resume and paused EOF retired")
