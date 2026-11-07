# Agent working instructions

Use test-driven development: write meaningful failing tests, implement the
change, and run the relevant checks before reporting completion.

Use GPT-6.1 Terra agents to write code and tests. Use GPT-6 Astra agents to
review their work. Resolve review findings and verify the resulting changes.

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
