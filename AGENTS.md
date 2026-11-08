# Agent working instructions

Use test-driven development: write meaningful failing tests, implement the
change, and run the relevant checks before reporting completion.

Use GPT-6.1 Terra agents for code and tests, and GPT-6 Astra agents for review.
The user restored Codex capacity and reported Claude at 99 percent, so this
replaces the temporary Sonnet/Fable assignment. Resolve review findings and
verify the resulting changes. Do not resume Claude requests while its budget
is exhausted unless the user asks.

Give regular progress reports with an approximate percentage complete and ETA.
Explain material delays or uncertainty, and do not report completion until
implementation, review, and verification are finished.

Read `CLAUDE.md` for the repository's additional development guidance.

Record material technical and product choices in `DECISIONS.md`, including
their rationale and important limitations. Update the record when a choice
changes; do not treat it as a substitute for the issue's working notes.

Keep the Archi architecture current: when a change materially affects the
architecture, update the `.archi` source model and generated architecture
exports in the same change, and record how they were verified.

For features borrowed from another repository or PR, first inspect its commits
and trial a merge or cherry-pick in an isolated worktree. Check compatibility,
license/provenance, conflicts and existing tests. Prefer retaining upstream code
and history where compatible. Rewrite only the parts that have a concrete
incompatibility or verified defect, and record that reason before expanding
the implementation. Do not replace current work during a trial.
