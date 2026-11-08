# TLA+ specs

Models of the code's state machines, checked with TLC (issue #19). Run them all
with:

```sh
specs/check.sh            # TLC=<command> to use another TLC; default `tlc`
specs/check.sh --coverage # also counts how often each action fired, to coverage/tla/, and fails on one that never did
```

An action that never fires in any of a spec's configs fails
`check.sh --coverage` unless the spec's section below says so, in a sentence
that names the action in backticks and says it never fires (#161); no spec needs
that today. A spec's other configs are `Spec_<Model>.cfg`, each run against
`Spec.tla`, with its own statistics file (#169): `Discovery_InPlace.cfg` is the
one, where `Focus` and `FinishWrite` fire.

[COVERAGE.md](COVERAGE.md) maps every source file, function by function, to the
spec that models it, or says why it has none.

The specs and their configs follow the
[TLA+ style guide](tlaplus-style-guide.md) (#148). `npm run lint:tla`
(`scripts/lint_tla.ts`) checks the rules a script can check, in CI's `check`
job.

CI runs `check.sh` on every push to `main` and every pull request
(`.github/workflows/ci.yml`), with TLA+ tools 1.8.0. `check.sh` runs TLC on
every `.cfg`. `Spec.cfg` models the code as it
is on `main`, and has to pass. Regressions are caught by the unit and
integration tests. A spec's constants that switch a fix on or off still say
which bug each one fixed; the configs that reproduced those bugs were dropped
once the fixes were in.

## Tools

The TLA+ tools are one jar, `tla2tools.jar`, from the
[tlaplus/tlaplus releases](https://github.com/tlaplus/tlaplus/releases). CI and
local runs use 1.8.0, published 2026-10-06 (GitHub marks it a prerelease).
Check a download against the SHA-256 GitHub lists for it:

```sh
gh api repos/tlaplus/tlaplus/releases/tags/v1.8.0 \
  --jq '.assets[] | select(.name == "tla2tools.jar") | .digest'
shasum -a 256 tla2tools.jar
```

| Tool | Command |
|---|---|
| TLC, the model checker | `java -jar tla2tools.jar -tool -config Foo.cfg Foo.tla` |
| SANY, the parser | `java -cp tla2tools.jar tla2sany.SANY Foo.tla` |
| The formatter | `java -cp tla2tools.jar formatter.Main Foo.tla Out.tla` |

On Justine's Mac the jar is `~/.local/lib/tla2tools.jar`, and
`~/.local/bin/tlc` is the `tlc` command `check.sh` runs: a wrapper for
`java -jar ~/.local/lib/tla2tools.jar -tool`. The VS Code TLA+ extension ships
its own copy of the jar in its `tools/` folder.
The formatter's layout differs from the style guide (2-space indent, spaces
inside `<< >>` and `{ }`), so the specs are not run through it.

## Results

| Config | Bounds | Result | Distinct states |
|---|---|---|---|
| `Serialize.cfg` | `NumCalls = 2` calls, each empty or not, the session ending, an interrupt, and the socket closing at any point | holds | 3,646 |
| `Wire.cfg` | `NumSockets = 2` sockets, `NumCalls = 2` calls | holds | 43,426 |
| `StructuralTyping.cfg` | both operations, closed and opaque field categories, selection and one or two closes | holds | 288 |
| `LineEndGuard.cfg` | rehearsal and live suffix danger, with or without acknowledgment | holds | 22 |
| `BuildIdentity.cfg` | two builds, installing and reloading | holds | 4 |
| `Panel.cfg` | `MaxEvents = 5`, both display orders and the settings dialog | holds | 84 |
| `PanelScroll.cfg` | `MaxEvents = 5`, `ScrollOn = "you"`, both display orders | holds | 108 |
| `PanelReplay.cfg` | `MaxLog = 3`, `MaxEvents = 6` | holds | 127 |
| `Controller.cfg` | `NumBatches = 2` batches, `NumEvents = 1` event, `NumQuietEdits = 1` quiet edit, `MaxCancels = 2` | holds | 82,085 |
| `Discovery.cfg` | `NumWindows = 2` windows, one junk file, a write that may fail, a window that may refuse the hello | holds | 782 |
| `Discovery_InPlace.cfg` | the same, `AtomicWrite = FALSE`: the write in place, so `Focus` and `FinishWrite` fire; `FindsRunningProp` left out | holds | 1,106 |
| `EditorAdapter.cfg` | `MaxChanges = 5` changes, an edit refused, `create`'s save | holds | 3,195 |
| `FollowMode.cfg` | one move to another file, the programmer looking away, `HoldWhileShowing = TRUE`, the file in a visible editor or not | holds | 19 |
| `Bridge.cfg` | `NumSockets = 2` sockets | holds | 76 |
| `Draft.cfg` | `MaxPages = 3` pages, `ClearOnTaken = TRUE` | holds | 12 |
| `RunBox.cfg` | one `run`, the session ending at any point | holds | 10 |
| `FileText.cfg` | one file, `MaxChanges = 4` changes | holds | 123 |
| `Outside.cfg` | one file, `MaxWrites = 5` contents | holds | 614 |
| `Navigator.cfg` | `MaxEdits = 3` | holds | 44 |
| `EditEvents.cfg` | one file, 3 texts, `MaxEdits = 4` | holds | 516 |
| `Scroll.cfg` | `NumLines = 8` lines, a view of `ViewHeight = 4`, `MaxMoves = 2`, `MaxFollowSwitches = 2`, `scrollBeyondLastLine` on and off, the programmer's turn | holds | 14,131 |
| `ProjectGuide.cfg` | every tree of depth 2 over two names, any of its guides ignored by git | holds (`ASSUME`s) | |
| `Resume.cfg` | 2 directories, `MaxSessions = 3`, revive and replacement updates enabled | holds | 56 |
| `TerminalPanel.cfg` | two command IDs and automatic visibility | holds | 61 |
| `DiagnosticsCopy.cfg` | explicit request with clipboard success or failure | holds | 3 |
| `DiagnosticsPrivacy.cfg` | bounded two-event history, copy and allowlisted projection | holds | 22,778 |
| `DiagnosticsPrivacy_Speech.cfg` | speech-only projection without a session | holds | 38 |
| `Timeline.cfg` | `MaxSleeps = 3` sleeps, holds, and a second sleep while one is pending | holds | 864 |
| `PlaybackPreference.cfg` | three modes and two independent pace settings | holds | 36 |
| `SpeechSetup.cfg` | two files; install, cancellation and rollback outcomes | holds | 42 |
| `SpeechPage.cfg` | two page identities and two narration units | holds | 28 |
| `CloudNarration.cfg` | two generations, provider and credential epochs | holds | 59 |
| `CloudNarration_Healthy.cfg` | two generations with a healthy key read | holds | 59 |
| `SpeechSettings.cfg` | two credential reads and catalog requests | holds | 50,968 |
| `ProviderChoice.cfg` | two ordered settings writes and credential change | holds | 122 |
| `AudioOutput.cfg` | native jobs, route changes and retirement | holds | 3,180 |
| `OutputAdmission.cfg` | overlapping output checks and stale completion | holds | 140 |
| `OutputHandoff.cfg` | worker admission and acknowledged browser retirement | holds | 270 |
| `OutputReplacement.cfg` | view replacement and old-page disposal | holds | 22 |
| `OutputPreference.cfg` | ordered choice, discovery and failed persistence | holds | 648 |
| `LocalAudioAdmission.cfg` | capability, device snapshot and cloud admission | holds | 624 |
| `LocalAudioOwnership.cfg` | local ownership, directional sequences and lease loss | holds | 3,632 |
| `PanelPlacement.cfg` | bounded prepare, irrevocable commit and fallback | holds | 10 |
| `SentencePipeline.cfg` | two units, three parts, pause, cancel and late callbacks | holds | 2,242 |
| `SpeechTempo.cfg` | two units, two parts, rate changes and stale results | holds | 868 |
| `SpeechTempo_Healthy.cfg` | two fair completed units | holds | 17 |
| `SpeechTempo_Canceled.cfg` | fair retirement after cancellation or timeout | holds | 11 |
| `WarmSynthesisWorker.cfg` | two epochs, two units and parts, stale and late completions, cancel between parts | holds | 440 |
| `WarmSynthesisWorker_Healthy.cfg` | two units reuse one healthy worker | holds | 11 |
| `WarmSynthesisWorker_Cancellation.cfg` | canceled inference returns and is discarded | holds | 440 |
| `WarmSynthesisWorker_Watchdog.cfg` | canceled inference may never return; watchdog retires it | holds | 440 |
| `WarmSynthesisWorker_Retirement.cfg` | fair physical worker exit | holds | 440 |
| `SentencePipeline_Healthy.cfg` | fair healthy synthesis, output and eventual resume | holds | 107 |
| `SentencePipeline_Canceled.cfg` | fair canceled inference and child retirement | holds | 137 |
| `MultipartAudioLease.cfg` | two units, three parts, pause and route loss | holds | 13,716 |
| `MultipartAudioLease_Healthy.cfg` | two completed units under fair child progress | holds | 59 |
| `LocalPanelReplay.cfg` | two chunks, two epochs, bounded text and malformed frames | holds | 138 |
| `LocalPanelReplay_Delivery.cfg` | two fair successful chunks | holds | 3 |
| `PlaybackAnchor.cfg` | three-character insert, cursor marker and all bounded programmer edits | holds | 20 |
| `PlaybackAnchor_Progress.cfg` | the same, with fair completion | holds | 20 |
| `CodePlayback.cfg` | three atomic edits, bounded groups, two pause states and three countdown IDs | holds | 654 |
| `CodePlayback_Progress.cfg` | the same edits with fair progress and no pause or interrupt | holds | 11 |
| `ReadingSkip.cfg` | two countdown IDs, hold, pause, turn and suspension changes | holds | 5,840 |
| `ReadingHold.cfg` | matching hold and release with changing pause state | holds | 444 |
| `Narration.cfg` | two units, two page and session epochs, interruptions and independent gates | holds | 7,328 |
| `SpeechWorker.cfg` | two jobs, cancellation, watchdog expiry and worker termination | holds | 19 |
| `ReadingGesture.cfg` | short and long gestures across two countdown IDs | holds | 170 |
| `ListeningHint.cfg` | status and session context | holds | 64 |
| `SettingsAccess.cfg` | idle and active toolbar | holds | 4 |
| `Terminals.cfg` | `NumTerminals = 2` terminals, `MaxRuns = 3`, 2 directories | holds | 3,361 |
| `QuietTerminals.cfg` | quiet default, fallback and guarded cleanup | holds | 9 |
| `QuietTerminals_Visible.cfg` | automatic show, fallback and guarded cleanup | holds | 11 |
| `TerminalReuse.cfg` | shell state, exposure, pending drain and foreign starts | holds | 48 |
| `Turns.cfg` | batches of up to 2 actions, `MaxTurns = 2` turn changes | holds | 1,530 |
| `Reload.cfg` | `NumLines = 5` lines, any of them changed on disk, a selection at a line's start or not | holds | 320 |
| `Rehearsal.cfg` | `MaxLines = 3` lines, `MaxOthers = 2` changes by others, `MaxProgrammerEdits = 1`, `MaxBatches = 2` batches, `MaxQueued = 2` queued, either turn, `ReportWaitsForQueue = TRUE` | holds, in about 200 seconds | 6,721,044 |
| `BatchFile.cfg` | files `sourceFile`, `destinationFile`, and `otherFile`, `MaxActions = 4` actions a batch, `FallBackToNamed = TRUE`, `CursorInNamed = TRUE`, a selection or none | holds | 330 |
| `Diagnostics.cfg` | `MaxBatches = 3`, provider available or not, completed, interrupted, and failed batches | holds | 96 |
| `Actions.cfg` | every batch of up to 2 actions, an interrupt at any await | holds | 3,077 |
| `Player.cfg` | `MaxEdits = 2` | holds | 26 |
| `LineIdentity.cfg` | texts up to 4 characters, inserts up to 2 | holds (checked as `ASSUME`s) | |
| `Places.cfg` | texts up to 5 characters, needles up to 3 | holds (`ASSUME`s) | |
| `ActionValidation.cfg` | move and span places, including `next_close` and multi-close acknowledgment, `CheckAtText = TRUE` | holds (`ASSUME`s) | |
| `Typing.cfg` | texts up to 7 characters | holds (`ASSUME`s) | |
| `TypingEol.cfg` | up to 5 ordinary, LF, or CRLF input units; LF and CRLF document endings | holds (`ASSUME`s) | |
| `Anchor.cfg` | `MaxBatches = 4`, `Guard = TRUE`, `DropsHeld = FALSE` | holds | 113 |
| `Calibration.cfg` | `MaxRounds = 2` calibrations, `AwaitStore = TRUE` | holds | 46 |
| `PointFocus.cfg` | a point, a look-away, a closed tab, `MaxReplies = 2` replies or resumes, `DropStaleFocus = TRUE`, `RevealOnReply = FALSE` | holds | 67 |
| `Start.cfg` | `MaxPages = 3`, `MaxEnvironmentChanges = 4`, `MaxClicks = 2`, `DropStale = TRUE`, `ReaskOnSetUp = TRUE`, `InTerminal = TRUE`, `OneAgent = TRUE`, `NoteOnClick = TRUE`, `ClearOnExit = TRUE` | holds | 242,152 |
| `ListenGrace.cfg` | unbounded, `Grace = TRUE`, `ShowAbsent = TRUE`, `EndOnAnyCall = TRUE` | holds | 40 |

`Controller.tla` also passes at `NumBatches = 3, MaxCancels = 2` (570,008 states).

Each violation TLC found was checked against the code step by step before it was
reported. The traces are in the issues.

## Specs and the code they model

The code that implements a spec's action carries a comment naming the spec and
the action. The actions below have no code of their own: they stand for the
programmer, VS Code, the disk, the agent's MCP client, or the end of a run, so no
comment names them.

| Spec | Actions | What they stand for |
|---|---|---|
| `Actions`, `Bridge`, `FollowMode`, `Player`, `Reload`, `RunBox`, `Serialize`, `Wire` | `Finished` | the model's end: nothing left to do |
| `EditorAdapter` | `EditAsProgrammer`, `Reload` | the programmer typing; VS Code reloading a clean document from disk |
| `FileText` | `OpenDocument`, `CloseDocument`, `Write`, `Delete`, `Edit`, `Save`, `Reload` | VS Code and the disk |
| `Navigator` | `Lull` | the programmer pausing their typing for `navigatorIdleMs` |
| `Outside` | `CloseDocument`, `Edit`, `Save`, `WriteOutside` | VS Code, the programmer, and another program writing the file |
| `PanelScroll` | `Scroll` | the programmer scrolling the history |
| `Start` | `Choose`, `FlipCliAndFolder` | the programmer setting `preferredLocation`; the CLI installed or removed, or the folder closed |
| `Wire` | `AbortInClient`, `Deliver` | the agent's client canceling a call; the MCP SDK handing the relay's answer to the client |

### `PairDefs`: the vocabulary the specs share

No config: the module holds definitions only, as 5.2 of the style guide allows,
and the specs that `EXTENDS` it check them. `ActionKinds` is the nine kinds of
action (Actions, BatchFile, Turns); `SessionPhases` and `NoSession` a session's
phases (Bridge, Resume); `Views` what the panel shows of a session (Resume);
`PageStates` a webview's page, loaded or disposed (Draft, Start); `Calls` and
`NoCall` the agent's blocking calls (ListenGrace, Navigator); and
`PauseReasons` why playback pauses (Timeline). A spec that models one of
these takes the shared definition, so two specs always mean the same thing by
the same word, and could be put together without a clash (#197).
It also holds `Files` and `NoFile` for the specs that name files (BatchFile,
FollowMode, PointFocus), and the letters a text spec spells (`Letter`,
`OtherLetter`, `Space`, `LineFeed`, `CarriageReturn`) with `Seqs`, so that
`n` is a line feed in LineIdentity, Places, and Typing alike; each keeps its
own small alphabet, since one alphabet for all would multiply their state
spaces.

### `Serialize`: the chain of tool calls

`packages/core/src/controller.ts`. A constant `AbortInBlock` switches the abort
check at the top of `block()` (#1).

| Spec | Code |
|---|---|
| `Guard` | `serialize`: `guarded` checks `signal.aborted` once the call before has settled |
| `Rehearse` | `step`: an empty step blocks with no batch; else `await this.rehearse(...)`, the batch pushed onto the queue, or discarded when `stale` or ended, then `block()` |
| `FailRehearsal` | `rejectBatch`, or `rejectUnanchored` (#112): the call answers with the rejection at once; an abort meanwhile ends it with that, not `canceled` |
| `Cancel` | the `AbortSignal` firing; its listener in `block()` runs only if attached, and checks `this.call === call` |
| `Played` | the player finishing batches in queue order |
| `Return`, `Timeout`, `Commit` | `finishCall` from `ready()`, true at once for an ended session; an empty step, or one whose batch was discarded, once nothing is queued (#219); else where a step's batch is done or first in the queue (#150), or from the `maxBlockMs` timer; clears `this.call`, and reports on `call.session`, the session the call was made on |
| `HandBack` | `withCursor(...).then(call.resolve)`: the report handed back after the commit |
| `End` | `endSession`: `s.ended`, and `interrupt()` discarding every queued batch but the one playing; a step on a closed session refused by `requireSession()` |
| `Interrupt` | `interrupt()`, for an edit, a turn, or a batch that did not complete: every queued batch discarded, the one playing plays on (#151) |
| `CloseSocket` | the bridge's close handler: `abort()` on each of the socket's calls, then `disconnect()`, which closes an ended session (#174) |
| `Finished` | every call settled: the agent makes no more calls |

Each invariant was proved to bite with a mutation of a copy of the model, run
in TLC and then reverted. A stalled chain also leaves a call aborted while it
waits uncanceled, so its mutation breaks CancelReleases as well, and it ran
with the deadlock check off, since TLC otherwise stops first at the deadlock:

| Mutation | Breaks |
|---|---|
| `Commit` leaves `blockedCall` at 0, the old sentinel | `TypeOK` |
| `Guard` runs a call without waiting for the calls before it | `BlockedIsCurrent` |
| `Return` waits for the batch to be done, the spec before #150 | `ReadyAtHead` |
| an abort of a blocked call takes its batch off the queue | `CancelKeepsBatch` |
| `AbortInBlock = FALSE`, the code at 57ac07f | `CancelReleases` |
| the chain runs a call only after the calls before it were reported, as `this.chain.then(guarded)` with no rejection handler would | `ChainProgresses`, `CancelReleases` |
| `CloseSocket` aborts only the blocked call | `NeverBlockedClosed` |
| `Return` without its `ended` disjunct | `ReadyWhenEnded` |
| `Return` lets a discarded step go as one whose batch is done, the code before #219 | `DiscardedWaits` |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `BlockedIsCurrent` | `controller.test.ts`: BlockedIsCurrent: a call waits its turn while another is blocked, and blocks only once that one has returned |
| `ReadyAtHead` | `controller.test.ts`: BatchEnds, ReadyAtHead: returns the first step immediately and blocks the second until the first finishes |
| `CancelKeepsBatch` | `controller.test.ts`: CancelKeepsBatch, BatchesDelivered: keeps a canceled step's batch queued and reports it later; CancelKeepsBatch, CancelReleases: cancels a step whose abort arrives during its rehearsal; CancelKeepsBatch, CancelReleases: a step canceled while it waits its turn never queues its batch |
| `CancelReleases` | `controller.test.ts`: CancelReleases, ChainProgresses, EventsDelivered: releases a blocked call without consuming the report; CancelKeepsBatch, CancelReleases: cancels a step whose abort arrives during its rehearsal; CancelKeepsBatch, CancelReleases: a step canceled while it waits its turn never queues its batch |
| `ChainProgresses` | `controller.test.ts`: CancelReleases, ChainProgresses, EventsDelivered: releases a blocked call without consuming the report |
| `NeverBlockedClosed` | `bridge.test.ts`: NeverBlockedClosed, CloseSocket: aborts a closed socket's calls, and suspends the session only when the socket owned it; `controller.test.ts`: NeverBlockedClosed, CancelKeepsBatch, CancelReleases: cancels a step whose abort arrives during its rehearsal |
| `ReadyWhenEnded` | `controller.test.ts`: ReadyWhenEnded: stops playing a session that closed while a batch played |
| `DiscardedWaits` | `controller.test.ts`: DiscardedWaits: reports a step discarded while an interrupted batch plays once that batch ends, then rehearses the next; `integration.ts`, in VS Code: the controller paths, where a step discarded during a batch's held last save waits for it |

### `Wire`: the relay's side of the WebSocket

`packages/relay/src/link.ts`, with the editor's replies from
`packages/core/src/bridge.ts`. Constants: `RejectPerSocket` (#3), `GuardedParse`
(#4, #30), `CheckAbort` (#29), `WaitForReturn` (#59; what it is for is checked
in `Controller`), `HandBackAnswered` and `MarkRepeats` (#67),
`CloseAfterShutdown` (#163). The agent's MCP
client is modeled too: it drops an answer once it has canceled, and it sends a
cancel even after it took the answer, since the SDK never removes its abort
listener. So the relay can't tell whether the agent saw a report whose cancel
came after its answer. The fix for #67 delivers it at least once: the relay
hands it back with `mayRepeat`, and the next report says it may repeat an
earlier one (`RepeatsMarked`).

| Spec | Code |
|---|---|
| `OpenSocket`, `Welcome` | `connect()` -> `open()` -> `openWindow()`, one attempt at a time; `welcome` sets `this.connection`, or after the link closed, closes the socket; a closed link opens none, and `open()` tries no other window once it closed (#220) |
| `Request` | the agent's tool call reaching `call()`, which awaits `connect()` |
| `AbortInClient`, `Abort` | the agent's client canceling; the relay handling `notifications/cancelled`: the abort listener in `call()`, which the SDK runs only while the call is unanswered, or for a request already answered, `handBack` with `mayRepeat` |
| `Deliver` | the relay's answer reaching the client, which drops it after a cancel |
| `Send` | `call()` registering the call in its socket's map and sending it, once no canceled call on the socket waits for its answer; the socket is open and the arguments are JSON, so the send cannot fail, and the model has no failed send (#180) |
| `CloseSocket`, `HandleClose` | `locate()` closing `this.connection`, or the editor's end closing; the `close` handler rejecting `Victims` |
| `Reply` | a `result` frame: `result`, or `return` for a call the relay marked canceled |
| `SendGarbage` | a frame that isn't a message (`parseEditorMessage`); `ws` hands every frame over as one `Buffer`, so the model has no other forms of a frame (#180) |
| `RejectHello` | a `rejected` answer to the hello, after which the bridge closes its end: `openWindow()` rejects, and the `close` handler runs with no welcome |
| `Shutdown` | `serve()` in `server.ts`: the harness ends stdin, and it closes the server and `link.close()`, which closes `this.connection` and marks the link closed |
| `Finished` | nothing: the model's sockets are used up, the relay crashed, or it shut down and closed the sockets it opened, and the run ends |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Request` sets a call to a state outside `CallStates` | `TypeOK` |
| `RejectPerSocket = FALSE`, the code before #3 | `OwnCloseOnly` |
| `GuardedParse = FALSE`, the code before #4 | `RelayStaysUp` |
| `CheckAbort = FALSE`, the code before #29 | `NoReportLost` |
| `MarkRepeats = FALSE` | `RepeatsMarked` |
| `HandBackAnswered = FALSE`, the code before #67 | `DroppedHandedBack` |
| no fairness on `Reply` | `CallsAnswered` |
| `Finished` left out of `Next` | the deadlock check |
| `CloseAfterShutdown = FALSE`, the code before #163 | `ExitsAfterShutdown`: the harness ends stdin while socket 1 connects, socket 1 fails, `open()` goes on to socket 2, and its welcome leaves it open with nothing to close it (49,428 states) |
| `WaitForReturn = FALSE`, the code before #59 | nothing here, with the same 43,426 states: what it is for is checked in `Controller` |

Every invariant and property names the test that proves the code obeys it;
the test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `OwnCloseOnly` | `link.test.ts`: OwnCloseOnly: rejects a call only when the socket it was sent on closes |
| `RelayStaysUp` | `link.test.ts`: RelayStaysUp: fails to connect, without crashing, when a window answers with $name (a string, a number, an array, an object with no type, or a rejection whose reason isn't a text); RelayStaysUp: drops a frame that is not a message after the welcome, and an answer to no call; `integration.ts`, in VS Code: RelayStaysUp, ConnectedToOpen: a relay skipped the windows that are not, canceled and shut down cleanly, and started without AI_PAIR_HOME |
| `NoReportLost` | `link.test.ts`: NoReportLost: doesn't send a call that was cancelled before it went out |
| `RepeatsMarked` | `relay.test.ts`: RepeatsMarked, NoUnmarkedRepeat: delivers a report again, saying it may repeat, when the agent cancels after taking it (#67) |
| `CallsAnswered` | `link.test.ts`: CallsAnswered: tells the agent to call `start` again when the editor disconnects during a call (#138) |
| `DroppedHandedBack` | `link.test.ts`: DroppedHandedBack: hands a report back on the socket it came over, marked as maybe seen, and nothing it cannot; `relay.test.ts`: DroppedHandedBack, NoUnmarkedRepeat: hands back a report the agent canceled after the relay answered it, saying it may repeat (#67); `server.test.ts`: DroppedHandedBack: hands back an answered report once, and passes every message on to the SDK (#67) |
| `ExitsAfterShutdown` | `link.test.ts`: ExitsAfterShutdown: closes a socket the editor welcomes after the link closed, and opens none after it; `server.test.ts`: ExitsAfterShutdown: connects, and once stdin ends, closes the server and then the link (#163); `relay.test.ts`, end to end: ExitsAfterShutdown: serves until stdin ends, then closes the server and the link (#163) |

### `Panel`: the history

The page, `packages/vscode/src/webview/panel.ts`. `Fix = 1` is the code
since #18.

| Spec | Code |
|---|---|
| `OpenSettings`, `CloseSettings` | the Settings dialog opens and closes |
| `SwitchOrder` | the setting changes the displayed order without changing events |
| `Say` | `setNow` |
| `AddEntry` | `addYou`, `addRun`, `addOutside`, the interrupt and turn dividers: `add()` |
| `ChangeSession` | the `session` event: a start, an end, and a suspension or resumption shown for the first time |
| `RepeatSession` | the `session` event repeating a suspension the page already shows (#138): the band is filed and emptied, with no divider |
| `currentMessage`, `messageFiled`, `bandVisible`, `WithMessageFiled` | `current`, `filed`, the current narration, and `fileCurrent()` |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted. NewestFirst implies NoDuplicates (a strictly decreasing history has
no duplicates), so NoDuplicates' mutation ran with NewestFirst left out of the
config:

| Mutation | Breaks |
|---|---|
| `AddEntry` stamps the entry with the old time, 0 at first | `TypeOK` |
| `Fix = 0`, the code at 57ac07f (`Fix = 2` passes) | `NewestFirst` |
| `ChangeSession` drops the band's message | `NoneLost` |
| `RepeatSession` drops the band's message | `NoneLost` |
| Fix 1 never marks the message as filed | `NoDuplicates` |
| Present the logical history without reversing it in oldest-first order | `DisplayOrdered` |
| Leave the filed message visible in the band | `VisibleOnce` |
| Hide a new message in the band | `NoneLost` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `VisibleOnce` | `webview/panel.test.ts`: VisibleOnce, NoneLost: shows each agent and programmer message once in each order |
| `DisplayOrdered` | `visual/chat_order.spec.ts`: DisplayOrdered, NoneLost and NoDuplicates: switching reverses populated history and keeps the draft |
| `NewestFirst` | `webview/panel.test.ts`: NewestFirst, NoneLost: puts a reply above the agent message it answers; NoDuplicates, NewestFirst: files the current message once, before anything added while it was current |
| `NoneLost` | `webview/panel.test.ts`: NewestFirst, NoneLost: puts a reply above the agent message it answers |
| `NoDuplicates` | `webview/panel.test.ts`: NoDuplicates, NewestFirst: files the current message once, before anything added while it was current |

### `PanelScroll`: the history's scroll position

`add` and `addYou` in `packages/vscode/src/webview/panel.ts`. Issue #139
and #5. `ScrollOn = "you"` reveals the programmer's message. The model
abstracts the viewport to one entry and permits newest-first browser anchoring
at the top to keep the old entry. Oldest-first follows the latest edge only
when already there, and preserves the visible entry otherwise.

| Spec | Code |
|---|---|
| `AddEntry` | add a filed message, run, divider or outside change |
| `AddYours` | add a programmer message and reveal the newest edge |
| `Scroll` | the programmer scrolling the history |
| `SwitchOrder` | reverse the entries and preserve the visible position |
| `view` | the visible entry tracked by browser scroll anchoring |

Each invariant was mutation-tested in TLC and the mutation reverted:

| Mutation | Breaks |
|---|---|
| Set the view to 0 on addition | `TypeOK` |
| Clear the view on addition | `ViewAtEntry` |
| Keep the old view when a reply arrives | `YoursInView` |
| Always follow the latest entry | `KeepsPlace` |
| Keep the old view when the latest entry arrives | `FollowsLatest` |
| Clear the view on an order switch | `SwitchKeepsPlace` |

| Invariant | Proved by |
|---|---|
| `YoursInView` | `visual/chat_order.spec.ts`: FollowsLatest, KeepsPlace and YoursInView: oldest-first tracks the reader |
| `KeepsPlace` | `visual/chat_order.spec.ts`: FollowsLatest, KeepsPlace and YoursInView: oldest-first tracks the reader |
| `SwitchKeepsPlace` | `visual/chat_order.spec.ts`: SwitchKeepsPlace: switching order keeps the visible history entry in place |
| `FollowsLatest` | `visual/chat_order.spec.ts`: FollowsLatest, KeepsPlace and YoursInView: oldest-first tracks the reader |
| `ViewAtEntry` | Browser scrolling keeps the view within the history |
| `TypeOK` | The TypeScript compiler checks these types |

### `PanelReplay`: the panel's log and its replay

`post` and `ready` in `packages/vscode/src/panel.ts`, and the page's
`setActive`. `KeepSession` is the fix for #54.

| Spec | Code |
|---|---|
| `Post(e)` | `post()`: the event onto `log`, the oldest cut beyond `MAX_LOG`, the last `session` event kept |
| `ReplayShowsSession` | a view created now: `ready` -> `replay`, its session state from the log's last `session` event |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted:

| Mutation | Breaks |
|---|---|
| `Post` sets `liveViewSession` to every event, "other" too | `TypeOK` |
| `KeepSession = FALSE`, the code before #54 | `ReplayShowsSession` |
| `Post` never cuts the log | `Bounded` |
| `Post` leaves a non-session event off the log | `LogsPosts` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ReplayShowsSession` | `panel.test.ts`: ReplayShowsSession and Bounded: keeps the session's start in the log however many events follow it; ReplayShowsSession: replays the session's end when that is the last session event |
| `Bounded` | `panel.test.ts`: ReplayShowsSession and Bounded: keeps the session's start in the log however many events follow it |
| `LogsPosts` | `panel.test.ts`: LogsPosts: a posted event is on the log a new view replays |

### `Controller`: what reaches the agent

`packages/core/src/controller.ts`, with `call` and `return` in `link.ts`. Every
event and batch result reaches the agent exactly once, and since #67 at least
once: nothing reaches the agent twice in a report not marked `repeated`
(`NoUnmarkedRepeat`), and everything reaches it (`BatchesDelivered`,
`EventsDelivered`, `QuietDelivered`). A batch planned without knowledge of an
interrupting event never plays (`PlaysKnowingEvents`); a batch plays only if the
one before it completed (`PlaysAfterCompleted`); every blocked call returns
(`BlockedReturns`: `Commit` is enabled whenever a call is blocked, as the
`maxBlockMs` timer ends it); and the programmer ending the session reaches the
agent (`EndDelivered`). `RestoreRejected` is the fix for #28. `WaitForReturn` is
the fix for #59: the relay sending a call only once every canceled call on the
socket has settled, so a `return` reaches the editor before the next call.
`RestoreEnded` is the fix for #60: `restore()` working on a session the
programmer ended, and putting a closed one back. `MarkHeld` and `DrainHeld` fix
two bugs this spec found, each needing two rejections held at once, which a
cancel after an answer allows. Each held rejection now keeps its own repeat
mark, where before only the first report after them was marked. And a session
the programmer ended stays open until its held rejections are out, one per
report, where before it closed with the first.

| Spec | Code |
|---|---|
| `Submit`, `Listen` | `step` with a batch, in the agent's turn (a `say` or `point` batch in the programmer's turn is `Turns`'s); `listen`; with `WaitForReturn`, held while a report is on its way back (`Sendable`) |
| `EndByProgrammer` | `endSession()`: `ended`, the `end` event, `interrupt()` |
| `FailRehearsal`, `PassRehearsal` | `rejectBatch()` with the action the rehearsal `failed` at, or `rejectUnanchored()` before any rehearsal (#112); the batch queued, or discarded when `stale`, then `block()` |
| `Play`, `Complete` | `run()` |
| `Interrupt` | an interrupting event: `interrupt()` discards what is queued and sets `stale`; a turn change, `takeTurn` or `handBack` |
| `Commit` | `finishCall` -> `snapshot`, which also hands out one `held` rejection; with the session ended, `close()` |
| `Cancel` | the agent canceling a call |
| `Deliver`, `Bounce`, `Restore` | the report reaching the agent; the relay's `return`; `restore()` |
| `BounceLate` | the agent's cancel coming after it took the answer: the relay's `handBack` with `mayRepeat`, and `restore()` setting `s.mayRepeat`, so the next report is marked `repeated` (#67) |
| `EditQuietly` | `userEdit` in the programmer's turn: recorded, interrupting nothing |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Listen` sets `callBatch` to 0, the sentinel before `NoBatch` | `TypeOK` |
| `MarkHeld = FALSE` | `NoUnmarkedRepeat` |
| `Commit` leaves `stale` false while rejections are still held | `HeldMeansStale` |
| `PassRehearsal` queues a batch while `stale` | `PlaysKnowingEvents` |
| `Commit` leaves out the batches that did not complete | `PlaysAfterCompleted` |
| `WaitForReturn = FALSE`, the code before #59 | `PlaysAfterCompleted` |
| `RestoreRejected = FALSE`, the code before #28 | `PlaysAfterCompleted` |
| `DrainHeld = FALSE` | `BatchesDelivered` |
| `Restore` drops the events of a report handed back after the end | `EventsDelivered` |
| `Commit` holds back the programmer's quiet edits during their turn | `QuietDelivered` |
| `Commit` leaves out the end event | the deadlock check; with it off, `EndDelivered` |
| `RestoreEnded = FALSE`, the code before #60 | the deadlock check; with it off, `BatchesDelivered`, `EventsDelivered`, and `EndDelivered` |
| `Commit` only with something to report, as if `block()` set no `maxBlockMs` timer | `BlockedReturns` |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoUnmarkedRepeat` | `controller.test.ts`: NoUnmarkedRepeat: says a returned report may repeat one already seen, and marks each returned rejection the agent may have seen; `relay.test.ts`: DroppedHandedBack, NoUnmarkedRepeat: hands back a report the agent canceled after the relay answered it, saying it may repeat (#67); RepeatsMarked, NoUnmarkedRepeat: delivers a report again, saying it may repeat, when the agent cancels after taking it (#67) |
| `HeldMeansStale` | `controller.test.ts`: HeldMeansStale, BatchesDelivered: reports a returned rejection again, discarding steps until it has |
| `PlaysKnowingEvents` | `controller.test.ts`: PlaysKnowingEvents: discards a batch planned before an interruption the agent has not seen |
| `PlaysAfterCompleted` | `controller.test.ts`: PlaysAfterCompleted: discards the queued batches behind one that didn't complete, and takes none of its lines; `player.test.ts`: PlaysAfterCompleted, PlaysNothingTwice, StopAtCheck: hands back what's left of a type cut short, before the marker or after it, and nothing if none was typed; `link.test.ts`: PlaysAfterCompleted: sends the next call only after a canceled call's report is handed back (#59) |
| `BatchesDelivered` | `controller.test.ts`: CancelKeepsBatch, BatchesDelivered: keeps a canceled step's batch queued and reports it later; BatchesDelivered: keeps an ended session until its returned rejections are reported, one per call; HeldMeansStale, BatchesDelivered: reports a returned rejection again, discarding steps until it has; `relay.test.ts`: BatchesDelivered: reports the rejection of a step canceled during its rehearsal (#28) |
| `EventsDelivered` | `controller.test.ts`: CancelReleases, ChainProgresses, EventsDelivered: releases a blocked call without consuming the report; EndDelivered, EventsDelivered: reports a returned report again after the programmer ended the session with it (#60); EventsDelivered: returns once something interrupts, and not for a quiet edit by others; `relay.test.ts`: EventsDelivered: cancels a blocked call without losing the report, even when racing |
| `QuietDelivered` | `controller.test.ts`: NotWhileTyping, EditsReported, QuietDelivered: waits in the programmer's turn until they pause typing, or hand the turn back |
| `BlockedReturns` | `controller.test.ts`: BlockedReturns: returns with `waiting` after MAX_BLOCK |
| `EndDelivered` | `controller.test.ts`: EndDelivered: ends when the programmer ends it, delivering a final report; EndDelivered, EventsDelivered: reports a returned report again after the programmer ended the session with it (#60) |

### `Discovery`: finding a window

`writeDiscovery`, `focused` and `dispose` in `bridge.ts`, `findWindows` and
`open` in `link.ts`. `CheckFiles` is the fix for #31. `AtomicWrite` is the fix
for #72: a window rewrites its file each time it gains focus, and written in
place, a relay reading it mid-write skipped it. `locate` switching windows
mid-session is `CloseSocket` in `Wire`. With `AtomicWrite = TRUE`, `Focus` and
`FinishWrite` are not enabled: they are the write in place that the fix
removed. `Discovery_InPlace.cfg` sets `AtomicWrite = FALSE`, so they fire in a
checked run (#169); it leaves out `FindsRunningProp`, since that write is what
breaks it, as the mutation below shows.

| Spec | Code |
|---|---|
| `OpenWindow`, `CloseWindow`, `Crash`, `Reuse` | a window writing its file; `dispose()` removing it; a crash leaving it; its `pid` reused |
| `Focus`, `FinishWrite` | `focused()` -> `writeDiscovery`: in place, the file is truncated, then written; renamed, it is replaced whole |
| `OpenWindow` unlisted, `ListWindow` | the write failing (`failed`): the window runs, and no relay finds it; a later focus writing it |
| `Start` | `locate` -> `findWindows`: files that hold a `Discovery` with a live `pid`, and parse; it gives the workspace folder it matched too, which `workspace()` takes as the root (#180) |
| `Try` | `openWindow` on one candidate, best first; a window that refuses the hello (`rejected`, or garbage on its port) sends `open()` to the next |
| `Disconnect` | the socket closing, so the next call opens again |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `CloseWindow` leaves a state outside the window's states | `TypeOK` |
| `CheckFiles = FALSE`, the code before #31 | `NoInternal` |
| `AtomicWrite = FALSE`, the code before #72 | `FindsRunningProp` |
| `Try` connects without setting `connectedTo` | `ConnectedToOpen` |
| `Try` skips every candidate | `FindsOpen` |
| `Try` gives up at the first window that refuses the hello | `FindsOpen` |
| `FindsOpen` without `~refuses[w]`: a relay finds a window that refuses it | `FindsOpen` |
| `Try` connects to a window that refuses the hello | Nothing: `ConnectedToOpen` asks only that the window be open, and the relay's error for a refused hello is `link.test.ts`'s |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoInternal` | `link.test.ts`: NoInternal: skips a file that isn't JSON, JSON that isn't a window's, and a file not named as JSON; `relay.test.ts`: NoInternal: skips a discovery file that parses but isn't a window's |
| `FindsRunningProp` | `bridge.test.ts`: OpenWindow, FindsRunningProp: listens on 127.0.0.1, then writes its discovery file beside it and renames it over; `integration.ts`, in VS Code: FindsRunningProp: the discovery file is never half written |
| `ConnectedToOpen` | `link.test.ts`: ConnectedToOpen, FindsOpen: tries the next window when one fails, and fails with the first error when all do; ConnectedToOpen: skips a window whose pid is gone, and keeps one it may not signal, which is alive; `relay.test.ts`: ConnectedToOpen: skips a window whose file outlived it, even when its pid now belongs to another process; `integration.ts`, in VS Code: RelayStaysUp, ConnectedToOpen: a relay skipped the windows that are not, canceled and shut down cleanly, and started without AI_PAIR_HOME |
| `FindsOpen` | `link.test.ts`: FindsOpen: opens one socket for calls made while it opens, reuses it, and opens again once it closed; `relay.test.ts`: FindsOpen: finds the window again after the relay's socket to it closes, while it stays open |

### `EditorAdapter`: who made a change

`edit`, `save`, `onChange`, and `byProgrammer` in
`packages/vscode/src/editor.ts`, which call the controller's `userEdit` or
`otherEdit`. `FlushBeforeSave` is the fix for #40. VS Code delivers a change
event before the call that made it resolves, and replies after the events sent
before them: one channel, in order.

| Spec | Code |
|---|---|
| `EditAsAgent`, `ResolveEdit` | `edit()`: the entry in `own`, VS Code applying it, `finally` |
| `RejectEdit` | `edit()`: VS Code refusing the edit (`if (!applied) throw`), or the document unreadable: no change event comes |
| `StartCreateSave`, `FinishCreateSave` | `create()`, in `show()`: `doc.save()` on the document it emptied, without `saving` |
| `EditAsProgrammer` | a keystroke: its change event is queued for the extension host |
| `StartSave`, `RunParticipant`, `FinishParticipants`, `FinishSave` | `save()`: the round trip, `saving`, the save participants (format on save), the write |
| `Handle` | `onChange`: the agent's own edit, or `byProgrammer` |
| `Reload` | a file replaced on disk while open: VS Code reloads the document, and its change event is queued; `byProgrammer` takes a clean document reading what is on disk for a tool's |

A keystroke made while the save participants run can't be told from their edits,
since VS Code doesn't say who made a change. The spec allows that one wrong
attribution by name (`"programmerDuringSave"`). A reload from disk is told
apart by the document being clean and reading what is on disk, which a
keystroke never leaves, so it is a tool's (`"disk"`).

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `ResolveEdit` leaves `ownEdit` in a fourth phase | `TypeOK` |
| `FlushBeforeSave = FALSE`, the code before #40 | `RightAuthor` |
| `onChange` never matches the agent's own edit | `RightAuthor` |
| `onChange` never runs | `ChangesHandled` |
| `Handle` without fairness | `ChangesHandled` |
| `Handle` takes a reload from disk for the programmer's | `RightAuthor` |
| `Handle` matches a rejected edit's entry to the next change | `RightAuthor` |
| `Handle` takes a change during `create`'s save for the programmer's | `RightAuthor` |
| `ResolveEdit` waits for a handled event, so a rejected edit's entry stays | `EditsEnd` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `EditsEnd` | `editor.test.ts`: EditsEnd, RejectEdit: rejects an edit its editor refuses, and forgets it |
| `RightAuthor`, `ChangesHandled` | `integration.ts`, in VS Code: RightAuthor, ChangesHandled: changes by others are reported as theirs; RightAuthor, ChangesHandled: a keystroke just before a save is the programmer's; `editor.test.ts`: RightAuthor, ChangesHandled: reports a keystroke as the programmer's, its changes from the highest offset down; RightAuthor: reports a reload from disk, read without its BOM, as others'; RightAuthor: counts as the programmer's a clean change that isn't what's on disk, an unreadable file, and an undo; RightAuthor, ChangesHandled: reports changes while we save as others', and after it as the programmer's; RightAuthor: edits a file in view through its editor, with its undo stops, and takes its change event for its own |

### `FollowMode`: our own navigation against looking away

`show`, `selfNav`, and `onActiveEditor` in `packages/vscode/src/editor.ts`, with
a `move` that shows its file before the agent cursor moves there.
`HoldWhileShowing` is the fix for #56.

| Spec | Code |
|---|---|
| `StartShow`, `WindowExpires`, `ShowResolves` | `show()`: our navigation starts; the window (`timings.selfNavMs`) runs out; `showTextDocument` resolves, and the `move` puts the agent cursor in the file |
| `ShowFile`, `HandleEditorChange` | VS Code's change of active editor, and `onActiveEditor` pausing as `away` outside the window |
| `LookAway` | the programmer switching files themselves |
| `ShowVisible` | `show()` returning early for a file in a visible editor (`visibleEditor`), before `selfNav()` |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `ShowFile` shows a file outside `Files` | `TypeOK` |
| `HoldWhileShowing = FALSE`, the code before #56 | `NoPauseFromOurOwnShow` |
| `LookAway` leaves `awayPause` as it was | `LookAwayPauses` |
| `ShowResolves` leaves the agent cursor where it was | `MoveEnds` |
| `ShowVisible` focuses the file's editor, as `showTextDocument` would | `NoPauseFromOurOwnShow` |
| `ShowResolves` only after a handled event, not after an early return | the deadlock check, and `MoveEnds` |
| `Next` without `Finished` | the deadlock check |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoPauseFromOurOwnShow`, `MoveEnds` | `integration.ts`, in VS Code: NoPauseFromOurOwnShow, MoveEnds: our own move to another file doesn't pause; `editor.test.ts`: NoPauseFromOurOwnShow: leaves a file already in view as it is; NoPauseFromOurOwnShow, MoveEnds: a change of active editor during our show, or SELF_NAV_MS after, pauses nothing; LookAwayPauses: one later pauses |
| `LookAwayPauses` | `editor.test.ts`: NoPauseFromOurOwnShow, MoveEnds: a change of active editor during our show, or SELF_NAV_MS after, pauses nothing; LookAwayPauses: one later pauses; LookAwayPauses: follows the point when the focus is on it, and the cursor when there is no point. No test looks away in VS Code yet |

### `Bridge`: who drives the session

`dispatch` and the socket's `close` handler in `packages/core/src/bridge.ts`,
with the controller's session. `CheckOpen` is the fix for #42.

| Spec | Code |
|---|---|
| `BeginStart`, `FinishStart` | `dispatch("start")`: refused while another socket's session is active and not suspended; `controller.start()`; `this.owner = ws`, or on a socket that closed meanwhile, `this.owner = undefined` and `disconnect()`, which suspends the session it started, unowned |
| `CloseSocket` | the `close` handler: aborts the socket's calls, and `disconnect()` if it owns the session, which suspends it, unowned (#25) |
| `EndSuspended` | the programmer ending a suspended session: it closes at once |
| `EndByProgrammer`, `CloseEnded`, `EndByAgent` | the programmer ending the session from the panel, and its last report closing it; the agent's `end` |
| `Restore` | a `return` from the owner's socket: `restore()` puts a session its last report closed back, as ended (#60); `restorable` is `this.closed` |
| `Finished` | every socket closed, with no session: nothing more happens until another socket connects |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `EndSuspended` leaves the session in a fifth phase | `TypeOK` |
| `CheckOpen = FALSE`, the code before #42 | `OwnedByOpenSocket` |
| `CloseSocket` of the owner leaves an ended session ended | `EndedOwned` |
| `CloseSocket` of the owner leaves it the owner | `SuspendedUnowned` |
| `FinishStart` keeps the old owner when its socket closed (the code before this fix): 7 states | `SuspendedUnowned` |
| `FinishStart` opens no session | `StartOpensSession` |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `OwnedByOpenSocket` | `relay.test.ts`: OwnedByOpenSocket: lets only one agent pair in a window at a time; OwnedByOpenSocket: doesn't leave a session to a socket that closed while it started |
| `EndedOwned` | `relay.test.ts`: EndedOwned: gives a session the programmer ended to its owner's next call, which closes it |
| `SuspendedUnowned` | `relay.test.ts`: SuspendedUnowned: suspends the session when the agent's harness goes away, and resumes it for the next agent (#25); SuspendedUnowned: a start whose socket closes while it runs leaves the suspended session to no one, even after another socket's session ended |
| `StartOpensSession` | `relay.test.ts`: StartOpensSession: runs a session: start with the guide, pipelined steps, read, end |

### `Timeline`: pausing

`packages/core/src/timeline.ts`, with the pause reasons in `Controller.pause`
and `Controller.resume`, and where they come from: the Pause button, the reply
box's draft, sending a reply, and the turn button (`panel.ts`), the Toggle Pause
command and the reading speed calibration (`extension.ts`, #109), and looking
away (`editor.ts`).

| Spec | Code |
|---|---|
| `Sleep`, `Fire` | `sleep(ms)` and its timer |
| `FinishEarly` | `finish()` completes an armed sleep without interrupting playback |
| `Hold`, `Release` | `hold()` freezes the remaining delay; `release()` resumes only if globally unpaused |
| `Pause`, `Resume` | `Controller.pause(reason)` with `Timeline.pause()`; `Controller.resume(reason)`, or with no reason all of them, then `Timeline.resume()` |
| `Interrupt`, `Reset` | `interrupt()`; `reset()` for the next batch |
| `SleepAgain`, `FireReplaced` | `sleep(ms)` with a sleep pending, which no caller makes; the replaced sleep's timer in `arm`, which leaves `sleeping` alone (#174) |

A pause lasts until a resume, as PROTOCOL.md says: looking back at the code
doesn't end the `away` pause, and the agent isn't told about pauses.

Each invariant was proved to bite with a mutation of a copy of the model, run
in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Pause` adds a reason outside `PauseReasons` | `TypeOK` |
| `Resume` of one reason resumes the timeline with others left | `PausedMatchesReasons` |
| `Pause` leaves the timer running | `NoTimerWhilePaused` |
| `Hold` leaves the timer running | `NoTimerWhileHeld` |
| `Interrupt` resolves the pending sleep but keeps it pending | `ResolvedOnce` |
| `Resume` never restarts a waiting sleep's timer | `ResumeContinues` |
| `FireReplaced` clears the pending sleep, the code without its check | `LatestPending` |
| `FireReplaced` leaves its sleep in `replaced` | `TypeOK` |

Every invariant names the test that proves the code obeys it; the test's title
carries the invariant's name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `PausedMatchesReasons` | `controller.test.ts`: PausedMatchesReasons, NoTimerWhilePaused, ResumeContinues: holds playback until the last pause reason is gone; `webview/panel.test.ts`: PausedMatchesReasons: distinguishes actual pause, active playback, natural reading, and turn or confirmation waits (the display consumes the controller's aggregated flag) |
| `NoTimerWhilePaused` | `controller.test.ts`: PausedMatchesReasons, NoTimerWhilePaused, ResumeContinues: holds playback until the last pause reason is gone; `timeline.test.ts`: NoTimerWhilePaused, ResumeContinues: pauses a sleep with its time left, and resumes it for only that; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |
| `NoTimerWhileHeld` | `timeline.test.ts`: NoTimerWhileHeld: holds only the remaining time and resumes it on release |
| `ResolvedOnce` | `timeline.test.ts`: ResolvedOnce: resolves an interrupted sleep false once, and the next sleep after reset only when its own time is up. A `Promise` settles once, so no change to `timeline.ts` can resolve a sleep twice; the test checks what the code decides: `false` on an interrupt, and the next sleep's own time after `reset`; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |
| `LatestPending` | `timeline.test.ts`: LatestPending: an earlier sleep that runs out leaves the later sleep that replaced it pending, for an interrupt to cut short |
| `ResumeContinues` | `controller.test.ts`: PausedMatchesReasons, NoTimerWhilePaused, ResumeContinues: holds playback until the last pause reason is gone; `timeline.test.ts`: ResumeContinues: holds a sleep begun while paused until the resume, then runs all of its time; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |

Two sleeps at once: `sleep` accepts a second while one is pending, though no
caller makes one, and the first's timer, running out, leaves the second pending,
so an interrupt still cuts it short (`LatestPending`, #174). A replaced sleep's
own timer keeps running through a pause, and an interrupt does not cut it short;
no caller can reach either, since no caller makes a second sleep.

### `Anchor`: the cursor after a discarded batch

`step` and `snapshot` in `packages/core/src/controller.ts`. The agent plans a
batch against where the one before would have ended; when that one is
interrupted, discarded, or failed, the cursor is where it stopped (#112). `Guard`
switches the refusal; with `FALSE`, TLC violates `NoMisplacedEdit` in two steps:
`StopShort`, `SubmitUnanchored`. `DropsHeld` is the bug of #193: the refusal's
report took a rejection `restore` held and overwrote it; with `TRUE`, TLC
violates `NoRejectionLost` in three steps: `StopShort`, `Restore`,
`RefuseUnanchored`.

| Spec | Code |
|---|---|
| `StopShort` | a report with a batch not completed sets `anchorNeeded` |
| `SubmitAnchored` | a batch whose first action at the cursor is a `move` or `select` with `file` and `line`: accepted, and the flag cleared |
| `SubmitUnanchored` | any other action at the cursor first, accepted while the flag is clear |
| `RefuseUnanchored` | such a batch while the flag holds: `rejectUnanchored`, with `unanchored`, while nothing is held; with a held rejection, `step` discards it as stale and its report delivers the rejection |
| `Restore` | `restore` of a report with a rejection: onto `held`, and `stale` set (#67) |
| `TakeHeld` | `snapshot` taking one held rejection into the report of a `listen`, an `end`, or a step discarded as stale |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted:

| Mutation | Breaks |
|---|---|
| `StopShort` leaves the cursor at a fourth place | `TypeOK` |
| `Guard = FALSE`, the code before #112 | `NoMisplacedEdit` |
| the guard refuses every unanchored batch, pending or not | `AcceptsUnanchored` |
| `DropsHeld = TRUE`, the code before #193 | `NoRejectionLost` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoMisplacedEdit` | `controller.test.ts`: NoMisplacedEdit, AcceptsUnanchored: refuses a batch after a discarded one unless it anchors the cursor with a file and line |
| `AcceptsUnanchored` | the same test |
| `NoRejectionLost` | `controller.test.ts`: NoRejectionLost: delivers a held rejection with the step discarded as stale before refusing an unanchored one (#193) |

### `Calibration`: calibrating the reading speed

The calibration flow in `packages/vscode/src/calibration.ts`, its view in
`webview/panel.ts` and `panel.ts`, the `calibrate` pair tool in `bridge.ts`,
the setting the rate is stored in, written by `extension.ts`, and the `say`
pause that reads it in `player.ts`.
Issue #109. The constant `AwaitStore` switches whether playback resumes before
or after the stored rate has been applied; with `FALSE`, TLC violates
`FreshRate` in five steps: `Supply`, `Go`, `StopTimer`, then a `StartSay` timed
with the default rate.

| Spec | Code |
|---|---|
| `Arm`, `Supply` | the Calibrate Reading Speed command, or the calibrate tool, which the bridge refuses unless idle; both add the calibrate pause reason |
| `Go`, `StopTimer` | the programmer typing go and x in the panel; the extension timestamps both |
| `ApplyRate` | `store` awaits the settings write, then `controller.setTiming` applies the new timing; once `store` resolves, `finish` removes the pause |
| `CancelCalibration` | any other reply, the view disposed, the session ending |
| `StartSay` | the reading time computed in the player from the timing in force at that moment |
| `EndSay` | the reading time's sleep ending |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| a say timed with a third rate | `TypeOK` |
| `Arm` does not pause | `PauseMatchesPhase` |
| `AwaitStore = FALSE`, the code before | `FreshRate` |
| the settings write is never applied: no fairness on `ApplyRate` | `StoreLands` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `PauseMatchesPhase` | `calibration.test.ts`: PauseMatchesPhase, FreshRate, StoreLands: measures the rate from go to x over the passage's characters, and holds the pause until the rate is stored; PauseMatchesPhase: cancels on any other reply, with nothing stored |
| `FreshRate`, `StoreLands` | `calibration.test.ts`: PauseMatchesPhase, FreshRate, StoreLands: measures the rate from go to x over the passage's characters, and holds the pause until the rate is stored |

### `PointFocus`: the view on a reply and on Resume

`resume` in `packages/core/src/controller.ts` and the `reply` message in
`packages/vscode/src/panel.ts`, with the scene's `focus` from `player.ts` and
the away pause from `editor.ts`. Found while working on #109: the view followed
a point until the next cursor action, so a reveal after the programmer had
looked away brought back a point from long ago, reopening a file they had
closed. `DropStaleFocus` switches that fix; with `FALSE`, TLC violates
`NoStaleReveal` in three steps: `Point`, `LookAway`, `ResumeAll`. Issue #125: every
typed reply revealed the target, since typing a draft pauses playback and a
reply lifts the pause, so a reply reopened a file the programmer had closed or
took them off the one they had switched to. `RevealOnReply` switches that fix;
with `TRUE`, TLC violates `ReplyKeepsView` in two steps: `LookAway`, `SendReply`.

| Spec | Code |
|---|---|
| `Point`, `ActAtCursor` | a `point` action setting the focus; the next cursor action taking it back, and showing its file (`player.ts`, `editor.show` before each edit) |
| `LookAway` | `onActiveEditor` away from the target: `pause("away")` |
| `CloseTab` | the programmer closing the target's tab, or every tab: `onActiveEditor(undefined)` returns early, so nothing pauses |
| `SendReply` | the panel's `reply`: `resume(undefined, { reveal: false })`, then `userMessage`; a stale point is dropped, and nothing is revealed |
| `ResumeAll` | the Resume button: `resume()`: with an away pause among the reasons and the focus on a point, the focus returns to the cursor and the editor is rendered before `reveal` |

Each invariant was proved to bite with a mutation of a copy of the model, run
in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `RevealOnReply = TRUE` | `ReplyKeepsView` |
| `DropStaleFocus = FALSE` | `NoStaleReveal` |
| `ActAtCursor` leaves the active editor | `CursorShown` |
| a point to a file outside `Files` | `TypeOK` |

Every invariant names the test that proves the code obeys it; the test's title
carries the invariant's name:

| Invariant | Proved by |
|---|---|
| `NoStaleReveal` | `controller.test.ts`: NoStaleReveal, ReplyKeepsView: a resume after a look-away reveals the cursor, not the point, and a reply reveals nothing |
| `ReplyKeepsView` | `controller.test.ts`: NoStaleReveal, ReplyKeepsView: a resume after a look-away reveals the cursor, not the point, and a reply reveals nothing |
| `CursorShown` | `player.test.ts`: CursorShown, ActAtCursor: brings the view back from far-pointed code with a far pause, and from near code with none |
| `TypeOK` | Nothing: the TypeScript compiler checks these types |

### `Start`: the Start a session button

`packages/vscode/src/panel.ts` (`askStart`, the `ready` and `start` messages),
`setup.ts` (`claudeStarter`), and `webview/panel.ts` (`canStart`, the button),
with `extension.ts` asking again after Set Up Agent. Issue #107. A page asks
once as it loads; the answer comes later, from Claude Code's configuration and
its CLI, both read when asked; pages come and go; the environment flips. Two
constants switch fixes the model found before the code was reviewed against it.
`DropStale`: the panel posted every answer to whatever view it had; with
`FALSE`, TLC violates `OwnAnswer` in three steps: `LoadPage` (page 2 loads),
then page 1's `AnswerCheck` lands on page 2. Issue #192 numbered the questions:
the model's `DropStale` had let any answer for the live page through, where the
code posts only the latest question's; with that rule, TLC violates
`LatestAnswerProp` in three steps: `FlipSetUp` asks again, its `AnswerCheck`
lands, then the first question's `AnswerCheck` lands after it. #200 made it an
action property: as an invariant over the newest answer, it also counted an
answer the page drops, so it failed on correct behavior once the bound allowed
two asks in flight, which `MaxEnvironmentChanges = 2` had hidden; the bound is
now 4. The same issue moved
the CLI check to the ask, where `available()` reads it. `ReaskOnSetUp`: the
page asked only as it loaded; with `FALSE`, TLC violates `ReaskedProp` in three
steps: `AnswerCheck` (hidden), then `FlipSetUp` sets Claude Code up with
nothing pending.
Issue #115 added how a start lands. `InTerminal`: the starter ran Claude Code's
open command, which brings Claude Code to the front with the prompt unsent and
writes `panel` to `claudeCode.preferredLocation`; with `FALSE`, TLC violates
`KeepsLocation` and `StaysOnPair` in two steps: `AnswerCheck` shows the
button, then `Click`. `OneAgent`: a second start while the first agent runs;
with `FALSE`, TLC violates `OneAtATime`. Issue #118 added the note the click
shows, Starting a
session with Claude Code, until a session starts. `NoteOnClick`: the page
changed nothing until the agent's `start` landed; with `FALSE`, TLC violates
`AcknowledgedProp` on the first `Click`. `ClearOnExit`: the note went only with
a session, so a CLI that exited without starting one left it up; with `FALSE`,
TLC violates `NoteGoes`: `Click`, then `AgentExits`, and the note stays.

| Spec | Code |
|---|---|
| `LoadPage` | `ready`: `askStart` numbers the question and calls `available()`, which reads `isSetUp` at once |
| `AnswerCheck(c)` | `available()` resolving with what it read when asked: Claude Code set up, the CLI found, a folder open; `canStart` is posted only if the question is still the latest; the page sets `hidden` |
| `Dispose` | `onDidDispose`; the next page starts hidden |
| `FlipSetUp` | Set Up Agent run or undone; `extension.ts` calls `askStart` after Set Up Agent |
| `FlipCliAndFolder` | Claude Code's CLI installed or removed, or the folder closed |
| `Click` | the button posting `start`; `starter.start()` creates a terminal, never shown, whose process is `claude -p "start pairing session" --allowedTools mcp__pair`, unless its last terminal is still open; the page shows the note before it posts `start` |
| `AgentExits` | the CLI exiting when the session ends; its terminal closes, and `onDidCloseTerminal` clears the starter's terminal and resolves the promise `start()` returned, and the panel posts `startEnded`, which hides the note |
| `Choose(l)` | the programmer, or Claude Code's own commands, setting `claudeCode.preferredLocation` |
| `StartSession` | the `session` event reaching the page: `handle`'s `session` case hides the note |
| `EndSession` | the session ending: the idle view and its button are back |

Checked one property at a time, each mutation failed on the properties named and
no others, and passed with them left out. Each invariant was proved to bite with
a mutation of a copy of the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Choose` sets a location outside `Locations` | `TypeOK` |
| `DropStale = FALSE` | `OwnAnswer` and `LatestAnswerProp` |
| `AnswerCheck` posts any answer for the live page, the model before #192 | `LatestAnswerProp` |
| `ReaskOnSetUp = FALSE` | `ReaskedProp` |
| `AnswerCheck`'s value ignores `cliAndFolder` | `GroundedProp` |
| `AnswerCheck` reads `cliAndFolder` when it lands, not when asked | `GroundedProp` and `Offered` |
| `Click` without a run | `StartsAreClicks` |
| `Click` while hidden | `ClicksNeedButtonProp` |
| `AnswerCheck` never delivered | `Offered` |
| `InTerminal = FALSE` | `KeepsLocation` and `StaysOnPair` |
| `Click` writes `panel` to the setting | `KeepsLocation` |
| `Click` brings Claude Code to the front | `StaysOnPair` |
| `OneAgent = FALSE` | `OneAtATime` |
| `Click` starts no agent | `StartsProp` and `NoteGoes` |
| `AgentExits` never happens | `Closes` and `NoteGoes` |
| `NoteOnClick = FALSE` | `AcknowledgedProp` |
| `ClearOnExit = FALSE` | `NoteGoes` |
| `StartSession` leaves the note | `NoteUntilSession` |
| `Dispose` leaves the note | `NoteUntilSession` |
| `Click` during a session | `NoteUntilSession` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types, in `Starter`, `FromPanel`, and `ToPanel` |
| `OwnAnswer` | `panel.test.ts`: OwnAnswer: drops the answer of a page replaced before it landed, so it cannot set its successor's button |
| `LatestAnswerProp` | `panel.test.ts`: LatestAnswerProp: drops an earlier question's answer that lands after the reask's, on the same page |
| `GroundedProp` | `setup.test.ts`: GroundedProp: offers the button only once Claude Code is set up, its CLI is here, and a folder is open |
| `StartsAreClicks` | `panel.test.ts`: StartsAreClicks: runs the starter once per start from the page; `webview/panel.test.ts`: StartsAreClicks: posts start when the button is clicked; `setup.test.ts`: StartsAreClicks, StartsProp, StaysOnPair, KeepsLocation: runs the CLI with the prompt in a terminal it never shows, once per start |
| `ClicksNeedButtonProp` | `webview/panel.test.ts`: ClicksNeedButtonProp: hides Start a session until the extension says it can start one |
| `Offered` | `panel.test.ts`: Offered: tells a new page whether it can start a session |
| `ReaskedProp` | `panel.test.ts`: ReaskedProp: asks again after Set Up Agent, so the button appears without a reload; `extension.test.ts`: ReaskedProp: sets the agent up, and offers the panel the start again |
| `KeepsLocation`, `StaysOnPair`, `StartsProp` | `setup.test.ts`: StartsAreClicks, StartsProp, StaysOnPair, KeepsLocation: runs the CLI with the prompt in a terminal it never shows, once per start |
| `OneAtATime` | `setup.test.ts`: OneAtATime, Closes: starts no second agent while the first one's terminal is open, and starts again once it closes |
| `Closes` | the same test, for the terminal closing. Nothing yet proves the CLI exits when the session ends; that needs a run in the editor |
| `AcknowledgedProp` | `webview/panel.test.ts`: AcknowledgedProp: shows the starting note at once when the button is clicked |
| `NoteUntilSession` | `webview/panel.test.ts`: NoteUntilSession: hides the starting note when a session starts, new or resumed |
| `NoteGoes` | `webview/panel.test.ts`: NoteGoes: hides the starting note once the agent has exited, with no session; `panel.test.ts`: NoteGoes: tells the page once the agent a start ran has exited; `setup.test.ts`: NoteGoes: resolves a start once its agent's terminal closes, a refused start with it, and one that runs nothing at once |

### `Actions`: what an interrupted batch reports as unplayed

The unplayed actions of an interrupted batch come back in order, and
resubmitting them plays nothing twice: `actions` and `perform` in
`packages/core/src/player.ts`. Each action is its steps between awaits, read
from the code: awaits, checks of a sleep's or `confirm`'s result or of
`notStarted`, and effects the programmer sees. An interrupt comes at any await.
Two defenses keep that. A `type` cut after a chunk returns only what's left of
it (`RestOnly`), and a `run` interrupted while its command keeps running counts
as played (`ConsumeRun`).

| Spec | Code |
|---|---|
| `Steps(k)` | each action's awaits, checks, and effects; `type` with two chunks; `type0`, a `type` with nothing to type, which returns `nothing` |
| `Complete` | `actions` returning `completed` after its last action |
| `StopBeforeAction` | the loop in `actions` checking `isInterrupted` before each action |
| `TakeEffect`, `Proceed` | the action's steps in `perform`: an effect, an await, or a check that finds no interrupt |
| `StopAtCheck` | a check that finds the timeline interrupted: a sleep's result, `confirm`, or `notStarted`; a `type` cut after a chunk returns its `chunksLeft` |
| `StopWhileRunning` | `run` interrupted while its command runs on: `consumed` |
| `FinishAction` | the loop in `actions` going on to the next action |
| `Stop` | `stopped(id, unplayed, effect)`: `discarded` unless an earlier action changed the screen (the `effect` flag in `actions`), or this one typed part of its text or left its command running |
| `Interrupt` | the timeline interrupted, by an edit, a message, a turn change |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Complete` reports a fifth status, "done" | `TypeOK` |
| `RestOnly = FALSE`: a cut `type` returns all of its text | `PlaysNothingTwice` |
| `ConsumeRun = FALSE`: an interrupted `run` whose command runs on is returned as unplayed | `PlaysNothingTwice` |
| `StopBeforeAction` ignores the earlier actions' effects | `DiscardedMeansNothing` |
| an await never returns: `Proceed` leaves `pc` as it was | `EventuallyReported` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `PlaysNothingTwice` | `session.e2e.test.ts`: PlaysNothingTwice: returns what's left of a type cut inside its second part; PlaysNothingTwice, DiscardedMeansNothing: stops waiting when the programmer interrupts, reporting the command as still running; `player.test.ts`: PlaysAfterCompleted, PlaysNothingTwice, StopAtCheck: hands back what's left of a type cut short, before the marker or after it, and nothing if none was typed; StopWhileRunning: reports a command running on, posts its exit when it ends, and counts it as played when interrupted |
| `DiscardedMeansNothing` | `session.e2e.test.ts`: DiscardedMeansNothing: discards a batch interrupted after a type with nothing to type, which changed nothing (specs/Actions.tla); PlaysNothingTwice, DiscardedMeansNothing: stops waiting when the programmer interrupts, reporting the command as still running; `player.test.ts`: Stop: discards a batch interrupted before its first action, and reports no code for it |
| `EventuallyReported` | `session.e2e.test.ts`: EventuallyReported: runs a command, reporting its output and exit code with the batch; `player.test.ts`: SaveAndRun: saves the batch first, runs in the root, waits as long as asked within the most, and reports the run |

### `Player`: a delete while the programmer edits

The `delete` action in `packages/core/src/player.ts`, between its awaits, while
the programmer types in front of the selection or behind it. `ReadAfterAwait`
and `CheckInterrupt` are the fix for #49.

| Spec | Code |
|---|---|
| `StartDelete`, `Finish` | the delete: before #49 it copied the selection, then awaited `show` and `getText` |
| `TypeBefore`, `TypeAfter` | a programmer's edit: `transform` moves the live selection, and the edit interrupts |
| `Finished` | the delete is done; the run ends |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Finish` stops with a third outcome, "stopped" | `TypeOK` |
| `Finish` deletes one past the selection | `DeletesTheSelection` |
| `ReadAfterAwait = FALSE`, `CheckInterrupt = FALSE`, the code before #49 | `DeletesTheSelection` |
| `CheckInterrupt = FALSE` | `EditInterrupts` |
| no fairness on `Finish` | `DeleteEnds` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `DeletesTheSelection` | `session.e2e.test.ts`: DeletesTheSelection: replaces a selection by typing, and deletes a selection; `player.test.ts`: types over the selection, deletes it when there is nothing to type, and with neither changes nothing |
| `EditInterrupts` | `session.e2e.test.ts`: EditInterrupts: stops a delete when the programmer edits while it starts, and deletes nothing; `player.test.ts`: TakeEffect: stops before any effect when an edit interrupts it while the file is read (#49); `controller.test.ts`: NetReported, EditInterrupts: reports programmer edits as one diff a file, the agent cursor moving with them |
| `DeleteEnds` | `session.e2e.test.ts`: DeleteEnds: a delete held at its awaits ends once they return, removing the selected text; `player.test.ts`: Finish: deletes the selection, reading it only once the file is shown, and pauses after |

### `BatchFile`: the file each action of a batch acts in

`names`, `fileOf`, `type` and `delete` in `packages/core/src/player.ts`, over
every sequence of up to 4 actions, each with `file` of `sourceFile`,
`destinationFile`, `otherFile`, or none, from any cursor. A `point` names a
file without moving the cursor, so with the cursor
elsewhere an action without `file` looked in the cursor's file, and a `type` or
`delete` edited it. `FallBackToNamed` and `CursorInNamed` are the fix for #58.
Every editing batch must now name its file before the first edit (#6). The model
refuses the edit; the controller preflights the batch before any action plays.

| Spec | Code |
|---|---|
| `Act` | `perform`: `names`, then `fileOf` for `move`, `select` and `point`, or the cursor for `type` and `delete` |
| `Say` | a `say` or `run`, which act in no file |
| `ActInFile` | `move`, `select` and `point` in the file `fileOf` gives; only `move` and `select` move the cursor |
| `ActAtCursor` | `type`, `newline` and `delete` at the cursor, rejected without a named file or with the cursor outside it, and a `delete` with nothing selected (`no_selection`) |
| `Stop` | an action that fails: two files named, a file named after an edit, `no_cursor`, the cursor outside the named file, or a `delete` with nothing selected; the other ways an action fails (a text not found, the programmer's turn) are other specs' |
| `EndBatch` | a new `Playing` for the next batch; the cursor stays |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a rejected action's file is the string `"none"`, the sentinel before #148 | `TypeOK` |
| `FallBackToNamed = FALSE`, the code before #58 | `ActsInNamedFile` |
| `CursorInNamed = FALSE`, the code before #58 | `ActsInNamedFile` |
| `ActAtCursor` permits an edit in a batch that named no file | `EditRequiresNamed` |
| `EditAtCursorProp` without `k = "delete" => selected`: a `delete` with nothing selected must edit | `EditAtCursorProp` |
| `ActAtCursor` refuses a `delete` even with a selection | `EditAtCursorProp` |
| `move` makes a selection | Nothing: no property says a `delete` after a `move` fails; `player.test.ts` does |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ActsInNamedFile` | `session.e2e.test.ts`: ActsInNamedFile: looks in the file its batch named for an action without `file`, not the cursor's; ActsInNamedFile: looks in the file its batch named before the agent's cursor is in any file; ActsInNamedFile: rejects a type or delete with the cursor outside the file its batch named, editing nothing; `player.test.ts`: Act: refuses a second file in a batch, and a file named after its first edit; ActAtCursor: refuses a type or delete when the cursor is in another file than the batch's |
| `EditAtCursorProp` | `session.e2e.test.ts`: EditAtCursorProp, EditRequiresNamed: types and deletes only after naming the cursor's file; `player.test.ts`: EditAtCursorProp: refuses a move, select, point, or type before the cursor is anywhere, and a delete with nothing selected |
| `EditRequiresNamed` | `controller.test.ts`: EditRequiresNamed: refuses an unnamed editing batch before rehearsal, while allowing named edits and non-editing batches; `session.e2e.test.ts`: EditAtCursorProp, EditRequiresNamed: types and deletes only after naming the cursor's file |

### `Diagnostics`: advisory checks after edits

The controller checks only files actually edited by a batch, after playback.
Available observations are advisory and never change its result. This model
abstracts provider availability and outcomes; changing sessions or source text
while a check runs is covered by tests, not modeled here.

| Spec | Code |
|---|---|
| `Edit` | successful editor edits recorded by `Player` |
| `Finish` | `Controller.run` collects a snapshot without changing the batch result |
| `NextBatch` | the next batch starts with its own edited-file set |

Each behavioral invariant was checked with a mutation and then restored:

| Mutation | Breaks |
|---|---|
| observe even when no edit happened | `OnlyEdited` |
| suppress observations from an available provider | `ObserveWhenAvailable` |
| force a failed result regardless of playback | `OutcomeUnchanged` |
| disable batch completion | `Advisory` |

| Invariant | Proved by |
|---|---|
| `TypeOK` | TypeScript checks these types |
| `OnlyEdited`, `ObserveWhenAvailable`, `OutcomeUnchanged`, `Advisory` | `controller.test.ts`: OnlyEdited, Advisory: reports diagnostics only for files actually edited and does not reject the batch |

### `Draft`: the reply box's pause, across the view's page

`packages/vscode/src/webview/panel.ts` (`syncDraft`, `takeDraft`) and `panel.ts`
(`draft`, `reply`, `ready`, `onDidDispose`), with `Controller.pause` and
`resume`. A draft in the reply box pauses playback for the reason "reply".
`ClearOnReady` is the fix for #69: a new page (`ready`) and a disposed view have
no draft, so they remove that reason. `ClearOnTaken` is the fix for #191: a
reply the reading speed calibration takes empties the box without a `draft`
message, so the panel removes the reason itself.

| Spec | Code |
|---|---|
| `TypeDraft`, `Clear` | `syncDraft` posting `draft` when the box's emptiness changes; `takeDraft` on sending or handing the turn back |
| `SendToCalibration` | the `reply` message while a calibration runs: `calibration.reply` takes it, and `resume('reply')` |
| `ResumeAll` | the Resume button, sending a reply, or the turn button: `resume()` with no reason |
| `Dispose`, `LoadPage` | `onDidDispose`; a page loaded, in a new view or by "Reload Webviews", posting `ready` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `Dispose` sets the view to a third state, "closed" | `TypeOK` |
| `ClearOnReady = FALSE`, the code before #69 | `ReplyMeansDraft` |
| `ClearOnTaken = FALSE`, the code before #191 | `ReplyMeansDraft`: `TypeDraft`, `SendToCalibration` |
| `TypeDraft` leaves the pause as it was | `DraftPausesProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ReplyMeansDraft` | `panel.test.ts`: ReplyMeansDraft: ends the draft's pause when the view is disposed with it; ReplyMeansDraft: ends the draft's pause when the view's page reloads, keeping a pause the programmer asked for; ReplyMeansDraft: a reply the calibration takes ends the draft's pause; any other resumes without revealing and is sent on |
| `DraftPausesProp` | `panel.test.ts`: DraftPausesProp: a draft in the reply box pauses playback |

### `RunBox`: the panel's run box

One `run`: the phases `runCommand` in `packages/core/src/player.ts` posts, and
the page's `case "run"` and `setActive` in `webview/panel.ts`. Every way a run
ends posts a phase other than `confirm` and `running`, which clears the box:
skipped or interrupted at the confirmation (`declined`), a command that never
started or threw (`declined`), and one that ran (`done`, `background`). A
session ending clears it too.

| Spec | Code |
|---|---|
| `SaveAndConfirm`, `SaveAndRun`, `FailSave` | after `save`: `confirm` with confirmation on, else `running`; a failed save posts nothing |
| `Go`, `Decline` | `confirm` resolving: `running`, or `declined` for a skip or an interrupt |
| `FinishCommand` | `editor.runCommand`: `done` or `background`, or `declined` for `notStarted` or a throw |
| `EndSession` | the session ending: `setActive(false)` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted. Under the fairness, BoxMatches implies Clears, so Clears'
mutation ran with BoxMatches left out of the config:

| Mutation | Breaks |
|---|---|
| the box shows every phase | `TypeOK` |
| `Go` posts nothing, so the box says confirm while the command runs | `BoxMatches` |
| `ClearOnEnd = FALSE` | `Clears` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `BoxMatches` | `webview/panel.test.ts`: BoxMatches: shows the box while a command waits for a decision, and while it runs |
| `Clears` | `webview/panel.test.ts`: Clears: a %s phase clears the box (done, background, declined); Clears: the session ending clears the box |

### `FileText`: the text the session takes for a file

`getText` and `show` in `packages/vscode/src/editor.ts`, for #88 and #89. One
file, on disk or absent, and a document VS Code may hold for it, with or without
a tab. VS Code keeps a document after its file is deleted, and reloads one
without unsaved changes some time after its file changes. `PreferDirty` is the
fix for both: a document with unsaved changes is the programmer's text;
otherwise a file not on disk is reported missing (`MissingIsReported`); and
`show` creates a missing file by emptying and saving a document VS Code kept
for it, never one with unsaved changes (`KeepsUnsavedProp`).

| Spec | Code |
|---|---|
| `GetText` | `getText` -> `document()`: `openDocument()`, `exists()`, `openTextDocument` |
| `OpenDocument`, `CloseDocument`, `Edit`, `Save`, `Reload` | VS Code's documents: opened by anything, dropped, edited, saved (recreating a deleted file), reloaded |
| `Write`, `Delete` | the file changed or deleted on disk |
| `Show` | `show` -> `create`, for a `move` to the file |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `show` writes a text outside `Contents` | `TypeOK` |
| `PreferDirty = FALSE`, the code before #88 and #89 | `NotStale` |
| the fixed `getText` throws for an empty file with no document | `MissingIsReported` |
| `show` writes a file that is not empty | `CreatedIsEmpty` |
| the fixed `show` keeps the old guard, so it empties unsaved text | `KeepsUnsavedProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NotStale`, `MissingIsReported`, `CreatedIsEmpty`, `KeepsUnsavedProp` | `integration.ts`, in VS Code: NotStale, MissingIsReported, CreatedIsEmpty, KeepsUnsavedProp: missing and deleted files read as missing, and are created empty; `editor.test.ts`: NotStale: takes the text of a document with unsaved changes, whether its file exists or not; MissingIsReported: reports a file that isn't on disk as missing, whatever document VS Code kept; CreatedIsEmpty: creates a missing file empty, with its folder, and says it wrote it; CreatedIsEmpty: empties and saves the document VS Code kept for a deleted file; KeepsUnsavedProp: leaves a deleted file's document with unsaved changes as it is, and shows it |

### `Outside`: marking files changed outside the protocol

The feature of #15, specified before its code: `outside.ts` and
`outside_watch.ts` in `packages/vscode/src`. One file, written by VS Code's
saves, by the extension's own `show`, and by anything else; a watcher that
reports writes late and merges them. The code marks a file when a group of
writes settles, if the file differs from the text it knows: the last VS Code
wrote, or the programmer saw. A timing assumption: VS Code tells of a save
(`onDidSaveTextDocument`) within milliseconds, before the group settles, and
nothing the programmer does falls in between.

| Spec | Code |
|---|---|
| `Save`, `NotifySave` | a document saved; `onDidSaveTextDocument` -> `saved` |
| `Show` | `show` creating a missing file -> `wrote` -> `saved` |
| `WriteOutside` | anything else writing the file; an open document without unsaved changes reloads |
| `WatcherReports` | the watcher's events -> `reported`; the group settles -> `settle` reads and compares |
| `OpenDocument` | opening the file or its diff -> `seen` |
| `FocusDocument` | the file's open document becoming the active editor again -> `seen`, which reads the disk |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted. The other rules and an unsettled decision all break
NoFalseMark, so Marks has a mutation of its own:

| Mutation | Breaks |
|---|---|
| an outside write leaves content 0 | `TypeOK` |
| `Rule = "every"`, `Rule = "afterSave"`, or `Settle = FALSE` | `NoFalseMark` |
| `FocusDocument` leaves the known text as it was | `NoFalseMark` |
| `FocusDocument` takes the document's text, not the disk's | `NoFalseMark` |
| `FocusDocument` leaves the mark | `NoFalseMark` |
| the content rule never marks | `Marks` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoFalseMark` | `outside.test.ts`: NoFalseMark: doesn't mark a save, or a file the extension created; NoFalseMark: clears the mark when the programmer sees the file, and a late event for what they saw doesn't bring it back; NoFalseMark: doesn't mark a file the programmer saw before its writes settled |
| `Marks` | `outside.test.ts`: Marks: marks a file written outside once its writes settle, and reports it; Marks: marks a write the watcher reports in one event with a save (the afterSave rule misses it) |

### `ProjectGuide`: which project guides `start` reads

The feature of #23, specified before its code: `projectGuides` in
`packages/relay/src/guide.ts`. Checked over every small tree, as `ASSUME`s:
walking up from the working directory to the workspace folder gives exactly the
guides on that path that git doesn't ignore, outer first, and none above the
folder. Walking past the folder, or reading an ignored guide, is caught. Like
the pure functions below, it is `ASSUME`s alone, with a config of constants.

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted.
Exactly implies Contained, so Contained's mutation ran without Exactly's
`ASSUME`:

| Mutation | Breaks |
|---|---|
| the walk skips the workspace folder's own guide | `Exactly` |
| `Found` without `Reverse`: innermost first | `OuterFirst` |
| the walk reads guides git ignores | `Contained` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `Exactly` | `guide.test.ts`: Exactly, OuterFirst, Contained: reads the guides from the workspace folder down to the working directory, outer first; Exactly, Contained: leaves out a guide git ignores |
| `OuterFirst` | `guide.test.ts`: Exactly, OuterFirst, Contained: reads the guides from the workspace folder down to the working directory, outer first |
| `Contained` | both tests above |

### `Resume`: a session that waits for its agent

The feature of #25, specified before its code: `disconnect`, `start`,
`resumeSession`, `saved`, `revive` and `endSession` in
`packages/core/src/controller.ts`, with the extension saving the session in the
workspace's storage (`extension.ts`). A session whose agent disconnects, or that
the window reloads with, is suspended, not ended, and waits until the programmer
ends it or a `start` resumes it. Checked: a `start` from its directory resumes
the same session (`ResumesSameProp`); it leaves the suspended state only to
resume, end, or give way to a session from another directory (`WaitsProp`); a
session the programmer ended has its agent to tell, or is closed
(`EndedHasAgent`); the storage holds the session as it is (`SavedIsCurrent`); a
message isn't lost while it waits, or across a reload (`NotLostProp`); a message
the agent can be sent reaches it (`Arrives`); and the panel shows the session as
it is (`ShownIsState`; #138: after a reload, the replayed history showed a
suspended session as live). The spec saves with every change; the code saves 200
ms after the last one and again as the window goes, so a reload within 200 ms of
a change relies on that last save.

| Spec | Code |
|---|---|
| `Connect`, `Disconnect` | a relay's socket opening and closing; `disconnect()` suspends an active session, and closes one the programmer ended (no session) |
| `ReloadWindow` | the window reloading: `activate` revives the saved session, suspended (`revive`), with the panel's history; `revive` posts the suspended event (`PostOnRevive`), and the page adds its divider only when the session goes between live and suspended |
| `Start(d)` | `start`: a suspended session from `d` resumes (`resumeSession`); another directory ends it and starts a new one |
| `EndByProgrammer`, `EndByAgent` | `endSession`: an active session is ended, a suspended one closed at once (no session); the agent's `end` |
| `CloseEnded` | `finishCall` closing an ended session with its last report |
| `SendMessage`, `Report` | `userMessage`, to an active or a suspended session; the next report, once the agent is back |
| `Store` | `onChange` and `onPost`: the extension writes `stored` and the panel's history 200 ms after a change, and as the window goes |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `EndByAgent` leaves a fifth state, `"closed"` | `TypeOK` |
| `PostOnRevive = FALSE`, the code before #138 | `ShownIsState` |
| `ClearOnReplace = FALSE`, preserving the previous suspended display | `ShownIsState` |
| `SendMessage` leaves `stored` unchanged | `SavedIsCurrent` |
| `Start(d)` never resumes: a new session from any directory | `ResumesSameProp` |
| `ReloadWindow` brings back no session, checked without `ShownIsState`, which fails first | `WaitsProp` |
| `ReloadWindow` drops the pending message | `NotLostProp` |
| `Spec` without `Fairness`, `WF_vars(Report)` | `Arrives` |
| `EndByProgrammer` ends a suspended session as `"ended"`, the model before #200 | `EndedHasAgent` |
| `Disconnect` leaves an ended session ended | `EndedHasAgent` |
| a suspended session closed while connected by other than `EndByProgrammer` | `WaitsProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `SavedIsCurrent`, `NotLostProp` | `controller.test.ts`: SavedIsCurrent, NotLostProp: saves a session for the window, and none once it ended; SavedIsCurrent, NotLostProp, ShownIsState: brings back a session the window saved, suspended, after a reload |
| `ResumesSameProp`, `Arrives` | `controller.test.ts`: ResumesSameProp, Arrives: suspends a session the agent disconnects from, and resumes it on a start from its directory |
| `WaitsProp` | `controller.test.ts`: WaitsProp: starts a new session from another directory, ending the suspended one; WaitsProp: closes a suspended session at once when the programmer ends it |
| `EndedHasAgent` | `controller.test.ts`: WaitsProp: closes a suspended session at once when the programmer ends it; EndedHasAgent: rejects the open call when the agent disconnects, and closes at once a session the programmer ended |
| `ShownIsState` | `controller.test.ts`: SavedIsCurrent, NotLostProp, ShownIsState: brings back a session the window saved, suspended, after a reload; `webview/panel.test.ts`: ShownIsState: a session revived after a reload shows as suspended; ShownIsState: a revive after a disconnect shows the suspension once; ShownIsState: a replacement session clears an old suspension (live and replay) |

### `Navigator`: the programmer's edits, reported when they pause

`userEdit`, the navigator timer, `navigatorReady` for `listen`, and `snapshot` in
`packages/core/src/controller.ts`. During the programmer's turn, a `listen`
returns for their edits only once they pause typing (`navigatorIdleMs` after
their last edit), so the agent comments on a whole thought. `ResetReady` is the
fix: an edit takes back `navigatorReady`, which a pause before it set, so a
`listen` made after the programmer resumes typing waits for their next pause.

| Spec | Code |
|---|---|
| `EditAsProgrammer` | `userEdit` in the programmer's turn: `recordEdit`, `navigatorReady = false`, the timer started again |
| `Lull`, `Fire` | `navigatorIdleMs` without an edit; the timer setting `navigatorReady` and calling `pump()` |
| `Listen`, `Return`, `Timeout` | `listen`; `navigatorReady` holding, and `snapshot` clearing `navigatorReady`; `maxBlockMs` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `Listen` sets the call to a third state | `TypeOK` |
| `ResetReady = FALSE`, the code before | `NotWhileTyping` |
| `Fire` leaves `navigatorReady` unset, so no call returns for the edits | `EditsReported` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NotWhileTyping`, `EditsReported` | `controller.test.ts`: NotWhileTyping, EditsReported, QuietDelivered: waits in the programmer's turn until they pause typing, or hand the turn back |

### `ListenGrace`: "Your move" between two idle listens

`state`, `finishCall`, `serialize`, `read`, and `close` in
`packages/core/src/controller.ts`. Issue #126: a `listen` that times out at
`maxBlockMs` with nothing to report leaves no call open until the agent's next
`listen`, a few seconds later, and the status showed "Agent is thinking" in that
gap. `Grace` is the fix: such a timeout keeps the status "listening" for
`listenGraceMs`, until the agent's next call, or until the programmer does
something that wakes a `listen`. The grace changes only the status, not when a
call returns or what a report holds, so no other spec changes. Issue #149: an
agent that stopped calling left the status at "Agent is thinking", so the
programmer could not tell it was gone. `ShowAbsent` is the fix: once no call
has been open for `absentMs`, the status is "absent" ("Agent isn't listening")
until the agent calls again. Issue #194: only a call that blocked ended the
grace, so "Your move" stayed through a `read`, and after a step refused at
once, with its rejection to act on. `EndOnAnyCall` is the fix: every call ends
it. `Scroll` reads the status only through `FOLLOWING` in `editor.ts`, which
holds "thinking", "absent", and "listening".

| Spec | Code |
|---|---|
| `Status` | `state()` with the queue empty |
| `Call` | a call that blocks arriving: `serialize` counting it in `openCalls`, ending the quiet with `endQuiet` and the grace with `endGrace`, then `block()`; `close` ends both |
| `Read` | `read`: `endGrace`, and the quiet restarted at once |
| `FailRehearsal` | a `step` answered by `rejectBatch` or `rejectUnanchored`: `serialize` ended the grace, the agent owes a response to the rejection, and the report takes the events |
| `Timeout` | `finishCall` for a `listen` with `waiting` and no batches, events, or rejection: `startGrace` |
| `QuietNews`, `TimeoutWithNews` | a batch completing, or an edit `interrupting` does not hold for, which wakes no `listen`; `finishCall` for a `listen` with `waiting` and such news: no grace |
| `Return` | `finishCall` with anything else |
| `Interrupt` | an event `interrupting` holds for: a message, an interrupt, an edit of the programmer's, a turn change |
| `Expire` | the grace timer firing after `listenGraceMs` |
| `GoAbsent` | the quiet timer firing `absentMs` after the last open call settled: `startQuiet`, from `serialize` once `openCalls` is 0, and from `read` |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a call outside `Calls` | `TypeOK` |
| `Grace = FALSE`, the code before | `NoFlicker` |
| `Status` ignores `unreported` | `NoYourMoveAfterInterrupt` |
| `Return` starts the grace too | `NoFalseYourMove` |
| `Expire` leaves the grace set | `GraceEnds` |
| `Call` leaves the grace set | `NoYourMoveInOtherCall` |
| `ShowAbsent = FALSE`, the code before #149 | `AbsentShows` |
| `EndOnAnyCall = FALSE`, the code before #194 | `NoFalseYourMove`: `Call("listen")`, `Timeout`, `FailRehearsal` |
| `Call` leaves `absent` set, checked without `NoYourMoveInOtherCall`, which it breaks first | `AbsentWithoutCall` |
| `TimeoutWithNews` starts the grace | `NoFalseYourMove` |
| `Timeout` ignores `quietNews` | `NewsSkipsGraceProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoFlicker` | `controller.test.ts`: NoFlicker, GraceEnds: keeps listening after a listen times out with nothing to report, until the grace runs out |
| `GraceEnds` | `controller.test.ts`: NoFlicker, GraceEnds: keeps listening after a listen times out with nothing to report, until the grace runs out |
| `NoFalseYourMove` | `controller.test.ts`: NoFalseYourMove, NewsSkipsGraceProp: shows thinking when a listen times out with a batch to report; NoFalseYourMove: ends the grace when the agent reads, and when its step is refused at once (#194) |
| `NoYourMoveAfterInterrupt` | `controller.test.ts`: NoYourMoveAfterInterrupt, NoYourMoveInOtherCall: shows thinking when the programmer acts, or the agent calls, during the grace |
| `NoYourMoveInOtherCall` | `controller.test.ts`: NoYourMoveAfterInterrupt, NoYourMoveInOtherCall: shows thinking when the programmer acts, or the agent calls, during the grace |
| `AbsentWithoutCall` | `controller.test.ts`: AbsentShows, AbsentWithoutCall: says the agent is not listening once no call has been open for absentMs, until it calls |
| `AbsentShows` | `controller.test.ts`: AbsentShows, AbsentWithoutCall: says the agent is not listening once no call has been open for absentMs, until it calls |
| `NewsSkipsGraceProp` | `controller.test.ts`: NoFalseYourMove, NewsSkipsGraceProp: shows thinking when a listen times out with a batch to report. No test times a listen out with only an edit that interrupts nothing yet |

### `EditEvents`: an edit undone, in the report

`recordEdit`, `otherEdit`, and `snapshot` in `packages/core/src/controller.ts`,
for one file. A report has one edit event per file, its diff from the file's
text at the first edit since the last report. An edit that interrupts (the
programmer's, or a tool's to a file the queued batches edit) discards the
agent's batches. `KeepInterrupts` is the fix: such an edit is reported even when
the file ends up as it was, with an empty diff, so the agent knows why its
batches were discarded. A tool's net-zero edit that interrupted nothing is still
left out.

| Spec | Code |
|---|---|
| `EditAsProgrammer`, `EditAsOther` | `userEdit` and `otherEdit` -> `recordEdit`: a new event only with none pending for the file (`pendingEdit`); the event's `before` (the baseline) and `after`, `by`, `interrupted`; the event holds both texts, so a pending edit always has them (#176) |
| `Report` | `snapshot`: the event, unless the file is unchanged and the edit didn't interrupt |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted:

| Mutation | Breaks |
|---|---|
| an edit to a text outside `Contents` | `TypeOK` |
| an event only for an edit that interrupted | `NetReported` |
| `KeepInterrupts = FALSE`, the code before | `Explained` |
| `Record` adds an event for every edit | `OnePendingEdit` |
| `Report` leaves the events pending | `OnePendingEdit` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NetReported` | `controller.test.ts`: NetReported, EditInterrupts, OnePendingEdit: reports programmer edits as one diff a file, the agent cursor moving with them |
| `OnePendingEdit` | `controller.test.ts`: NetReported, EditInterrupts, OnePendingEdit: reports programmer edits as one diff a file, the agent cursor moving with them |
| `Explained` | `controller.test.ts`: Explained: reports an interrupting edit the programmer undid, and drops a quiet edit by others that was undone |

### `Scroll`: follow mode's scrolling

`renderCursor`, `follow`, `keepInView`, `scroll`, and `glide` in
`packages/vscode/src/editor.ts`, with `comfortable` and `landing` from
`view.ts`, and `resume`'s `reveal` in `controller.ts`. A glide stops early when
the state stops following: a pause, or a command running. A pause ends in
`resume`, which reveals the target. `CatchUp` is the fix: a glide a command cut
short goes on once the command is done, from `renderCursor`; before it, the view
stayed where the glide stopped, with the target possibly out of view. The
programmer's turn drops it. `scrollBeyondLastLine` is
`editor.scrollBeyondLastLine`, either way: with it on (the default), the last
line can scroll to the top. How long a glide takes (#123: `glideMs` in
`controller.ts`, from the timing and the
playback speed) is not modeled: a `Glide` step carries no time, and `Move` and
`Leave` can come between any two frames, so a longer or shorter glide is a run
the model already has.

| Spec | Code |
|---|---|
| `Move` | an action moving the target, and the player's `follow()`; no action plays while a command runs |
| `Leave`, `Follow` | the state leaving the following states (`paused`, `running`, `navigator`) and coming back: `renderCursor`; a pause's end: `resume`'s `reveal`, which a reply turns off (#125), so only the Resume button reveals |
| `Glide` | `glide`'s frames; `scroll`'s `finally` and its follow if the target moved |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Move` moves the target past the file's last line | `TypeOK` |
| `Landing` ignores how far the editor scrolls | `InRange` |
| `CatchUp = FALSE`, the code before the fix | `ComesInView` |
| a finished `Glide` does not follow a target that moved | `ComesInView` |
| `Follow` from a pause does not reveal the target | `ComesInView` |
| `ComesInView` without `~turnSinceFollow`: the view follows a target moved before the programmer's turn | `ComesInView` |
| the turn keeps a glide cut before it | Nothing: a glide picked up after the turn only brings the target in view |
| a glide cut on the programmer's turn is kept | Nothing: as above |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `InRange` | `view.test.ts`: InRange: stops at the top of the document; InRange: stops with the last line at the top when the editor scrolls beyond the end, else at the bottom |
| `ComesInView` | `integration.ts`, in VS Code: ComesInView: a scroll a command cut short went on to line 250; `editor.test.ts`: ComesInView: glides the target to a third of the way down, a frame at a time, leaving room for sticky scroll; ComesInView: a measure that a command cuts short goes on once the command is done; ComesInView: a glide a command cuts short goes on once it is done, not while paused, and not on the programmer's turn; ComesInView: catches up after a glide with a target that moved on in its file, and lets go of one that left it; ComesInView: reveal shows the target and follows it there, and does nothing with no target |

### `Turns`: only talk during the programmer's turn

During the programmer's turn, only `say` and `point` take effect, in
`packages/core/src/player.ts`: `perform` checks the turn as each action starts,
a turn change interrupts (`takeTurn`, `handBack` in `controller.ts`), and each
action that edits checks for an interrupt after its awaits, before its effect. A
batch may start at any time, from either turn, which is more than the controller
allows. `DeleteChecks` is the fix for #49, which also let a `delete` take effect
after the programmer took the turn.

| Spec | Code |
|---|---|
| `StartHead` | `startHead`: the next batch, with `timeline.reset()` |
| `Perform` | the loop in `actions` checking `isInterrupted`; `perform` rejecting with `not_your_turn` |
| `TakeEffect` | the action after its awaits: `type`'s `delay` before each chunk, `delete`'s check after `show` and `getText`, `run`'s `notStarted` after `shellIntegration` |
| `ChangeTurn` | `takeTurn` or `handBack`, which call `interrupt()` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| an action leaves a third phase | `TypeOK` |
| `DeleteChecks = FALSE`, the code before #49 | `OnlyTalkInTheirTurn` |
| `Perform` never moves an action on | `BatchEnds` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `OnlyTalkInTheirTurn` | `controller.test.ts`: OnlyTalkInTheirTurn: takes the turn, interrupting playback, and hands it back with no message or selection; `player.test.ts`: OnlyTalkInTheirTurn, Perform: allows only say and point during the programmer's turn; `session.e2e.test.ts`: OnlyTalkInTheirTurn: stops a delete when the programmer takes the turn while it starts, and deletes nothing |
| `BatchEnds` | `controller.test.ts`: BatchEnds, ReadyAtHead: returns the first step immediately and blocks the second until the first finishes |

### `Reload`: a file changed on disk

Line identities, and the agent's selection staying on its text, through
`otherEdit` and `recordEdit` in `packages/core/src/controller.ts`, with the
change VS Code reports when it reloads a document from disk. Measured in an
integration run, that is one change from the first line that differs to the
last, unchanged lines included. `SplitRuns` is the fix for #65: `lineChanges` in
`diff.ts` splits it into one change per run of changed lines.

| Spec | Code |
|---|---|
| `Reload` | a file changed on disk: `onChange` in `editor.ts` passes VS Code's changes, `otherEdit` -> `recordEdit` moves the scene (`mapThrough`, which keeps a position where a change starts) and the identities (`applyChange`) through them |
| `Runs`, `Coarse` | the changes `recordEdit` is given, with and without `lineChanges` |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted. `SplitRuns = FALSE`, the code before #65, breaks UnchangedKeepIds
first, and SelectionStays with UnchangedKeepIds left out of the config:

| Mutation | Breaks |
|---|---|
| a selection moved past the file | `TypeOK` |
| a selection on an unchanged line moves down one | `SelectionStays` |
| a selection at the start of a changed run moves past it, as one inside it does | `StartOfRunStays` |
| every line gets a fresh id | `UnchangedKeepIds` |
| no line gets a fresh id | `ChangedGetNewIds` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `SelectionStays` | `session.e2e.test.ts`: SelectionStays: keeps the agent's selection on a line between the changed ones |
| `UnchangedKeepIds` | `session.e2e.test.ts`: UnchangedKeepIds: keeps the numbers of the lines between the changed ones known |
| `StartOfRunStays` | `player.test.ts`: StartOfRunStays: keeps a selection that starts where a change starts, and moves its end past the change |
| `ChangedGetNewIds` | `session.e2e.test.ts`: ChangedGetNewIds: forgets the number of a changed line, so a batch has to read it again |

### `Rehearsal`: line identities across a rehearsal

A line number the agent was shown is accepted only while that line still has
that number: `core/src/lines.ts`, `rehearsal.ts`, `controller.ts`, and the
player's `knows`. Each line has a ghost, which line it really is, next to the
tracker's id, and changes are whole lines inserted or deleted or an edit within
a line, where `applyChange`'s rules are plain. Two defenses keep that: a change
by others to a file the queue edits interrupts it (`OtherInterrupts`), and
`adopt` takes the fork's ids only for a text that reads as in the fork
(`AdoptChecksText`). An interrupt discards the batches still queued, but one
already playing plays on and may complete, as when a formatter changes the file
on save (#151); `AdoptChecksText` keeps that batch's fork ids off the changed
text. The programmer's edit interrupts in the agent's turn and is never
followed; a turn change interrupts too. Until a report says the queue was
interrupted, and the batch the interrupt left playing has ended (`stale`), no
batch is rehearsed, and `read` shows the editor's text. A report while that
batch plays marks the interrupt reported (`staleReported`), and `stale` clears
when it ends (`ReportWaitsForQueue`, the fix for #219: a report cleared `stale`
at once, so the next batch was rehearsed from the playing batch's fork, which
missed the programmer's edit, and a line just read was refused). Batches are
queued, each rehearsed from the one before; the config bounds the queue.
`ReadIsStart`: right after a read, the agent's next batch is checked against
what it was shown. `ShareIds` is the fix for a bug this spec found:
`followChange` gave a queued batch's fork its own id for a line a tool inserted,
unlike the editor's id the agent was shown, so a line the agent had just read
was refused. Now the fork drops its copy of the file's ids, and reads the
editor's.

| Spec | Code |
|---|---|
| `Read` | `read`: `saw` with the queue's last `after.lines` when a queued batch edits the file (`planned`), unless `stale`; else the editor's |
| `Submit` | `step`'s rehearsal: `fork()` of where the queue leaves off (`Origin`), the batch played in memory; while `stale`, the batch is discarded unrehearsed |
| `Play`, `FailPlay` | the oldest batch playing, the editor tracking its edits, `adopt`; a batch that does not complete (interrupted, discarded, or failed), with its change made or not, is not adopted, and interrupts the queue |
| `EndStale` | the player's loop: once the batch an interrupt left playing ends, an interrupt already reported is over (`staleReported`) |
| `EditAsOther` | `otherEdit`: the editor tracks the change; the queue is interrupted if a batch edits the file (`interrupt`: the batches still queued are discarded, one already playing plays on, and `stale` is set), else each rehearsal follows it (`followChange`) |
| `EditAsProgrammer` | `userEdit`: the editor tracks the change; in the agent's turn it interrupts, whatever file it is in; never followed |
| `ChangeTurn` | `takeTurn` and `handBack`, each interrupting the queue |
| `Accept` | the rehearsal's `knows` in `unseen`: the id the agent was shown at a number is the id there where the rehearsal starts |
| `Report` | every `snapshot`: a step's, from `ready()` or its timer, `rejectBatch`'s, `rejectUnanchored`'s, and `resumeSession`'s, which forgets `seen`; it clears `stale` with the queue empty, and otherwise sets `staleReported` (#219) |

Each invariant was proved to bite with a mutation of a copy of the model, run in
TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a line someone else inserts gets an id below 0 | `TypeOK` |
| `knows` takes any number in the text, whatever its id | `AcceptedOnlyForThatLine` |
| `Submit` doesn't advance the shared counter | `IdsDistinct` |
| a change by others leaves the editor's ids as they were | `OnePerLine` |
| `ShareIds = FALSE`, the code before this spec | `ReadIsStart` |
| `OtherInterrupts = FALSE` | `ReadIsStart` |
| `AdoptChecksText = FALSE`, with `OtherInterrupts = FALSE` | `OnePerLine` |
| `AdoptChecksText = FALSE` alone | `OnePerLine`: a batch playing when a change by others interrupted the queue completes, and adopts its fork's ids for a text with a line more or fewer (#151) |
| an interrupt discards the playing batch too, the spec before #151, with `AdoptChecksText = FALSE` | nothing: no batch then plays on a text other than its fork's, so that spec could not see what `AdoptChecksText` guards |
| a programmer's edit in the agent's turn leaves the queue alone | `ReadIsStart` |
| `FailPlay` adopts the fork's ids for a change it made | `OnePerLine` |
| `Submit` queues an edit rehearsed in the programmer's turn | `ReadIsStart` |
| `ReportWaitsForQueue = FALSE`, the code before #219 | `ReadIsStart` |
| the player's loop does not end a reported interrupt (`EndStale` left out) | `ReportedWhilePlaying` |
| `Submit` queues a batch while `stale` | nothing here: `Controller`'s `PlaysKnowingEvents` checks that no batch is queued before the agent knows of an interrupt |

`OtherInterrupts = FALSE` alone does not break `AcceptedOnlyForThatLine`. With
`AdoptChecksText = FALSE`, `OnePerLine` breaks first, and past it the model
reads beyond the end of a sequence, so `AcceptedOnlyForThatLine` is not checked
on its own there.

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `AcceptedOnlyForThatLine` | `session.e2e.test.ts`: AcceptedOnlyForThatLine: rejects a number from before the lines a queued batch adds above it, and takes one from a `read` after them; AcceptedOnlyForThatLine: rejects a report's number that a queued batch has since moved |
| `IdsDistinct` | `lines.test.ts`: IdsDistinct: never gives two lines one identity, in the editor's LineIds or a fork of it, through the same change to both |
| `OnePerLine` | `lines.test.ts`: OnePerLine, Distinct, Untouched, WithinALine, BreakAtEnd, BreakAtStart: gives each line of the result one identity, never one twice, and keeps the untouched lines'; `lines.test.ts`: OnePerLine: adopts a fork's identities only for a file that reads as it did in the fork (specs/Rehearsal.tla, #151). In the code, `version` checks a file's text again before it uses its ids, so a wrong `adopt` gives the file new identities, not too few or too many; this test fails that way when `adopt` skips its check |
| `ReadIsStart` | `session.e2e.test.ts`: ReadIsStart: accepts a line a tool inserted, read while a batch that edits no file plays (specs/Rehearsal.tla); ReadIsStart: still interrupts for a change to a file a queued batch edits; `controller.test.ts`: ReadIsStart: an edit by others to a file a queued batch edits interrupts it, and to another file the queue's rehearsals follow it; ReadIsStart, ReportedWhilePlaying: stays stale after a report while the batch an interrupt left plays, until it completes |
| `ReportedWhilePlaying` | `controller.test.ts`: ReadIsStart, ReportedWhilePlaying: stays stale after a report while the batch an interrupt left plays, until it completes; `integration.ts`, in VS Code: the controller paths, where a report during a batch's held last save leaves the next step rehearsed once it completes |

### `Terminals`: running commands

`packages/vscode/src/terminal.ts`: `acquire`, the wait for shell integration,
the command, and what ends each wait.

| Spec | Code |
|---|---|
| `Acquire` | `acquire()`: a terminal that isn't busy, whose shell is alive, in the run's directory, or a new one there; `busy = true`. The signal may have fired before (an interrupt during the save) |
| `ExecuteCommand`, `AbortBeforeStart`, `RejectClosed` | `shellIntegration()`: integration or its timer, then `executeCommand`; the signal; a terminal closed meanwhile (VS Code throws for its `sendText`) |
| `End`, `StopWaiting`, `CloseTerminal` | `onDidEndTerminalShellExecution`; `stopWaiting` (the wait or an interrupt during it: one before it is `SkipAborted`, and nothing awaits between that check and the wait, #176); `onDidCloseTerminal` |
| `SendText` | the timer fires with no integration: the command is typed in (`sendText`), and the terminal stays busy for good |
| `SkipAborted` | a signal that fired before the run: `shellIntegration()` returns at once, and `run()` reports `notStarted` |
| `Exit` | the shell exits (`exitStatus`); the terminal stays open, and `acquire()` won't reuse it |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Acquire` leaves the command a value outside `CommandStates` | `TypeOK` |
| `Reusable` ignores `busy` | `NoReuseWhileBusy` |
| `End` leaves its terminal busy | `FreedAfterEnd` |
| `SendText` leaves the call running, waiting for a command nothing tracks | `RunReturns` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoReuseWhileBusy` | `terminal.test.ts`: NoReuseWhileBusy: gives a second command a new terminal while the first one's command still runs |
| `FreedAfterEnd` | `terminal.test.ts`: FreedAfterEnd, Exit: reuses a terminal once its command ends, in the folder it's in, and not one whose shell exited |
| `RunReturns` | `terminal.test.ts`: RunReturns, SkipAborted: doesn't wait for shell integration once playback is interrupted, and starts nothing; RunReturns, ExecuteCommand, End: runs the command, reads its output, and reports how it ended, with its shell; RunReturns, StopWaiting: returns with the command still running when the wait is over, or playback is interrupted; RunReturns, CloseTerminal: ends the wait when the programmer closes the terminal, and not for another terminal; RunReturns, SendText: waits for shell integration to come, for this terminal only, and types the command in without it |

### `QuietTerminals`: visibility and cleanup

This model checks quiet startup, automatic show, explicit reveal, fallback
visibility, and cleanup. It abstracts shell completion; a live shell is never
closed automatically because background work cannot be ruled out. Exposed
terminals are also retained. Both settings were checked: 9 distinct states
for quiet and 11 for automatic show.

| Mutation | Breaks |
|---|---|
| allow cleanup of protected or live shells | `NeverCloseProtected` |
| hide the untracked fallback | `FallbackVisible` |
| fail to show on a reveal request | `RevealWorks` |
| show a quiet start | `QuietStart` |
| fail to show an automatic start | `AutoStartVisible` |
| make starts a no-op | `RunBegins` |

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks these types |
| `NeverCloseProtected` | `terminal.test.ts`: cleans up exited owned terminals while preserving live, running and untracked shells |
| `FallbackVisible` | `terminal.test.ts`: RunReturns, SendText |
| `RevealWorks`, `QuietStart` | `terminal.test.ts`: runs quietly and reveals only the owned terminal on request |
| `AutoStartVisible` | `terminal.test.ts`: StartRespectsPreference: reveals commands when automatic display is enabled |
| `RunBegins` | `terminal.test.ts`: RunReturns, ExecuteCommand, End |

### `TerminalReuse`: protected reuse

This separate model enumerates shell state, exposure and pending output drain,
and a foreign shell-start event. It abstracts path and terminal-ID matching,
which the existing `Terminals` model and terminal tests cover. TLC checked 48
states. An unobserved background descendant is not modeled as detectable; live
shells are retained on cleanup even after a foreground command ends.

| Mutation | Breaks |
|---|---|
| ignore exposure | `ProtectedNotReused` |
| ignore pending output drain | `ProtectedNotReused` |
| fail to protect a foreign start | `ForeignProtected` |
| skip eligible reuse | `EligibleReused` |
| make an attempt a no-op | `AttemptCompletes` |

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks these types |
| `ProtectedNotReused` | `terminal.test.ts`: NoReuseWhileBusy; protects a terminal if another execution starts; pending output drain prevents reuse |
| `EligibleReused` | `terminal.test.ts`: ShowExact: invalidates the old command ID when a hidden terminal is reused |
| `ForeignProtected` | `terminal.test.ts`: protects a terminal if another execution starts, while recognizing its own execution |
| `AttemptCompletes` | `terminal.test.ts`: RunReturns, ExecuteCommand, End |

### Pure functions: `LineIdentity`, `Places`, `Typing`, `ActionValidation`

These have no state or concurrency, so each spec is a model of the function and
`ASSUME`s that TLC checks over every small input. Each also has an exhaustive
test that checks the same properties on the code itself, so the model and the
code are held to one contract.

| Spec | Code | Contract | Test |
|---|---|---|---|
| `LineIdentity` | `applyChange` in `core/src/lines.ts` | one identity per line, none named twice; lines outside the change keep theirs; a line break at the end of a line keeps it in place, at its start moves it down | `core/test/lines.test.ts` |
| `Places` | `resolveSpot`, `resolveSpan` in `core/src/places.ts` | a spot or span resolves exactly when one match is on its line, and lies there; a range ends at the first `through` after `from` | `core/test/places.test.ts`, with `through` up to 2 characters (the spec: 3) |
| `Typing` | `planTyping` in `core/src/typing.ts` | chunks concatenate to the text; quote runs of three or more are atomic, and other chunks are characters or indentation with their line break | `core/test/typing.test.ts`, texts up to 5 characters (the spec: 7) |
| `ActionValidation` | `moveProblem`, `spanProblem` in `protocol/src/index.ts` | a place gets no problem exactly when it is valid, and no place makes either check throw | `protocol/test/index.test.ts`, with the same kinds of value as the spec |

Each is a module of `ASSUME`s alone, with a config that only gives the
constants (the guide's 8.7, item 6): TLC checks the `ASSUME`s and explores no
states.

#### `LineIdentity`

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted;
each mutation broke only its own:

| Mutation | Breaks |
|---|---|
| the id of the line after the change is dropped | `OnePerLine` |
| every fresh id is 100 | `Distinct` |
| the lines before the change get new ids | `Untouched` |
| a line edited within itself gets a new id | `WithinALine` |
| with a prefix, the id stays on the line after the break | `BreakAtEnd` |
| at a line's start, the id stays on the first line | `BreakAtStart` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `OnePerLine` | `lines.test.ts`: OnePerLine, Distinct, Untouched, WithinALine, BreakAtEnd, BreakAtStart: gives each line of the result one identity, never one twice, and keeps the untouched lines' |
| `Distinct`, `Untouched`, `WithinALine`, `BreakAtEnd`, `BreakAtStart` | the same test |

#### `Places`

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `SpotsOnLine` ignores the line | `SpotOK` |
| `ResolveSpot` takes any match on the line, not only a single one | `SpotOnlyWhenUnique` |
| `ResolveText` ignores the line | `SpanOK` |
| a `through` may start inside `from` | `RangeOK` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `SpotOK`, `SpotOnlyWhenUnique` | `places.test.ts`: SpotOK, SpotOnlyWhenUnique: resolves a spot only when one match has its marker on the line, and puts it there |
| `SpanOK`, `RangeOK` | `places.test.ts`: SpanOK, RangeOK: resolves a span only when its text starts once on the line, and a range to the first `through` after it |

#### `Typing`

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a line feed's chunk drops the line feed | `ConcatenatesToText` |
| an "x" shares its chunk with the character after it | `ChunksAreUnits` |
| split every quote run into individual characters | `QuoteRunsAtomic` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `ConcatenatesToText` | `typing.test.ts`: ConcatenatesToText, ChunksAreUnits: splits text into chunks that concatenate to it, each one character or a line break with its indentation |
| `ChunksAreUnits` | the same test |
| `QuoteRunsAtomic` | `typing.test.ts`: types a run of three or more quotes in one edit without losing cadence; `session.e2e.test.ts`: reports the correct remaining text when interrupted around an atomic quote run |

#### `TypingEol`

The model normalizes CRLF input before chunk planning and writes line feeds in
the document's line ending. It covers suffixes at input-unit boundaries; lone
carriage returns are outside the model. TLC checked all sequences of up to five
units, for both output endings.

| Mutation | Breaks |
|---|---|
| omit normalization before encoding | `CorrectEol` |
| omit normalization from the remaining suffix | `SuffixSafe` |
| allow a cursor between CR and LF | `NoSplitCRLF` |

| Assumption | Proved by |
|---|---|
| `CorrectEol` | `player.test.ts`: normalizes CRLF input for both actions and document endings |
| `SuffixSafe` | `session.e2e.test.ts`: normalizes CRLF and replays the interrupted action in both document endings and typing modes |
| `NoSplitCRLF` | `index.test.ts`: rejects a cursor marker between CR and LF while allowing lone CR; `session.e2e.test.ts`: refuses both actions before editing |

#### `ActionValidation`

The checks both the relay's schema and the player ask (#45), over every
`move` and every `select` or `point`, by the kind of value in each field.
Each `ASSUME` was proved to bite with a mutation, run in
TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `CheckAtText = FALSE`, the code before #163, where `{ at: 5 }` threw in `spotProblem` | `NeverThrows` |
| `MoveProblem` without its check for neither `at` nor `to` | `MoveExactly` |
| omit the multi-close acknowledgment restriction | `MoveExactly` |
| `SpanProblem` without its check for empty code | `SpanExactly` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `MoveExactly` | `protocol/test/index.test.ts`: MoveExactly, NeverThrows: gives no problem exactly for a valid move, and a message for every other; accepts the multiple-close acknowledgment only as true on line_end; `integration.ts`, in VS Code: MoveExactly, SpanExactly, NeverThrows: malformed actions refused by name in the editor; frames that aren't messages dropped |
| `SpanExactly` | `protocol/test/index.test.ts`: SpanExactly, NeverThrows: gives no problem exactly for a valid span, and a message for every other; `integration.ts`, in VS Code: MoveExactly, SpanExactly, NeverThrows: 27 malformed actions refused by name in the editor; frames that aren't messages dropped |
| `NeverThrows` | both tests |

### Contracts checked by tests: `ActionValidation`, `Render`, `AgentSetup`

These three contracts from #19 are about what the code accepts or writes, not
about states, so they are tests on the code, not TLA+. `ActionValidation`'s
two checks, `moveProblem` and `spanProblem`, also have a spec of their own,
above (#163); this contract holds the relay's schema and the player to them.

| Contract | Test |
|---|---|
| The relay's schema and the player's checks accept the same actions (#45) | `relay/test/validation.test.ts`: every action in its table through both, malformed ones above all |
| Every field of a `Report` appears in its rendered text | `relay/test/render.test.ts`: renders every field of a report |
| Setting up an agent changes only its `pair` entry, and twice equals once | `vscode/test/agents.test.ts`: AgentSetup, for the TOML and JSON configs |

## Keeping specs and code in step

Nothing ties a spec to its code but the tables above. When code in one of the
files above changes, update its spec, and run `specs/check.sh`.

### `LineEndGuard`: intent before crossing multiple closes

Rehearsal rejects a batch before playback when its current-line suffix contains
only multiple closing brackets and whitespace, unless the move acknowledges
the crossing. Playback checks the live suffix again. The model abstracts this
predicate as danger; it does not parse code or cover other suffixes. Its 22
distinct states include different rehearsed and live contexts.

| Mutation | Breaks |
|---|---|
| disable the rehearsal guard | `PreflightRefuses` |
| disable the live guard | `LiveGuard` |
| make an edit before rejecting | `RejectBeforeEdits` |
| refuse acknowledged live crossings | `AllowedActs` |
| make all allowed moves no-ops | `AllowedActs` |

| Invariant | Test |
|---|---|
| `TypeOK` | TypeScript checks the state types |
| `RejectBeforeEdits`, `PreflightRefuses` | `session.e2e.test.ts`: rejects an entire batch when a later line_end would cross multiple closes |
| `LiveGuard` | `player.test.ts`: guards multiple adjacent closes during playback unless acknowledged |
| `AllowedActs` | `session.e2e.test.ts`: allows an explicitly acknowledged multi-close move and subsequent edit; `player.test.ts`: allows line_end for a single close or when code follows the closes |

### `StructuralTyping`: explicit structural edits

`structuralNewline` and `Player.perform` split a supported Python or JSON pair
only in code, and `next_close` crosses one adjacent close without altering the
text. The model abstracts the prefix to ordinary, closed-field, open-field, and
opaque categories; it does not model character-by-character lexing. The helper
tests cover quoted fields, nesting, escaping, mismatches and the depth bound.

| Spec | Code |
|---|---|
| `SmartNewline` | the opt-in `newline` action and its lexical guard |
| `StepClose` | the relative `next_close` move |
| `NewlineSafe`, `RefusalSafe` | reject unsupported or unsafe contexts |
| `NewlineActs`, `StepActs` | eligible actions take effect |
| `StepOne` | one close is crossed, and the text stays unchanged |

Each invariant was mutation-tested in TLC, then the mutation was reverted:

| Mutation | Breaks |
|---|---|
| Set the move distance to 2 | `TypeOK`, `StepOne` |
| Make an eligible newline a no-op | `NewlineActs` |
| Accept an unmatched pair | `NewlineSafe` |
| Make an eligible close step a no-op | `StepActs` |
| Change state after refusing a newline | `RefusalSafe` |
| Treat a closed formatted field as opaque | `ClosedFieldRecovers` |
| Treat open or unsupported fields as code | `OpaqueFieldRefused` |

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks the types |
| `NewlineSafe`, `RefusalSafe` | `player.test.ts`: NewlineSafe, RefusalSafe: refuses newline without a cursor, with a selection, or in an unsafe context |
| `NewlineActs` | `player.test.ts`: NewlineActs: inserts a structural newline inside a Python pair |
| `ClosedFieldRecovers` | `structural_typing.test.ts`: ClosedFieldRecovers: accepts a later assertion after a closed field; `session.e2e.test.ts`: ClosedFieldRecovers: splits the assertion after a closed quoted field |
| `OpaqueFieldRefused` | `structural_typing.test.ts`: OpaqueFieldRefused: retains conservative refusal |
| `StepOne`, `StepActs` | `player.test.ts`: StepOne, StepActs: steps past exactly one adjacent close and refuses any other character |

### `BuildIdentity`: the running bundle's label

The panel's Settings dialog displays the version and content-derived build ID
compiled into the running extension. Installing another bundle changes the
model's `installed` value; only a reload changes `running` and `displayed`.

| Spec | Code |
|---|---|
| `Install`, `Reload` | VS Code installation and extension activation |
| `ShowsRunning` | the panel receives the values compiled into its host |
| `ShowsNewAfterReload` | activation uses the newly loaded bundle's values |

TLC mutations that put an invalid value in the label, update it on install, or
leave it stale on reload violate `TypeOK`, `ShowsRunning`, and
`ShowsNewAfterReload`, respectively.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks the types |
| `ShowsRunning`, `ShowsNewAfterReload` | `vscode/test/panel.test.ts`: ShowsRunning, ShowsNewAfterReload: each page uses its running bundle identity |

### `ReadingSkip`: finishing a message's reading delay

The panel sends an ID for the selected message countdown. The controller checks
the session and pause state, and the Player matches the ID before the timeline
finishes its active sleep. IDs absent from older replay events do not enable the
control. The model abstracts the timeline to one pending countdown.

| Spec | Code |
|---|---|
| `Start`, `Finish` | a `say` starts and ends its reading delay |
| `ChangeContext` | pause, turn or session suspension changes |
| `Click` | the panel request and Controller/Player guards |

Each property was checked by a mutation in a temporary model: accepting the
wrong ID or an explicit pause violates `OnlyCurrent`; ignoring an eligible
click violates `EligibleFinishes`; clearing a countdown on an ineligible click
violates `IneligibleKeepsReading`; an out-of-range ID violates `TypeOK`.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `OnlyCurrent` | `player.test.ts`: OnlyCurrent: only finishes the currently pending say and rejects stale IDs |
| `EligibleFinishes`, `IneligibleKeepsReading` | `session.e2e.test.ts`: EligibleFinishes, IneligibleKeepsReading: finishes the requested delay without lifting a user pause |
| `IneligibleKeepsReading` | `controller.test.ts`: IneligibleKeepsReading: forwards an ID only in an active unpaused agent turn |

### `SpeechWorker`: canceled inference and bounded cleanup

`SpeechWorker.tla` keeps CPU-job ownership after its visible gate is canceled.
A separate fair watchdog transitions a stuck job to termination, and a new job
is admitted only after completion or termination. The liveness property
assumes worker termination eventually settles; cancellation itself resolves the
visible gate without waiting for that settlement. Two bounded job IDs expose
stale results and attempts to overlap work. The build stages a compatible C++
runtime alongside the native binding; this packaging repair does not change
the modeled worker ownership, cancellation, or watchdog behavior.

### `Narration`: selected speech and reading gates

`Narration.tla` models one outstanding selected unit, two successive units,
generation IDs, two page and session epochs, page loss, reply, pause, reading
holds, and an independent command decision. `ReadyCurrent` and
`CompletionCurrent` reject stale worker and page callbacks; `GateSafe` keeps
speech completion, error, and cancellation from changing reading, holds,
pause, or command approval. `AdvanceAfterGates` requires both gates, and
`Progress` checks eventual advancement under weak fairness when a page and
session eventually stay present and all pauses and holds eventually clear.
The integration-only speech observation records `ended` or page failure only
when the service accepts a callback for the current generation and page; idle
after cancellation is not playback completion. The model abstracts the audio
transport and the full queue implementation. The agent guide now recommends
selecting useful narration without a per-session prompt; this changes the
instruction, not the modeled speech or reading gates.

### `ReadingHold`: scoped timer holds

The controller accepts a hold only for the current eligible reading. Release
clears the matching hold even if another pause arose meanwhile; it never clears
that separate pause. Mutations accepting a stale ID, clearing global pause,
ignoring eligible holds, or refusing a matching release while paused violate
`StaleDoesNothing`, `ReleaseKeepsPause`, `EligibleHold`, and `EligibleRelease`.
An unscoped hold violates `ScopedHold`.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `ScopedHold`, `StaleDoesNothing`, `EligibleHold` | `player.test.ts`: ScopedHold, StaleDoesNothing, EligibleHold: holds only the matching reading timer |
| `ReleaseKeepsPause`, `EligibleRelease` | `timeline.test.ts`: ReleaseKeepsPause, EligibleRelease: does not release a separate playback pause when the hold ends |

### `ReadingGesture`: binding a press to its countdown

The panel captures the countdown ID at press time. A long press suppresses its
following click; a short press can finish only that captured countdown. Mutations
using the new ID, allowing the long click, and ignoring a short current press
violate `NoNewerSkip`, `LongDoesNotSkip`, and `ShortCurrentSkips`.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `NoNewerSkip` | `webview/panel.test.ts`: NoNewerSkip: does not let an old press finish a newer countdown |
| `LongDoesNotSkip` | `webview/panel.test.ts`: LongDoesNotSkip: holds, resumes on release, and suppresses the resulting click |
| `ShortCurrentSkips` | `webview/panel.test.ts`: ShortCurrentSkips: finishes once on a short pointer press |

### `ListeningHint` and `SettingsAccess`: panel controls

The hint appears only for active, unpaused listening; Settings remains reachable
in idle and active panels. Mutating the hint to ignore context violates
`HintMatchesStatus`; hiding the gear while idle violates `SettingsAvailable`.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `HintMatchesStatus` | `webview/panel.test.ts`: offers a focusable explanation only while the active agent is listening |
| `SettingsAvailable` | `panel_html.test.ts`: places one icon-only Settings control in the toolbar before End; `visual/chat_order.spec.ts`: the Settings gear remains available while idle, calibrating, and active |

### `TerminalPanel`: preference and explicit terminal reveal

The panel keeps automatic visibility separate from explicit requests. A reveal
uses the command ID; a missing terminal produces an unavailable response. The
model abstracts terminal ownership and cleanup, which the terminal model covers.
TLC checked 61 distinct states. Mutating the result type, ignoring automatic
visibility, showing a different ID, failing to report a missing ID, or ignoring
an available request violates `TypeOK`, `StartRespectsPreference`, `ShowExact`,
`MissingReported`, and `AvailableShown`, respectively.

| Invariant | Test |
|---|---|
| `TypeOK` | TypeScript checks the message types; runtime requests are validated |
| `StartRespectsPreference` | `terminal.test.ts`: StartRespectsPreference: reveals commands when automatic display is enabled |
| `ShowExact` | `terminal.test.ts`: ShowExact: invalidates the old command ID when a hidden terminal is reused |
| `AvailableShown` | `webview/panel.test.ts`: AvailableShown: offers the matching terminal for running and filed commands |
| `MissingReported` | `panel.test.ts`: MissingReported and AvailableShown: validates settings and reports a closed terminal |

### `DiagnosticsPrivacy`: bounded allowlisted history

The recorder keeps a bounded history and constructs each event from permitted
fields before it can be copied. The model represents an extra raw secret field,
abstracts timestamps and lifecycle values, and checks a capacity of two. TLC
checked 22,778 distinct states; the speech-only configuration checked 38.
Concrete tests check runtime validation, the 100-event limit, pause-reason
bounds, speech-only events and independent snapshots.

| Mutation | Breaks |
|---|---|
| append the raw event instead of its safe projection | `TypeOK`, `OnlyAllowed` |
| stop dropping the oldest event at capacity | `Bounded` |
| copy an empty history instead of the current history | `CopiedExactly` |
| record without appending | `Recorded` |
| disable recording | `RecordsEventually` |

| Property | Test |
|---|---|
| `TypeOK`, `OnlyAllowed` | `diagnostics.test.ts`: TypeOK, OnlyAllowed: rejects unrecognized speech enums and records capability without a reason; copies only allowlisted fields and rejects malformed input and unsafe identity strings |
| `Bounded` | `diagnostics.test.ts`: bounds its history while retaining the latest state and returns independent snapshots |
| `CopiedExactly` | `diagnostics.test.ts`: starts with unavailable states and records typed events in order |
| `Recorded`, `RecordsEventually` | `diagnostics.test.ts`: OnlyAllowed, Recorded: records speech lifecycle without secret extras even when no session exists; retains valid request, integration and completion events |

The owner connection ID is local to this extension activation; request IDs are
scoped by that ID. `replied` records that the bridge sent a response to the
socket, not that the client acknowledged or consumed it. Unknown state and
uncaptured values stay unavailable; no task, chat, command, output, path,
environment, credential or error text enters this history.

### `DiagnosticsCopy`: explicit clipboard export

An explicit action can succeed or fail; opening Settings alone does not copy.
TLC checked three states. Mutations that copy before a request, fail to produce
an outcome, or produce both outcomes violate `OnlyOnRequest`,
`RequestedCompletes`, and `ExclusiveOutcome`; an invalid type is rejected.

| Invariant | Test |
|---|---|
| `TypeOK` | TypeScript checks the control and outcome types |
| `OnlyOnRequest` | `webview/panel.test.ts`: OnlyOnRequest: requests diagnostics only when the button is activated |
| `RequestedCompletes`, `ExclusiveOutcome` | `panel.test.ts`: OnlyOnRequest and RequestedCompletes: copies only when asked and reports either outcome |

### `CodePlayback`: grouped code and its reading pauses

The model treats existing typing chunks as indivisible atoms. Each insertion
chooses a contiguous, bounded group, including the exception for one oversized
atom. A fresh countdown blocks the next insertion until it finishes; pause and
interrupt also block insertion. A click can finish only its own live countdown.
The progress config assumes no pause or interrupt and weak fairness.
`Typing` separately models quote and newline/indent atoms. The model abstracts
line/whitespace preference, text encoding, the visual highlight and panel
rendering; tests cover those concrete details.

The model mutations drop or duplicate an atom (`PrefixExact`), overflow the
identifier (`TypeOK`), accept a stale click (`CurrentCountdown`), clear a
rejected click (`RejectedKeepsCountdown`), bypass pause, reading, interruption
or the group bounds (the corresponding action property), or disable insertion
(`EventuallyComplete`). TLC found a violation for each mutation.

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks the corresponding code types. |
| `PrefixExact` | `typing.test.ts`: PrefixExact: groups complete lines without losing indentation or quote atoms; `player.test.ts`: PrefixExact: returns only the suffix when interrupted during reading. |
| `CurrentCountdown`, `RejectedKeepsCountdown` | `player.test.ts`: CurrentCountdown and RejectedKeepsCountdown: scopes finish and hold to the active code ID. |
| `PausedBlocksInsert` | `session.e2e.test.ts`: PausedBlocksInsert: a paused code countdown blocks the next group. |
| `ReadingBlocksInsert` | `session.e2e.test.ts`: ReadingBlocksInsert: interrupts a code reading pause with the exact suffix. |
| `InterruptedBlocksInsert` | `player.test.ts`: PrefixExact: returns only the suffix when interrupted during reading. |
| `BoundedGroups` | `typing.test.ts`: BoundedGroups: limits blocks to four lines and 240 Unicode characters. |
| `EventuallyComplete` | `session.e2e.test.ts`: StableDuringChoice, NextActionUsesChoice: snapshots the mode for each typing action, while rehearsal stays instant. |

### `PlaybackPreference`: choosing the code display

The menu saves and displays the chosen mode independently of the pace. An
in-progress typing action keeps its captured mode; the next action takes the
new choice. TLC checked 36 states. Mutations that write an invalid pace, fail
to save or apply a choice, change an ongoing action, start with the wrong mode,
or change mode while changing pace violate `TypeOK`, `ChoiceSaved`,
`ChoiceApplied`, `StableDuringChoice`, `NextActionUsesChoice`, and
`PaceIndependent`, respectively.

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks mode values; the panel and extension validate boundary values. |
| `ChoiceSaved` | `extension.test.ts`: ChoiceSaved: reads, stores and applies the playback mode, defaulting invalid values to typing. |
| `ChoiceApplied` | `panel.test.ts`: ChoiceApplied: sends the saved mode and accepts only valid choices; `webview/panel.test.ts`: ChoiceApplied: the code display menu updates mode separately from speed. |
| `StableDuringChoice`, `NextActionUsesChoice` | `session.e2e.test.ts`: StableDuringChoice, NextActionUsesChoice: snapshots the mode for each typing action, while rehearsal stays instant. |
| `PaceIndependent` | `webview/panel.test.ts`: ChoiceSaved, PaceIndependent: keeps code display and speed independent in either message order. |

### `PlaybackAnchor`: cursor and reading target

The final grouped insert puts the cursor at its marker before the editor
awaits. The `reading` phase abstracts that editor await and the following
reading pause. An external edit transforms that live cursor; finishing leaves
it where the edit put it. The follow target is the start of the highlighted
group while reading, then the cursor. The model abstracts the group start as a
fixed offset and does not model visual layout or scroll motion; `Scroll`
models the latter.

Mutations placing an anchor outside the document, applying a stale tail
subtraction, following the cursor while reading, keeping the group target after
reading, and disabling finish violate the corresponding properties below.

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks code types; cursor bounds are checked by the marker regressions below. |
| `MarkerPreserved` | `session.e2e.test.ts`: MarkerPreserved: user edits during final code reading keep the marker at the transformed position; `player.test.ts`: MarkerPreserved: transforms the final marker when a user edit arrives during editor.edit. |
| `ReadingTargetsGroup`, `FinishedTargetsCursor` | `editor.test.ts`: ReadingTargetsGroup: follows the inserted group during reading, then returns to the cursor. |
| `EventuallyFinished` | `session.e2e.test.ts`: StableDuringChoice, NextActionUsesChoice: snapshots the mode for each typing action, while rehearsal stays instant. |

### `SpeechPage`: current-page audio

This model abstracts one page's audio clip, page replacement, pause, and the
current narration ID. A delivery attempt records its eligibility independently
of whether playback started. TLC checked 28 states. Mutating the initial page
outside its range violates `TypeOK`; accepting a stale ID violates
`PlayingIsCurrent`; refusing an eligible delivery violates `AcceptedStarts`.

| Property | Test |
|---|---|
| `TypeOK` | `speech_audio.test.ts`: rejects invalid page and unit IDs and ignores duplicate audio. |
| `PlayingIsCurrent` | `speech_audio.test.ts`: interrupts synchronously and never resurrects the old unit; ignores stale callbacks when a page or unit changes. |
| `AcceptedStarts` | `speech_audio.test.ts`: plays only the current page and unit, then acknowledges and releases it. |

### `SpeechSetup`: verified model installation

One setup downloads a fixed manifest into staging, verifies it, and replaces a
previous directory using backup and atomic rename. `Dispatch` is the commit
boundary: cancellation before it cannot install new files; a dispatched
rename may finish despite cancellation. Failed rollback leaves the backup in
place. The model abstracts file contents as valid or corrupt and filesystem
operations as atomic successes or failures; it does not model concurrent
setup processes. TLC checked 42 states. Mutations that bypass verification,
install on cancellation, accept corrupt content, lose the backup, or allow a
stuck rollback violate the corresponding safety or progress property.

| Property | Test |
|---|---|
| `InstalledOnlyIfVerified`, `NoBadInstall` | `speech_setup.test.ts`: downloads and verifies all fixed assets before exposing the model directory; rejects a corrupt download and never exposes a partial model. |
| `CancelledDoesNotInstall` | `speech_setup_fs.test.ts`: restores the previous directory if cancelled after backup. |
| `NoLostPrevious` | `speech_setup_fs.test.ts`: restores the previous directory if commit rename fails; preserves the backup directory if rollback also fails. |
| `SetupProgress` | `speech_setup.test.ts`: times out a stalled download and cleans staging. |

### `SpeechSettings`: credentials and account voices

The model captures two immutable catalog request identities and credential
reads. Provider, key and page changes invalidate old results. Explicit refresh
requests and delivered current replies progress under weak fairness. TLC checks
50,968 states. Negative controls detect invalid types, retaining a catalog
across a provider change, accepting an old response after a new request,
accepting a stale key read, changing a canceled prompt's key, disclosing a
secret, refusing request dispatch, and refusing a current response.

| Property | Test |
|---|---|
| `TypeOK` | `panel.test.ts`: NoSecret, TypeOK: forwards only nonsecret key actions and validated cloud selections. |
| `CatalogSafe`, `AcceptedSafe`, `RequestProgress`, `ReplyProgress` | `speech_catalog.test.ts`: CatalogSafe, AcceptedSafe, RequestProgress, ReplyProgress: loads only on request and ignores stale results. |
| `ReadSafe` | `speech_credentials.test.ts`: ReadSafe: waits for replacement and rejects a stale read after an external change. |
| `PromptSafe` | `speech_credentials.test.ts`: PromptSafe: stores only a prompted key and preserves it when a prompt is canceled. |
| `NoSecret` | `extension.test.ts`: NoSecret: uses the native masked prompt and does not put a key in settings or logs. |

### `CloudNarration`: provider, cancellation and gates

The model separates admission, asynchronous key reading, dispatch and response.
It bounds two generations and credential changes; cancellation retains request
ownership until settlement or timeout. The healthy-key configuration makes
forward dispatch observable without assuming the network succeeds. Both
configurations checked 59 states. Mutations disabling provider, key, epoch,
single-request, gate, cancellation and retry guards violate the corresponding
safety properties. Disabling admission, dispatch, playback or fair timeout
violates the respective progress property. Clearing approval on timeout and
allowing only the first generation also produce counterexamples.

`Retry` never fires in the checked configurations because `GuardRetry` is true:
automatic retry is forbidden. The negative control disables this guard and
violates `NoRetry`; it does not represent supported production behavior.

| Property | Test |
|---|---|
| `SafeSend` | `speech_elevenlabs.test.ts`: sends only the selected unit to the fixed endpoint using the secret header; never calls the provider when the key or voice is missing. |
| `NoStale` | `speech_service.test.ts`: cancels cloud work when credentials change and discards the late response; aborts a canceled request and ignores its late output without queuing a successor. |
| `NoOverlap`, `NoRetry` | `speech_service.test.ts`: aborts a canceled request and ignores its late output without queuing a successor; `speech_elevenlabs.test.ts`: times out a stalled request without retrying. |
| `IndependentGates` | Existing `Narration` gate tests cover the independent reading and approval controls; cloud transport never receives these controls. |
| `NoRestart`, `ReadyPlays` | `speech_service.test.ts`: keeps prepared cloud speech paused until resume and rejects stale page events. |
| `RequestSettles`, `EligibleStarts`, `EligibleDispatch` | `speech_service.test.ts`: releases a hung cloud request at its watchdog without reviving late output; `speech_elevenlabs.e2e.test.ts`: converts a real streamed PCM response to bounded playable WAV. |

### `ProviderChoice`: immediate selection and ordered persistence

The model separates the visible and effective provider from stored settings.
It bounds two choices and serial write completions, including external changes,
write failures, and a key change that clears a previously selected voice. TLC
checked 122 distinct states; `Settlement` assumes fair completion or failure
of each queued write. It abstracts settings values other than provider and
the presence of an old voice.

| Mutation | Breaks |
|---|---|
| initialize an unsupported provider | `TypeOK` |
| retain the old effective provider after selection | `ProviderAligned` |
| let an older success or failure replace the newer choice | `LatestHonored` |
| leave the old voice on key change, or restore it when the reset fails | `KeyClearsVoice` |
| disable both write success and failure | `Settlement` |

The liveness negative control disables deadlock checking to expose the
stuttering counterexample; the normal configuration checks deadlocks.

| Property | Test |
|---|---|
| `TypeOK` | `extension.test.ts`: TypeOK: ignores workspace attempts to select the cloud provider |
| `ProviderAligned` | `extension.test.ts`: ProviderAligned: uses a selected provider immediately while its global setting is still being saved; ProviderAligned: does not cancel a preview on delayed settings echoes or unchanged disabled state |
| `LatestHonored` | `extension.test.ts`: LatestHonored, Settlement: keeps the latest choice when an older global write settles; LatestHonored: does not roll back a newer provider when an older write fails |
| `KeyClearsVoice` | `extension.test.ts`: KeyClearsVoice: clears an old account voice even while a settings save is pending; KeyClearsVoice: keeps the old account voice unavailable when a key-reset write fails |
| `Settlement` | `extension.test.ts`: Settlement: rolls back the latest provider and reports a failed settings write; LatestHonored, Settlement: keeps the latest choice when an older global write settles |

### `AudioOutput` and `OutputAdmission`: explicit speech routing

`AudioOutput` models two immutable native job IDs, independent physical
process ownership, output and page epochs, pause, cancellation, and the
default route. It does not model PipeWire internals; an isolated PipeWire
server verifies named-target behavior. `OutputAdmission` models overlapping
discoveries, selected-route epochs, per-request reservation and timeout. The
`pw-dump` catalog parser is outside both models; discovery changes do not alter
the modeled admission or process ownership mechanics.

The `GuardDefault`, `GuardRetire`, callback, admission and play-ID negative
controls violate their respective safety invariants. Disabled admission or
completion controls violate enabledness checks. Each pending discovery can
settle through an independently fair timeout.

| Property | Test |
|---|---|
| `NoOverlap`, `NoCrossRouteOverlap` | `speech_native_output.test.ts`: does not allow another route until the stopped process actually closes; `speech_output_router.test.ts`: blocks default synthesis and playback while a canceled native child is retiring. |
| `NoRevival`, `NoCanceledEnd` | `speech_native_output.test.ts`: ignores callbacks retained from a retired process; keeps a timed-out child owned until close and ignores its late readiness. |
| `NoFallback` | `speech_output_router.test.ts`: refuses an unavailable saved device before synthesis without falling back; isolated PipeWire target-loss test. |
| `NoStartPaused` | `speech_native_output.test.ts`: freezes the startup deadline while paused; defers a readiness notification observed during pause until resume. |
| `NoUnsafeDispatch`, `NoStalePlay` | `speech_output_router.test.ts`: does not let an older prepare replace a newer reservation; a stale play cannot consume a newer reserved route; `speech_service.test.ts`: blocks provider synthesis when output admission rejects or returns unavailable. |
| `Settles`, `CanCheck`, `CanComplete` | `speech_service.test.ts`: times out admission and ignores its late success without sending text; ignores canceled admission success or rejection after a replacement starts. |

### `OutputPreference`: route selection and persistence

The model checks ordered local setting writes, immediate speech cancellation,
stale discovery results and unavailable saved devices. TLC checked 648 states.
Negative controls for invalid choices, stale writes or results, missing stop,
disabled selection and missing fairness violate their corresponding properties.

| Property | Test |
|---|---|
| `SelectionStops`, `ChoiceChangeStops` | `speech_output_preferences.test.ts`: stops speech before immediate selection and persists only the choice. |
| `LatestHonored`, `Settlement` | `speech_output_preferences.test.ts`: serializes writes and ignores an older failed write after a newer selection; rolls back a latest failed write and exposes a fixed error. |
| `StaleIgnored`, `EligibleSelect` | `speech_output_preferences.test.ts`: ignores stale discovery and keeps a missing saved output selected; treats a missing native choice as not ready until an available match is discovered. |

### `OutputHandoff`: admission and browser retirement

The model distinguishes pending output admission from a worker-ready state.
It models two browser job IDs, two page IDs, delayed acknowledgements, native
playback, same-page disposal and a bounded retirement timeout. Timeout reports
the problem while retaining ownership; it cannot itself make native playback safe.
A same-page close is trusted only because the page stops audio synchronously
before reporting the hide, or because VS Code disposes the page. TLC checked
270 states.

Removing the worker admission gate, either acknowledgement identity check,
the page-close identity check, or
the native handoff guard violates `NoEarlyWorker`, `NoStaleAck`, or
`NoCrossRouteOverlap`, respectively. Disabling timeout violates
`RetirementReported`; disabling worker readiness violates `CanReady`. The
model assumes a fair timeout action but does not assume an acknowledgement.

| Property | Test |
|---|---|
| `NoEarlyWorker`, `CanReady` | `speech_service.test.ts`: does not let a canceled worker readiness bypass a newer pending output admission; starts the already-ready worker exactly once after the newer admission succeeds. |
| `NoStaleAck`, `NoCrossRouteOverlap`, `CanAck`, `CanClose` | `speech_output_router.test.ts`: blocks native admission until the matching browser stop is acknowledged; only a requested stop or closure of the same page retires browser ownership. |
| `RetirementReported` | `speech_service.test.ts`: times out admission and ignores its late success without sending text. |

### `OutputReplacement`: preserve old-page audio ownership

Replacing a view invalidates its page without proving that its browser audio
has stopped. The model keeps the old owner until that same page is actually
disposed, and allows immediate refusal of a native request while the owner
remains. TLC checked 22 states. Releasing on replacement or accepting another
page's disposal independently violates `NoPrematureRelease`.

| Property | Test |
|---|---|
| `NoPrematureRelease`, `NoOverlap` | `panel.test.ts`: retains replaced browser-page ownership until its actual disposal; `extension.test.ts`: routes speech through the output router and invalidates it before a preference change. |
| `CanRefuse` | `speech_output_router.test.ts`: blocks native admission until the matching browser stop is acknowledged. |

### `LocalAudioAdmission` and `LocalAudioOwnership`: local playback bridge

The admission model checks a logical snapshot of the selected output and its
availability before provider dispatch. It does not assert that a device has
been physically opened at that point. If the device disappears after cloud
dispatch, provider work may already have incurred cost; playback must still
fail without falling back to another output.

The ownership model bounds two jobs, two page and connection epochs, and
independent inbound control and outbound acknowledgement sequences. A lost
remote link is detected by a local lease, then the adapter retires the local
player. Parent loss likewise requests retirement; physical ownership remains
until exit. `LeaseStops`, `RetirementStops` and `ParentLossSettles` assume fair
detection and process retirement. Device loss cancels the selected route.

The capability, admission, cloud, target, acknowledgement, control, heartbeat,
parent and natural-end negative controls violate their safety properties.
Disabling lease detection or retirement violates their liveness properties.
The stale-terminal-callback control violates `NoStaleAck`. Requiring the
current page instead of the immutable job page in `Retired` violates
`LeaseStops`, `RetirementStops` and `ParentLossSettles` after page replacement;
the unchanged baseline passes 3,632 states.

| Property | Current test evidence |
|---|---|
| `NoOverlap`, `NoStaleAck` | `audio-native/test/ownership.test.ts`: holds exclusive ownership until the corresponding process has actually retired; snapshots owner identity and rejects leases after retirement or replacement. |
| `NoStaleHeartbeat` | `audio-ui/test/local_connection.test.ts`: accepts ordered messages, rejects stale or malformed frames, and expires locally; refreshes the lease only for a valid ordered heartbeat and stops on disposal. |
| `NoStaleAck`, sequence bounds | `audio-native/test/protocol.test.ts`: handles fragmented and coalesced event frames while rejecting stale sequences. |
| `SafeAdmission`, `NoFallback` | `audio-native/test/adapter.test.ts`: validates and snapshots the selected route before admitting a job. |
| `NoAbandonedReservation` | `speech_service.test.ts`: retires pending admission on cancel, timeout, and disposal before late results; `audio-native/test/adapter.test.ts`: cancels pending admission and ignores late discovery after stop. |
| `NoOverlap`, `NoStaleAck` | `audio-ui/test/companion_output.test.ts`: keeps the route occupied until physical stop completes and ignores stale events; ignores late failures after cancellation and never releases on failed retirement. |
| `RetirementStops`, `NoStaleAck` | `workspace_session.integration.test.ts`: retires the exact old job after a replacement page is ready; `remote_narration.test.ts`: rejects a later job acknowledgement with a reused sequence or job id. |
| Protocol shape | `protocol/test/local_audio.test.ts`: accepts the bounded commands and terminal acknowledgements; rejects wrong versions, unknown commands, extra keys and invalid identities. |

Native process retirement, parent loss, physical device routing, preflight and
remote-host integration require further implementation-specific tests; the
current parser and ownership tests alone do not establish those properties.

### `PanelPlacement`: bounded two-phase panel ownership

Prepare does not register a view. The main extension selects the companion
irrevocably before sending commit; a lost acknowledgement cannot select legacy
fallback. A preparation timeout expires the token and may fall back only
before commit. A delayed prepare cannot register an extra view. TLC checked
10 states and assumes fair timeouts before and after commit.

The prepare-registration, late-registration and post-commit fallback negative
controls violate `NoEarlyRegistration`, `NoDuplicateRegistration` and
`NoFallbackAfterCommit`. Disabling the precommit timeout violates
`PreparationSettles`.

| Property | Test |
|---|---|
| `NoFallbackAfterCommit`, `CommittedSettles` | `panel_placement.test.ts`: chooses companion irrevocably before committing, including on a lost acknowledgement. |
| `NoEarlyRegistration`, `NoDuplicateRegistration`, `PreparationSettles` | `panel_placement.test.ts`: falls back only before commit and ignores late prepare replies; uses local legacy only for a failed or invalid preparation before commit. |

### `LocalPanelReplay`: ordered local panel replay

One replay event is abstracted as two chunks. Frames carry a connection epoch,
page epoch, sequence, message ID, index, count, bounded size and payload class.
Invalid, duplicate, out-of-order and oversized frames discard a partial
assembly; stale-page frames are rejected. Disconnect and page change clear it.
The implementation must validate
complete JSON and the visible-event schema before delivery. The payload classes
abstract that validation; this model does not inspect JSON or prove that a
particular field is nonsecret. Production bounds are 16,384 UTF-16 code units
per chunk, 1,024 chunks and 16 MiB per message; oversize must be reported.
Per-event messages preserve replay order without truncating the whole history.

| Property | Code test |
|---|---|
| `NoPartialOrMixed` | `protocol/test/panel_chunks.test.ts`: reassembles a complete ordered update only for the current page; drops mixed chunk counts and invalid assembled JSON or updates. |
| `NoStaleDelivery` | `protocol/test/panel_chunks.test.ts`: never combines fragments across page replacement or a duplicate fragment; `audio-ui/test/local_connection.test.ts`: accepts ordered messages, rejects stale or malformed frames, and expires locally. |
| `BoundedAssembly` | `protocol/test/panel_chunks.test.ts`: discards partial, reordered, stale-page, malformed and oversized updates; `vscode/test/panel_update_sender.integration.test.ts`: reports oversized updates and stops sending after page replacement. |
| `NoAudioOrSecrets` | `protocol/test/panel_update.test.ts`: rejects audio, speech settings, arbitrary commands, and unexpected properties. |
| `DisconnectClears` | `protocol/test/panel_chunks.test.ts`: never combines fragments across page replacement or a duplicate fragment; `protocol/test/command_channel.test.ts`: settles active and queued sends on disposal and ignores a late rejection. Direct disconnect-to-assembler integration coverage remains pending. |
| `CanStart`, `CanComplete`, `CanAbort` | `protocol/test/panel_chunks.test.ts`: reassembles a complete ordered update only for the current page; discards partial, reordered, stale-page, malformed and oversized updates. |
| `PendingSettles`, `EventuallyDelivered` | `protocol/test/command_channel.test.ts`: closes on a lost acknowledgement without accepting late completion; sends one frame at a time and preserves enqueue order. |
| Replay ordering and oversize | `vscode/test/panel_update_sender.integration.test.ts`: sends replay as ordered bounded per-event updates using the shared sequence; reports an oversized replay event and still sends later complete events. |

TLC checked `LocalPanelReplay.cfg` with 51,992 generated and 138 distinct states;
`LocalPanelReplay_Delivery.cfg` checked three distinct states under fair successful
processing. Weak fairness of disconnect gives eventual abort in the loss model;
the separate success model assumes both valid chunks are eventually processed.
Disabling each of `GuardOrder`, `GuardEpoch`, `GuardBound` and `GuardPayload`
produced a counterexample to `NoPartialOrMixed`, `NoStaleDelivery`,
`BoundedAssembly` and `NoAudioOrSecrets`, respectively. Type and enabledness
checks are sanity checks rather than independently mutation-tested properties.

Native remote integration and real-device Windows playback verification remain
pending; mocked or in-process tests do not establish those results.

### `SentencePipeline`: bounded synthesis and playback

The model separates a requested child from its started acknowledgement and
physical close. One unit holds one captured output route; two unit identities
and three part ordinals exercise stale output and synthesis callbacks. A
single ready or in-flight next part is permitted. Duration units abstract the
aggregate speech bound, and reading and approval remain held. The model does not
represent actual PCM or text; the tests cover source reconstruction and the
final thinking tail.

| Property | Code test |
|---|---|
| `NoExcessLookahead` | `vscode/test/speech_service.test.ts`: SentencePipeline waits for the first started acknowledgement before one lookahead and completes only after the final part. |
| `NoDispatchWhilePaused` | `vscode/test/speech_service.test.ts`: SentencePipeline does not dispatch the next part until its own started acknowledgement after pause and close; SentencePipeline holds first synthesis while paused during model loading. |
| `FixedRoute` | `audio-ui/test/sentence_pipeline.e2e.test.ts`: SentencePipeline composes one captured route through physical closes and completes only the final part. |
| `NoStaleEnd` | `vscode/test/speech_service.test.ts`: SentencePipeline ignores a stale part result without releasing the current inference; `audio-ui/test/companion_output.test.ts`: keeps the unit lease across parts and rejects stale part events. |
| `FinalOnly` | `audio-ui/test/sentence_pipeline.e2e.test.ts`: SentencePipeline composes one captured route through physical closes and completes only the final part. |
| `RetireBeforeRelease` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: suppresses a pending natural end after cancellation and waits for child close. |
| `ReadingApprovalHeld` | `core/test/player.test.ts`: keeps held reading and command approval after speech throw; keeps held reading and command approval after speech reject. |
| `ContiguousParts` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: rejects overlapping, repeated and skipped parts without launching another child. |
| `AggregateBound` | `vscode/test/speech_service.test.ts`: SentencePipeline fails the whole unit if aggregate audio exceeds its bound. |
| `CanStart`, `CanResume`, `HealthyProgress` | `vscode/test/speech_service.test.ts`: SentencePipeline keeps a finished lookahead paused until the current part retires and resumes; `audio-ui/test/sentence_pipeline.e2e.test.ts`: SentencePipeline composes one captured route through physical closes and completes only the final part. |
| `CanceledProgress` | `vscode/test/speech_service.test.ts`: SentencePipeline cancels a delayed lookahead on reply and ignores its result; `audio-native/test/multipart_native_adapter.e2e.test.ts`: suppresses a pending natural end after cancellation and waits for child close. |
| Source slices and final tail | `vscode/test/speech_segments.test.ts`: preserves every source character while grouping excess sentences into a fourth part; `vscode/test/speech_waveform.test.ts`: adds the thinking tail only when explicitly requested for the final part. |

TLC checked 7,545 generated / 2,242 distinct safety states, 223 / 107
healthy states, and 194 / 137 canceled states. Healthy progress assumes fair
inference, start acknowledgement, output close and eventual stable unpause;
canceled progress separately assumes fair pending inference settlement, stop,
physical close and release. A permanently paused healthy unit need not finish.

Disabling pause, route, stale-output, stale-synthesis, final-only, physical
retirement or started-ack guards yields the corresponding invariant violation.
Disabling synthesis, playback or close violates healthy progress. Disabling
resume violates `CanResume`; disabling stop or release violates
`CanceledProgress`. Raising the aggregate bound, releasing reading on admit,
and skipping the first physical part violate their respective invariants.
Disabling the buffer guard alone passes: in this three-part model the started
acknowledgement guard already prevents a third buffered part. Disabling both
buffer and started guards violates `NoExcessLookahead`. `TypeOK` is a sanity
check rather than an independently mutated behavioral property.

### `MultipartAudioLease`: one endpoint across sequential parts

The model bounds two units and three parts, while the implementation allows
at most four parts. It separates an early backend terminal callback from the
physical child-close event. A logical unit retains one captured output route
across part boundaries, including changes to the system default. The next part
requires the previous child's close, a current route check, a contiguous
ordinal and an unpaused start. An unstarted terminal result fails the part.
The healthy configuration assumes fair starts, terminal callbacks and physical
closes; paused units may remain paused in the general configuration.

Negative controls for early lease release, delivery before close, stale
callbacks, route changes, premature whole-unit completion, paused start,
skipped part, stale route check and unstarted success each violate the
corresponding invariant. Disabling either unit or any healthy request, spawn,
start, terminal, close or release action violates `HealthyFinishes`.

| Property | Test |
|---|---|
| `LeaseRetained`, `NoEarlyPartEvent`, `FixedRoute` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: retains one exact route across parts and publishes completion only after child close; `audio-ui/test/sentence_pipeline.e2e.test.ts`: SentencePipeline composes one captured route through physical closes and completes only the final part. |
| `NoStaleCallback`, `NoSkippedPart`, `NoOverlap` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: rejects overlapping, repeated and skipped parts without launching another child; `audio-ui/test/companion_output.test.ts`: keeps the unit lease across parts and rejects stale part events. |
| `NoStartPaused`, `NoStaleCheck` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: rechecks the captured route after a paused boundary and refuses a missing device; rechecks when pause and resume both occur during an in-flight route check. |
| `NoUnstartedSuccess` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: treats end before start as failure and cannot launch another part. |
| `NoEarlyCompletion`, `RetirementCompletes` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: caps a unit at four parts and releases the lease only on explicit stop; suppresses a pending natural end after cancellation and waits for child close. |

Real platform/device playback and a packaged GUI run remain separate acceptance
checks; the composed test uses a fake worker and backend.

### `SpeechTempo`: local listening-rate transforms

The model snapshots a listening rate for a unit, associates each transform
with its unit and part, and keeps one physical worker slot through retirement.
It derives the watchdog from actual transformed samples, checks the aggregate
unit bound, and appends a fixed tail only to the final part. A timed-out caller
can settle before the worker exits; the slot remains occupied. The model
abstracts PCM and does not establish speech quality or pitch preservation.

| Property | Code test |
|---|---|
| `ImmutableRate` | `vscode/test/speech_service.test.ts`: snapshots listening speed, transforms once, and uses transformed duration without a second cloud request. |
| `NoStaleResult`, `OneWorker` | `vscode/test/speech_tempo_client.test.ts`: rejects canceled work immediately but keeps its slot until physical retirement; rejects a wrong-part result without exposing its contents. |
| `BoundedOutput`, `AccurateDuration` | `vscode/test/speech_service.test.ts`: fails closed when transformed audio exceeds the complete-unit duration limit; snapshots listening speed, transforms once, and uses transformed duration without a second cloud request. |
| `FixedTail` | `vscode/test/speech_tempo_pcm.test.ts`: round trips exact signed samples and appends one final silent tail; `audio-ui/test/speech_tempo_composed.e2e.test.ts`: transforms two synthetic Kokoro parts in a real worker before local physical playback. |
| `ReadingApprovalHeld` | `core/test/player.test.ts`: keeps held reading and command approval after speech throw; keeps held reading and command approval after speech reject. |
| `HealthyProgress`, `CancelProgress` | `vscode/test/speech_tempo_client.e2e.test.ts`: runs the packaged worker in a real process and returns owned synthetic PCM; `vscode/test/speech_tempo_client.test.ts`: rejects canceled work immediately but keeps its slot until physical retirement. |
| Byte identity and signal tests | `vscode/test/speech_tempo.test.ts`: preserves the original samples exactly at 1.0 without aliasing them; changes duration while preserving a voiced tone at rate %s. |

TLC checked 2,563 generated / 868 distinct safety states, 17 / 17 healthy
states and 15 / 11 cancellation states. Successful progress assumes fair
transform and play; cancellation assumes eventual physical worker exit.
Disabling each snapshot, stale-result, bound, tail, worker-exclusivity,
watchdog-duration or played-rate guard violates its corresponding invariant.
Disabling transform, play or retirement violates the associated progress
property. Restricting retirement to the canceled phase violates cancellation
progress when the caller times out first. Setting reading to released violates
`ReadingApprovalHeld`. `TypeOK` is a sanity check, not independently mutated.
Synthetic tones and the retained offline corpus are not listening-quality
validation; real speech review is still required before claiming validated rates.

### `WarmSynthesisWorker`: bounded local synthesis ownership

The model abstracts the versioned capabilities to valid or invalid and a result
to a correctly sized or oversized one. It tracks a worker epoch, two units with
two parts each, and keeps a worker alive until its matching exit. `Ready` and
`Result` must match their owners; `LateResult` is a response that arrives while
the worker expects none (a previous epoch's result after the slot is ready, a
duplicate part, a result after retirement) and is rejected before buffering.
`Cancel` discards the matching result of a busy inference; `CancelBetween`
ends a unit between parts at once, so its remaining part never starts
(`NoCanceledResume`). No inference starts while paused. A fatal error leaves
the worker unavailable until a new epoch loads (`TruthfulUnavailable`). Buffers
are modeled only as the oversize flag on a result; a stored buffer that must be
cleared on cancel is not modeled, and cancel during loading is not covered (the
load is not interrupted). Single inference is structural: `Dispatch` is enabled
only from `ready`, and no invariant would catch one from another phase.
Automatic replay of canceled or failed text is not modeled; `GuardReplay =
FALSE` models a dispatch that still names the previous unit.

| Invariant | Implementation mapping |
|---|---|
| `TypeOK` | Sanity check of the declared variable ranges. |
| `OneEngine`, `ValidReady`, `CorrectDelivery`, `NoPausedDispatch`, `NoReplay`, `NoCanceledResume`, `TruthfulUnavailable` | Pending implementation and tests. |
| `HealthyProgress`, `CancellationProgress`, `RetirementProgress` | Pending implementation and tests. |

| Mutation | Breaks |
|---|---|
| `GuardEpoch`, `GuardReady` | `ValidReady` |
| `GuardPart`, `GuardBound`, `GuardLate` | `CorrectDelivery` |
| `GuardExit`, `GuardExitEpoch`, `GuardDiscard` | `OneEngine` |
| `GuardPause` | `NoPausedDispatch` |
| `GuardReplay` | `NoReplay` |
| `GuardCancel` | `NoCanceledResume` |
| `GuardFailed` | `TruthfulUnavailable` |
| `EnableLoad`, `EnableReady`, `EnableDispatch`, `EnableNextPart`, `EnableResult` (healthy config) | `HealthyProgress`, counterexamples of 1, 2, 3, 5 and 4 states |
| `EnableDiscard` (cancellation config) | `CancellationProgress` (372 states) |
| `EnableRetire`, `EnableExit` (watchdog config) | `CancellationProgress` (70 and 114 states) |
| `EnableExit` (retirement config) | `RetirementProgress` |

TLC checked 3,969 generated / 440 distinct safety states, 11 / 11 healthy
states, and 3,969 / 440 states in each cancellation, watchdog and retirement
configuration. Disabling the discard alone violates the discard-fair
`CancellationProgress` while the watchdog configuration still holds, and
disabling the watchdog alone violates the watchdog configuration while the
discard-fair one still holds, so neither fairness assumption hides the other.
`EnableNextPart` is distinct from `EnableDispatch`.
The model does not prove actual audio quality or operating-system process exit.
