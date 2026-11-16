// A normal installed extension drives the same assertions across two launches.
const fs = require("node:fs")
const vscode = require("vscode")
const test = require("./case.cjs")
exports.activate = function () {
  void (async () => {
    const stage = process.env.AI_PAIR_COMPANION_RESTART
    const resultPath = process.env.AI_PAIR_RESTART_RESULT
    if ((stage !== "prepare" && stage !== "verify") || !resultPath) return
    let ok = false
    // A normal window prints no extension host console, so the failure goes in the result.
    let failure
    try {
      await test.run()
      ok = true
    } catch (error) {
      failure = error instanceof Error ? (error.stack ?? error.message) : String(error)
    }
    fs.writeFileSync(resultPath, JSON.stringify({ stage, ok, failure }))
    await vscode.commands.executeCommand("workbench.action.closeWindow")
  })()
}
