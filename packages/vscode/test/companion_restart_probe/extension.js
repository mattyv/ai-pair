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
    try {
      await test.run()
      ok = true
    } catch (error) {
      console.error("Companion restart assertion failed:", error)
    }
    fs.writeFileSync(resultPath, JSON.stringify({ stage, ok }))
    await vscode.commands.executeCommand("workbench.action.closeWindow")
  })()
}
