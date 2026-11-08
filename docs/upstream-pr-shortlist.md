# Upstream PR shortlist

Saved on 2026-11-07 for later consideration. This is a shortlist based on
PR descriptions and selected diffs, not a completed code review or an
implementation commitment. PR status and branch contents must be checked again
before importing changes.

## Recommended order

1.  **PR #17: Beats and working ahead.** Groups explanations with the code they
   explain, queues work ahead, and improves waiting status and command-result
   delivery. Highest priority because it addresses long pauses and makes output
   easier to follow. Requires protocol changes; adapt it to our existing pace,
   reading, speech, interruption, and typing-mode controls.
   [Upstream PR #17](https://github.com/faiface/ai-pair/pull/17).
2.  **PR #19: Build/Learn modes and panel menus.** Borrow teaching modes, narrow
   panel layout improvements, and clearer command approval prompts selectively.
   Review program-wide command approval separately before adopting it.
   [Upstream PR #19](https://github.com/faiface/ai-pair/pull/19).
3.  **PR #14: Local voice improvements.** Evaluate speech aligned with typing,
   code pronunciation, and pitch-preserving speed adjustment. Extract useful
   pieces into our existing speech implementation rather than replacing it.
   [Upstream PR #14](https://github.com/faiface/ai-pair/pull/14).
4.  **PR #13: Extension-generated edit handling.** Relevant to Pylance inserting
   closing docstring quotes. Review its 300 ms attribution heuristic carefully:
   timing and location alone may not reliably distinguish an extension edit
   from a human edit. Compare with our existing typing safeguards.
   [Upstream PR #13](https://github.com/faiface/ai-pair/pull/13).
5.  **PR #18: Launch agents from the panel.** Starts and configures several agent
   CLIs. Useful convenience feature for later.
   [Upstream PR #18](https://github.com/faiface/ai-pair/pull/18).
6.  **PR #21: Phonon local voice.** Optional additional local speech provider.
   Stabilize existing providers and audio output selection first.
   [Upstream PR #21](https://github.com/faiface/ai-pair/pull/21).

## Deferred

-   **PRs #15 and #16: Staged author/presenter pairing.** A larger redesign using
  private project copies, three-way merging, and a breaking protocol change.
  Evaluate as a separate architecture proposal.
  [PR #15](https://github.com/faiface/ai-pair/pull/15),
  [PR #16](https://github.com/faiface/ai-pair/pull/16).
-   **PR #20: Keyboard sounds.** Cosmetic and lower priority.
  [PR #20](https://github.com/faiface/ai-pair/pull/20).
-   **PR #10: JetBrains support.** Draft at the time of inspection; outside the
  immediate VS Code work.
  [PR #10](https://github.com/faiface/ai-pair/pull/10).

## Import approach

Most candidates form a stacked series. Their PR branches include earlier
changes, so do not merge the whole stack merely to obtain one feature. Use the
isolated comparison links in the PR descriptions, review dependencies, and
extract or adapt individual changes. Begin with selected improvements from
PR #17. Verify current behavior and overlap in our fork before implementation.
