---- MODULE CloudNarration -----------------------------------------------------
(***************************************************************************)
(* One cloud generation, one bounded request, and independent Pair gates. *)
(* A canceled network request keeps ownership until it settles.           *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GuardProvider, GuardKey, GuardEpoch, GuardSingle, GuardGates,
    GuardCanceled, GuardRetry, HealthyKey

VARIABLES provider, key, epoch, generation, request, requestEpoch, active,
          aborted, ready, playing, failed, sent, reading, approval,
          invalidSend, staleAccepted, overlap, gatesChanged, restarted,
          retried, dispatched, diagnostic, staleDiagnosticChanged
vars == <<provider, key, epoch, generation, request, requestEpoch, active,
          aborted, ready, playing, failed, sent, reading, approval,
          invalidSend, staleAccepted, overlap, gatesChanged, restarted,
          retried, dispatched, diagnostic,
                   staleDiagnosticChanged>>

TypeOK ==
    /\ provider \in {"local", "elevenlabs", "openrouter"}
    /\ key \in BOOLEAN /\ epoch \in 0..2 /\ generation \in 0..2
    /\ request \in 0..2 /\ requestEpoch \in 0..2
    /\ active \in BOOLEAN /\ aborted \in BOOLEAN /\ ready \in BOOLEAN
    /\ playing \in BOOLEAN /\ failed \in BOOLEAN /\ sent \in BOOLEAN
    /\ reading \in BOOLEAN /\ approval \in BOOLEAN
    /\ invalidSend \in BOOLEAN /\ staleAccepted \in BOOLEAN
    /\ overlap \in BOOLEAN /\ gatesChanged \in BOOLEAN
    /\ restarted \in BOOLEAN /\ retried \in BOOLEAN
    /\ dispatched \in BOOLEAN
    /\ staleDiagnosticChanged \in BOOLEAN
    /\ diagnostic \in {"none", "key", "auth", "rate", "network",
                         "timeout", "invalid", "canceled", "unknown"}

Init ==
    /\ provider = "local" /\ key = FALSE /\ epoch = 0 /\ generation = 0
    /\ request = 0 /\ requestEpoch = 0 /\ active = FALSE
    /\ aborted = FALSE /\ ready = FALSE /\ playing = FALSE /\ failed = FALSE
    /\ sent = FALSE /\ reading = TRUE /\ approval = TRUE
    /\ invalidSend = FALSE /\ staleAccepted = FALSE /\ overlap = FALSE
    /\ gatesChanged = FALSE /\ restarted = FALSE /\ retried = FALSE
    /\ dispatched = FALSE /\ diagnostic = "none"
    /\ staleDiagnosticChanged = FALSE

Choose ==
    /\ provider' \in {"local", "elevenlabs", "openrouter"}
    /\ provider' # provider
    /\ active' = FALSE /\ aborted' = ((request # 0) \/ aborted)
    /\ ready' = FALSE /\ playing' = FALSE
    /\ UNCHANGED <<key, epoch, generation, request, requestEpoch, failed,
                   sent, reading, approval, invalidSend, staleAccepted,
                   overlap, gatesChanged, restarted, retried, dispatched,
                   diagnostic, staleDiagnosticChanged>>

Credential ==
    /\ epoch < 2 /\ epoch' = epoch + 1 /\ key' = ~key
    /\ active' = FALSE /\ aborted' = ((request # 0) \/ aborted)
    /\ ready' = FALSE /\ playing' = FALSE
    /\ UNCHANGED <<provider, generation, request, requestEpoch, failed,
                   sent, reading, approval, invalidSend, staleAccepted,
                   overlap, gatesChanged, restarted, retried, dispatched,
                   diagnostic, staleDiagnosticChanged>>

Start ==
    /\ generation < 2 /\ ~active /\ (~GuardSingle \/ request = 0)
    /\ (~GuardProvider \/ provider \in {"elevenlabs", "openrouter"})
    /\ (~GuardKey \/ key)
    /\ generation' = generation + 1 /\ request' = generation + 1
    /\ requestEpoch' = epoch /\ active' = TRUE /\ aborted' = FALSE
    /\ dispatched' = FALSE /\ failed' = FALSE /\ ready' = FALSE
    /\ playing' = FALSE /\ overlap' = (overlap \/ (request # 0))
    /\ UNCHANGED <<provider, key, epoch, sent, reading, approval,
                   invalidSend, staleAccepted, gatesChanged, restarted,
                   retried, diagnostic,
                   staleDiagnosticChanged>>

Dispatch ==
    /\ request # 0 /\ ~dispatched
    /\ (~GuardProvider \/ provider \in {"elevenlabs", "openrouter"})
    /\ (~GuardKey \/ key)
    /\ (~GuardEpoch \/ (active /\ ~aborted /\ requestEpoch = epoch))
    /\ dispatched' = TRUE /\ sent' = TRUE
    /\ invalidSend' = (invalidSend \/ (provider = "local") \/ ~key)
    /\ staleAccepted' = (staleAccepted \/ ~active \/ aborted \/
                          (requestEpoch # epoch))
    /\ UNCHANGED <<provider, key, epoch, generation, request, requestEpoch,
                   active, aborted, ready, playing, failed, reading, approval,
                   overlap, gatesChanged, restarted, retried, diagnostic,
                   staleDiagnosticChanged>>

Cancel ==
    /\ active /\ active' = FALSE /\ aborted' = ((request # 0) \/ aborted)
    /\ ready' = FALSE /\ playing' = FALSE
    /\ UNCHANGED <<provider, key, epoch, generation, request, requestEpoch,
                   failed, sent, reading, approval, invalidSend, staleAccepted,
                   overlap, gatesChanged, restarted, retried, dispatched,
                   diagnostic, staleDiagnosticChanged>>

Response ==
    /\ request # 0 /\ dispatched
    /\ LET allowed == active /\ ~aborted /\
                      provider \in {"elevenlabs", "openrouter"} /\ key /\
                      requestEpoch = epoch /\ request = generation
       IN /\ ready' = (allowed \/ ~GuardEpoch)
          /\ staleAccepted' = (staleAccepted \/ (~allowed /\ ready'))
    /\ request' = 0 /\ aborted' = FALSE /\ dispatched' = FALSE
    /\ UNCHANGED <<provider, key, epoch, generation, requestEpoch, active,
                   playing, failed, sent, reading, approval, invalidSend,
                   overlap, gatesChanged, restarted, retried, diagnostic,
                   staleDiagnosticChanged>>

Error ==
    /\ request # 0 /\ dispatched /\ request' = 0 /\ active' = FALSE
    /\ failed' = TRUE /\ dispatched' = FALSE
    /\ diagnostic' \in IF active /\ ~aborted
                          THEN {"key", "auth", "rate", "network", "timeout",
                                "invalid", "canceled", "unknown"}
                          ELSE {diagnostic}
    /\ staleDiagnosticChanged' =
         (staleDiagnosticChanged \/ ((~active \/ aborted) /\
                                      diagnostic' # diagnostic))
    /\ aborted' = FALSE /\ ready' = FALSE /\ playing' = FALSE
    /\ reading' = IF GuardGates THEN reading ELSE FALSE
    /\ approval' = IF GuardGates THEN approval ELSE FALSE
    /\ gatesChanged' = (gatesChanged \/ (reading' # reading) \/
                          (approval' # approval))
    /\ UNCHANGED <<provider, key, epoch, generation, requestEpoch, sent,
                   invalidSend, staleAccepted, overlap, restarted, retried>>

Play ==
    /\ ready \/ (~GuardCanceled /\ sent /\ ~active)
    /\ playing' = TRUE /\ ready' = FALSE
    /\ restarted' = (restarted \/ ~active)
    /\ UNCHANGED <<provider, key, epoch, generation, request, requestEpoch,
                   active, aborted, failed, sent, reading, approval,
                   invalidSend, staleAccepted, overlap, gatesChanged,
                   retried, dispatched, diagnostic,
                   staleDiagnosticChanged>>

Finish ==
    /\ playing /\ playing' = FALSE /\ active' = FALSE
    /\ UNCHANGED <<provider, key, epoch, generation, request, requestEpoch,
                   aborted, ready, failed, sent, reading, approval, invalidSend,
                   staleAccepted, overlap, gatesChanged, restarted,
                   retried, dispatched, diagnostic,
                   staleDiagnosticChanged>>

Retry ==
    /\ ~GuardRetry /\ failed /\ request = 0 /\ request' = generation
    /\ retried' = TRUE
    /\ UNCHANGED <<provider, key, epoch, generation, requestEpoch, active,
                   aborted, ready, playing, failed, sent, reading, approval,
                   invalidSend, staleAccepted, overlap, gatesChanged, restarted,
                   dispatched, diagnostic,
                   staleDiagnosticChanged>>

Timeout ==
    /\ request # 0 /\ (~HealthyKey \/ dispatched \/ aborted \/ ~active)
    /\ request' = 0 /\ active' = FALSE
    /\ diagnostic' = IF active /\ ~aborted THEN "timeout" ELSE diagnostic
    /\ staleDiagnosticChanged' =
         (staleDiagnosticChanged \/ ((~active \/ aborted) /\
                                      diagnostic' # diagnostic))
    /\ aborted' = FALSE /\ dispatched' = FALSE /\ failed' = TRUE
    /\ ready' = FALSE /\ playing' = FALSE
    /\ UNCHANGED <<provider, key, epoch, generation, requestEpoch, sent,
                   reading, approval, invalidSend, staleAccepted, overlap,
                   gatesChanged, restarted, retried>>

Next == Choose \/ Credential \/ Start \/ Dispatch \/ Cancel \/ Response \/
        Error \/ Timeout \/ Play \/ Finish \/ Retry
Spec == Init /\ [][Next]_vars /\ WF_vars(Start) /\ WF_vars(Dispatch) /\
        WF_vars(Timeout) /\ WF_vars(Play)
NoStaleDiagnostic == ~staleDiagnosticChanged
SafeSend == ~invalidSend
NoStale == ~staleAccepted
NoOverlap == ~overlap
IndependentGates == reading /\ approval /\ ~gatesChanged
NoRestart == ~restarted
NoRetry == ~retried
RequestSettles == (request # 0) ~> (request = 0)
EligibleStarts ==
    \A g \in 0..1:
      (provider \in {"elevenlabs", "openrouter"} /\ key /\
       request = 0 /\ ~active /\
       generation = g) ~>
      (generation > g \/ provider = "local" \/ ~key)
EligibleDispatch ==
    (request # 0 /\ active /\ ~aborted /\ ~dispatched /\
     provider \in {"elevenlabs", "openrouter"} /\ key /\
     requestEpoch = epoch) ~>
    (dispatched \/ request = 0 \/ ~active)
ReadyPlays == ready ~> (playing \/ ~active)
================================================================================
