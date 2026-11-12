---- MODULE OpenRouterDecode ---------------------------------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS MaxPages, MaxRequests, MaxProbes, CloudFree, GuardReady, GuardSlot,
          GuardReadyDelivery, GuardDecodeDelivery, GuardIdentity
Pages == 1..MaxPages
Requests == 1..MaxRequests
ProbeIds == 1..MaxProbes
None == <<0, 0>>
Pairs == Pages \X Requests
ProbePairs == Pages \X ProbeIds
VARIABLES generation, current, alive, ready, probes, probeUsed, probePending,
  deliveries, active, slot,
          admitted, posted, accepted, paidUnready, postWhileBusy, staleReady,
            staleDecode,
          staleAccepted
vars == <<generation, current, alive, ready, probes, probeUsed, probePending,
  deliveries, active, slot,
          admitted, posted, accepted, paidUnready, postWhileBusy, staleReady,
            staleDecode,
          staleAccepted>>

TypeOK == /\ generation \in 1..MaxPages /\ current \in 0..MaxPages
          /\ alive \subseteq Pages /\ ready \subseteq alive
          /\ probes \subseteq ProbePairs /\ probeUsed \subseteq ProbePairs
          /\ probePending \in ProbePairs \cup {None}
          /\ deliveries \subseteq Pairs
          /\ active \in Pairs \cup {None} /\ slot \in Pairs \cup {None}
          /\ admitted \subseteq Pairs /\ posted \subseteq Pairs
          /\ accepted \subseteq posted
          /\ paidUnready \in BOOLEAN /\ postWhileBusy \in BOOLEAN
          /\ staleReady \in BOOLEAN /\ staleDecode \in BOOLEAN
          /\ staleAccepted \in BOOLEAN
Init == /\ generation = 1 /\ current = 1 /\ alive = {1} /\ ready = {}
        /\ probes = {} /\ probeUsed = {} /\ probePending = None
        /\ deliveries = {} /\ admitted = {}
        /\ active = None /\ slot = None /\ posted = {} /\ accepted = {}
        /\ paidUnready = FALSE /\ postWhileBusy = FALSE
        /\ staleReady = FALSE /\ staleDecode = FALSE /\ staleAccepted = FALSE

Probe == /\ current # 0 /\ probePending = None /\ current \notin ready
         /\ \E id \in ProbeIds:
              /\ <<current, id>> \notin probeUsed
              /\ probePending' = <<current, id>>
              /\ probeUsed' = probeUsed \cup {probePending'}
              /\ probes' = probes \cup {probePending'}
         /\ UNCHANGED <<generation, current, alive, ready, deliveries, active,
                        slot, admitted, posted, accepted, paidUnready,
                        postWhileBusy, staleReady, staleDecode, staleAccepted>>
ProbeFailure == /\ probePending # None /\ probePending' = None
                /\ UNCHANGED <<generation, current, alive, ready, probes,
                               probeUsed, deliveries, active, slot, admitted,
                               posted, accepted, paidUnready, postWhileBusy,
                               staleReady, staleDecode, staleAccepted>>
ReadinessDelivery == \E probe \in probes:
  /\ probes' = probes \ {probe}
  /\ LET valid == /\ probe = probePending /\ probe[1] = current
                   /\ probe[1] \in alive
     IN /\ ready' = IF valid \/ ~GuardReadyDelivery THEN ready \cup {probe[1]}
                    ELSE ready
        /\ staleReady' = (staleReady \/ (~valid /\ ~GuardReadyDelivery))
        /\ probePending' = IF valid THEN None ELSE probePending
  /\ UNCHANGED <<generation, current, alive, probeUsed, deliveries, active,
                 slot, admitted, posted, accepted, paidUnready, postWhileBusy,
                 staleDecode, staleAccepted>>
Admit == /\ CloudFree /\ current # 0 /\ active = None
         /\ (slot = None \/ ~GuardSlot)
         /\ (current \in ready \/ ~GuardReady)
         /\ \E id \in Requests: /\ <<current, id>> \notin admitted
              /\ active' = <<current, id>>
              /\ admitted' = admitted \cup {active'}
         /\ paidUnready' = (paidUnready \/ current \notin ready)
         /\ postWhileBusy' = (postWhileBusy \/ slot # None)
         /\ UNCHANGED <<generation, current, alive, ready, probes, probeUsed,
           probePending, deliveries,
                        slot, posted, accepted, staleReady, staleDecode,
                        staleAccepted>>
Post == /\ active # None /\ current = active[1] /\ active[1] \in alive
        /\ active \notin posted
        /\ posted' = posted \cup {active}
        /\ deliveries' = deliveries \cup {active}
        /\ UNCHANGED <<generation, current, alive, ready, probes, probeUsed,
          probePending,
                       active, slot, admitted,
                       accepted, paidUnready, postWhileBusy, staleReady,
                       staleDecode, staleAccepted>>
PostFailure == /\ active # None /\ active \in posted
               /\ slot = None /\ active' = None
               /\ UNCHANGED <<generation, current, alive, ready, probes,
                              probeUsed, probePending, deliveries, slot,
                                admitted, posted, accepted, paidUnready,
                              postWhileBusy, staleReady, staleDecode,
                              staleAccepted>>
DecodeDelivery == \E pair \in deliveries:
  /\ deliveries' = deliveries \ {pair}
  /\ LET valid == /\ active = pair /\ current = pair[1] /\ pair[1] \in alive
     IN /\ slot' = IF slot = None /\ (valid \/ ~GuardDecodeDelivery)
                   THEN pair ELSE slot
        /\ staleDecode' = (staleDecode \/ (slot' = pair /\ ~valid))
  /\ UNCHANGED <<generation, current, alive, ready, probes, probeUsed,
    probePending,
                 active, admitted, posted,
                 accepted, paidUnready, postWhileBusy, staleReady,
                 staleAccepted>>
Cancel == /\ active # None /\ active' = None
          /\ UNCHANGED <<generation, current, alive, ready, probes, probeUsed,
            probePending, deliveries,
                         slot, admitted, posted, accepted, paidUnready,
                           postWhileBusy,
                         staleReady, staleDecode, staleAccepted>>
Replace == /\ generation < MaxPages /\ generation' = generation + 1
           /\ current' = generation' /\ alive' = alive \cup {generation'}
           /\ active' = None /\ probePending' = None
           /\ UNCHANGED <<ready, probes, probeUsed, deliveries, slot,
             admitted, posted, accepted,
                          paidUnready, postWhileBusy, staleReady, staleDecode,
                          staleAccepted>>
Destroy == \E page \in alive:
  /\ alive' = alive \ {page} /\ ready' = ready \ {page}
  /\ current' = IF current = page THEN 0 ELSE current
  /\ active' = IF active[1] = page THEN None ELSE active
  /\ probePending' = IF probePending[1] = page THEN None ELSE probePending
  /\ slot' = IF slot[1] = page THEN None ELSE slot
  /\ UNCHANGED <<generation, probes, probeUsed, deliveries, admitted, posted,
    accepted, paidUnready,
                 postWhileBusy, staleReady, staleDecode, staleAccepted>>
Settle == /\ slot # None
          /\ LET valid == /\ active = slot /\ current = slot[1]
                           /\ slot[1] \in alive
             IN /\ accepted' \in IF valid \/ ~GuardIdentity
                                  THEN {accepted, accepted \cup {slot}}
                                  ELSE {accepted}
                /\ staleAccepted' =
                     (staleAccepted \/ (~valid /\ slot \in accepted'))
          /\ active' = IF active = slot THEN None ELSE active
          /\ slot' = None
          /\ UNCHANGED <<generation, current, alive, ready, probes, probeUsed,
            probePending, deliveries,
                         admitted, posted, paidUnready, postWhileBusy,
                           staleReady,
                         staleDecode>>
Next == Probe \/ ProbeFailure \/ ReadinessDelivery \/ Admit \/ Post \/
        PostFailure \/ DecodeDelivery \/ Cancel \/ Replace \/ Destroy \/ Settle
Spec == Init /\ [][Next]_vars /\ WF_vars(Admit) /\ WF_vars(Post)
ReadyBeforePaid == ~paidUnready
ExclusiveSlot == ~postWhileBusy
CurrentReadiness == ~staleReady
CurrentDispatch == ~staleDecode
CurrentResult == ~staleAccepted
PostHasAdmission == /\ posted \subseteq admitted
                    /\ active \in admitted \cup {None}
CanReleaseOnCancel == active # None => ENABLED (Cancel /\ active' = None)
CanReleaseOnFailure ==
  (active # None /\ active \in posted /\ slot = None) =>
    ENABLED (PostFailure /\ active' = None)
RetainOnCancel == [][slot # None /\ (Cancel \/ Replace) => slot' = slot]_vars
CanAdmit == (/\ CloudFree /\ current # 0 /\ current \in ready
             /\ active = None /\ slot = None
             /\ \E id \in Requests: <<current, id>> \notin admitted)
            => ENABLED Admit
StablePost == (<>[](/\ CloudFree /\ current # 0 /\ current \in ready
                      /\ active = None /\ slot = None
                      /\ \E id \in Requests: <<current, id>> \notin admitted))
               => <> (posted # {})
================================================================================
