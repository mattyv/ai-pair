// A synthetic installed companion that refuses every preparation.
const vscode = require("vscode")
exports.activate = (context) => {
  const stats = { prepare: 0, commit: 0, preview: 0 }
  context.subscriptions.push(
    vscode.commands.registerCommand("aiPair.localAudio.prepare", () => {
      stats.prepare++
      return undefined
    }),
    vscode.commands.registerCommand("aiPair.localAudio.commit", () => {
      stats.commit++
      return false
    }),
    vscode.commands.registerCommand("aiPair.localAudio.preview", () => {
      stats.preview++
    }),
    vscode.commands.registerCommand("aiPair.localAudio.syntheticStats", () => ({ ...stats })),
  )
}
