---- MODULE Shortcuts ----------------------------------------------------------
(******************************************************************************)
(* The keyboard shortcuts the panel's tooltips name (#94):                    *)
(* packages/vscode/src/shortcuts.ts (`shortcutLabels`, ShortcutWatcher),      *)
(* panel.ts (`showShortcuts`, the `ready` message), and webview/panel.ts (the *)
(* `shortcuts` message). VS Code has no API that reports a command's          *)
(* keybinding, so the extension reads the programmer's keybindings.json       *)
(* itself: once as it starts, and again each time the file changes. A read   *)
(* is asynchronous, so two can be in flight, and the later one can land      *)
(* first. The host keeps the labels of the latest read it took, and posts     *)
(* them to the page when a read lands and when a page loads. Pages come and   *)
(* go, and the programmer edits the file at any time.                         *)
(*                                                                            *)
(* `Label` is VS Code's own rule (keybindingResolver.ts, `handleRemovals` and *)
(* `lookupPrimaryKeybinding`), cut down to what a tooltip needs: a removal,   *)
(* `-command`, removes only the command's default binding, with or without a *)
(* key that matches it, whatever its place in the file; the binding a menu    *)
(* names is the command's last, so the file's last addition wins, else the   *)
(* default if no removal took it. `when` clauses are not modeled: a tooltip   *)
(* has no context to evaluate them in.                                        *)
(******************************************************************************)
EXTENDS Naturals, Sequences, PairDefs

CONSTANTS
    MaxEdits,     \* how often the model edits keybindings.json
    MaxPages,     \* how many pages the model loads
    MaxLength,    \* the most entries keybindings.json holds
    DropStale,    \* TRUE: a read that a later one overtook is dropped (the fix)
    ReadOnChange, \* TRUE: a change to the file starts a read (the fix)
    SendOnReady   \* TRUE: a page that loads is sent the labels (the fix)

ASSUME AssumeMaxEdits == MaxEdits \in Nat
ASSUME AssumeMaxPages == MaxPages \in Nat \ {0}
ASSUME AssumeMaxLength == MaxLength \in Nat
ASSUME AssumeDropStale == DropStale \in BOOLEAN
ASSUME AssumeReadOnChange == ReadOnChange \in BOOLEAN
ASSUME AssumeSendOnReady == SendOnReady \in BOOLEAN

\* Two of the extension's commands, and two keys, are enough to tell one
\* command's binding from another's.
Commands == {"pause", "attention"}
Keys == {"q", "w"}

\* No key: an entry without one, or a command left unbound. Any value that is
\* not a key will do, so the config makes it a model value (6.20).
NoKey == CHOOSE v : v \notin Keys

\* The bindings `contributes.keybindings` gives each command.
Defaults == [c \in Commands |-> IF c = "pause" THEN "q" ELSE "w"]

\* An entry of keybindings.json: a binding added, or one removed (`-command`).
\* An added entry without a key binds nothing, as in VS Code.
Entries == [command: Commands, key: Keys \cup {NoKey}, remove: BOOLEAN]

\* The file's contents. A missing or unreadable file reads as empty.
Contents == UNION {[1..n -> Entries] : n \in 0..MaxLength}

\* The key each command's tooltip names.
Labels == [Commands -> Keys \cup {NoKey}]

\* No labels: none reached the host or the page yet. The page then shows its
\* tooltips without a key. Any value that is not labels will do (6.20).
NoLabels == CHOOSE v : v \notin Labels

\* The places in `file` that add a key to `c`.
Added(file, c) ==
    {i \in DOMAIN file : file[i].command = c /\ ~file[i].remove
                         /\ file[i].key # NoKey}

\* Whether `file` removes `c`'s default binding.
Removed(file, c) ==
    \E i \in DOMAIN file :
        /\ file[i].command = c
        /\ file[i].remove
        /\ file[i].key \in {NoKey, Defaults[c]}

\* The key VS Code names for each command, given the programmer's file.
Label(file) ==
    [c \in Commands |->
        IF Added(file, c) # {}
        THEN file[CHOOSE i \in Added(file, c) :
                      \A j \in Added(file, c) : j <= i].key
        ELSE IF Removed(file, c) THEN NoKey ELSE Defaults[c]]

VARIABLES
    file,      \* keybindings.json as it is on disk
    edits,     \* edits so far
    reads,     \* reads in flight: [number, labels: what the file said]
    started,   \* reads started so far; the latest read's number
    cache,     \* the labels the host holds; NoLabels before a read lands
    cacheRead, \* the number of the read `cache` came from; 0 before one
    page,      \* the webview's page: "loaded", "disposed"
    pages,     \* pages loaded so far
    shown      \* the labels the page shows; NoLabels when it has none

vars == <<file, edits, reads, started, cache, cacheRead, page, pages, shown>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ file \in Contents
    /\ edits \in Nat
    /\ reads \subseteq [number: 1..started, labels: Labels]
    /\ started \in Nat \ {0}
    /\ cache \in Labels \cup {NoLabels}
    /\ cacheRead \in 0..started
    /\ page \in PageStates
    /\ pages \in Nat \ {0}
    /\ shown \in Labels \cup {NoLabels}

--------------------------------------------------------------------------------

\* The activation: the host starts the first read, and the first page loads
\* with no labels.
Init ==
    /\ file \in Contents
    /\ edits = 0
    /\ reads = {[number |-> 1, labels |-> Label(file)]}
    /\ started = 1
    /\ cache = NoLabels
    /\ cacheRead = 0
    /\ page = "loaded"
    /\ pages = 1
    /\ shown = NoLabels

\* The programmer saves keybindings.json. The file watcher reports it, and
\* ShortcutWatcher starts a read, numbered, of the file as it now is.
Edit ==
    /\ edits < MaxEdits
    /\ edits' = edits + 1
    /\ \E f \in Contents \ {file} :
        /\ file' = f
        /\ IF ReadOnChange
           THEN /\ started' = started + 1
                /\ reads' = reads \cup {[number |-> started + 1,
                                         labels |-> Label(f)]}
           ELSE UNCHANGED <<started, reads>>
    /\ UNCHANGED <<cache, cacheRead, page, pages, shown>>

\* A read lands. ShortcutWatcher hands its labels to the panel's
\* `showShortcuts` only if no later read started; the panel keeps them and
\* posts them to a loaded page.
Land(r) ==
    /\ reads' = reads \ {r}
    /\ IF ~DropStale \/ r.number = started
       THEN /\ cache' = r.labels
            /\ cacheRead' = r.number
            /\ shown' = IF page = "loaded" THEN r.labels ELSE shown
       ELSE UNCHANGED <<cache, cacheRead, shown>>
    /\ UNCHANGED <<file, edits, started, page, pages>>

\* `onDidDispose`: the page goes, and its tooltips with it.
Dispose ==
    /\ page = "loaded"
    /\ page' = "disposed"
    /\ shown' = NoLabels
    /\ UNCHANGED <<file, edits, reads, started, cache, cacheRead, pages>>

\* `ready`: a new page loads, after a dispose or as a reload, and the panel
\* posts it the labels it holds, if any.
LoadPage ==
    /\ pages < MaxPages
    /\ pages' = pages + 1
    /\ page' = "loaded"
    /\ shown' = IF SendOnReady THEN cache ELSE NoLabels
    /\ UNCHANGED <<file, edits, reads, started, cache, cacheRead>>

\* The model's end: nothing left to do.
Finished ==
    /\ reads = {}
    /\ edits = MaxEdits
    /\ pages = MaxPages
    /\ UNCHANGED vars

Next ==
    \/ Edit
    \/ \E r \in reads : Land(r)
    \/ Dispose
    \/ LoadPage
    \/ Finished

\* A read that started lands: the file system answers.
Spec == Init /\ [][Next]_vars /\ WF_vars(\E r \in reads : Land(r))

--------------------------------------------------------------------------------

\* A loaded page that shows labels shows the host's.
ShowsCache == (page = "loaded" /\ shown # NoLabels) => shown = cache

\* The host never takes a read older than the one it holds.
Monotone == cacheRead' >= cacheRead
MonotoneProp == [][Monotone]_vars

\* Once the file stops changing, a loaded page comes to name the keys the
\* file binds, and keeps naming them: something must happen.
Converges == <>[](page = "loaded" => shown = Label(file))

================================================================================
