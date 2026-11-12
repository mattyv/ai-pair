---- MODULE SpeechSettings -----------------------------------------------------
(******************************************************************************)
(* Two immutable request identities expose stale credentials and catalogs.   *)
(******************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS MaxEpoch
ASSUME MaxEpoch \in Nat \ {0}
Ids == 1..2
VARIABLES provider, hasKey, epoch, page, revision, issued, latest, reqEpoch,
          reqPage, reqRevision, ready, owner, wanted, readIssued, readEpoch,
          readValue, shownKey, canceled, beforeKey, publicSecret,
          accepted, correct
vars == <<provider, hasKey, epoch, page, revision, issued, latest, reqEpoch,
          reqPage, reqRevision, ready, owner, wanted, readIssued, readEpoch,
          readValue, shownKey, canceled, beforeKey, publicSecret,
          accepted, correct>>
TypeOK == /\ provider \in {"local", "elevenlabs", "openrouter"}
          /\ hasKey \in BOOLEAN
          /\ epoch \in 0..MaxEpoch /\ page \in 1..2 /\ revision \in 0..3
          /\ issued \in 0..2 /\ latest \in 0..2 /\ owner \in 0..2
          /\ reqEpoch \in [Ids -> 0..MaxEpoch] /\ reqPage \in [Ids -> 1..2]
          /\ reqRevision \in [Ids -> 0..3] /\ ready \subseteq Ids
          /\ readIssued \in 0..2 /\ readEpoch \in [Ids -> 0..MaxEpoch]
          /\ readValue \in [Ids -> BOOLEAN] /\ shownKey \in BOOLEAN
          /\ wanted \in BOOLEAN /\ canceled \in BOOLEAN
          /\ beforeKey \in BOOLEAN /\ publicSecret \in BOOLEAN
          /\ accepted \in BOOLEAN /\ correct \in BOOLEAN
Init == /\ provider = "local" /\ hasKey = FALSE /\ epoch = 0 /\ page = 1
        /\ revision = 0 /\ issued = 0 /\ latest = 0 /\ owner = 0
        /\ reqEpoch = [i \in Ids |-> 0] /\ reqPage = [i \in Ids |-> 1]
        /\ reqRevision = [i \in Ids |-> 0] /\ ready = {} /\ wanted = FALSE
        /\ readIssued = 0 /\ readEpoch = [i \in Ids |-> 0]
        /\ readValue = [i \in Ids |-> FALSE] /\ shownKey = FALSE
        /\ canceled = FALSE /\ beforeKey = FALSE /\ publicSecret = FALSE
        /\ accepted = FALSE /\ correct = FALSE
Select(p) == /\ p \in {"local", "elevenlabs", "openrouter"}
             /\ (p = provider \/ revision < 3)
             /\ provider' = p
             /\ revision' = IF p = provider THEN revision ELSE revision + 1
             /\ latest' = 0 /\ owner' = 0 /\ wanted' = FALSE
             /\ canceled' = FALSE
             /\ UNCHANGED <<hasKey, epoch, page, issued, reqEpoch, reqPage,
                 reqRevision, ready, readIssued, readEpoch, readValue,
                 shownKey, beforeKey, publicSecret, accepted, correct>>
ChangeKey(k) == /\ k \in BOOLEAN /\ epoch < MaxEpoch
                /\ hasKey' = k /\ epoch' = epoch + 1 /\ shownKey' = k
                /\ latest' = 0 /\ owner' = 0 /\ wanted' = FALSE
                /\ canceled' = FALSE
                /\ UNCHANGED <<provider, page, revision, issued, reqEpoch,
                    reqPage, reqRevision, ready, readIssued, readEpoch,
                    readValue, beforeKey, publicSecret, accepted, correct>>
CancelPrompt == /\ beforeKey' = hasKey /\ canceled' = TRUE
                /\ UNCHANGED <<provider, hasKey, epoch, page, revision,
                    issued, latest, reqEpoch, reqPage, reqRevision, ready,
                    owner, wanted, readIssued, readEpoch, readValue,
                    shownKey, publicSecret, accepted, correct>>
ReplacePage == /\ page = 1 /\ page' = 2 /\ latest' = 0 /\ owner' = 0
               /\ wanted' = FALSE /\ canceled' = FALSE
               /\ UNCHANGED <<provider, hasKey, epoch, revision, issued,
                   reqEpoch, reqPage, reqRevision, ready, readIssued,
                   readEpoch, readValue, shownKey, beforeKey, publicSecret,
                   accepted, correct>>
Read == /\ readIssued < 2 /\ readIssued' = readIssued + 1
        /\ readEpoch' = [readEpoch EXCEPT ![readIssued + 1] = epoch]
        /\ readValue' = [readValue EXCEPT ![readIssued + 1] = hasKey]
        /\ canceled' = FALSE
        /\ UNCHANGED <<provider, hasKey, epoch, page, revision, issued, latest,
            reqEpoch, reqPage, reqRevision, ready, owner, wanted, shownKey,
            beforeKey, publicSecret, accepted, correct>>
ReadReply(i) == /\ i \in 1..readIssued
                /\ shownKey' = IF readEpoch[i] = epoch
                               THEN readValue[i] ELSE shownKey
                /\ canceled' = FALSE
                /\ UNCHANGED <<provider, hasKey, epoch, page, revision,
                    issued, latest, reqEpoch, reqPage, reqRevision, ready,
                    owner, wanted, readIssued, readEpoch, readValue,
                    beforeKey, publicSecret, accepted, correct>>
Intent == /\ provider \in {"elevenlabs", "openrouter"} /\ hasKey
          /\ issued < 2 /\ wanted' = TRUE
          /\ UNCHANGED <<provider, hasKey, epoch, page, revision, issued,
              latest, reqEpoch, reqPage, reqRevision, ready, owner, readIssued,
              readEpoch, readValue, shownKey, canceled, beforeKey, publicSecret,
              accepted, correct>>
Request == /\ provider \in {"elevenlabs", "openrouter"} /\ hasKey
           /\ wanted /\ issued < 2
           /\ issued' = issued + 1 /\ latest' = issued + 1 /\ wanted' = FALSE
           /\ reqEpoch' = [reqEpoch EXCEPT ![issued + 1] = epoch]
           /\ reqPage' = [reqPage EXCEPT ![issued + 1] = page]
           /\ reqRevision' = [reqRevision EXCEPT ![issued + 1] = revision]
           /\ canceled' = FALSE
           /\ UNCHANGED <<provider, hasKey, epoch, page, revision, ready,
               owner, readIssued, readEpoch, readValue, shownKey, beforeKey,
               publicSecret, accepted, correct>>
Eligible(i) == /\ i \in Ids /\ i = latest
               /\ provider \in {"elevenlabs", "openrouter"} /\ hasKey
               /\ reqEpoch[i] = epoch /\ reqPage[i] = page
               /\ reqRevision[i] = revision
Accept(i) == Eligible(i)
Deliver(i) == /\ i \in 1..issued /\ ready' = ready \cup {i}
              /\ UNCHANGED <<provider, hasKey, epoch, page, revision, issued,
                  latest, reqEpoch, reqPage, reqRevision, owner, wanted,
                  readIssued, readEpoch, readValue, shownKey, canceled,
                  beforeKey, publicSecret, accepted, correct>>
Consume == /\ ready # {}
           /\ LET i == IF latest \in ready THEN latest
                       ELSE CHOOSE n \in ready: TRUE
              IN /\ accepted' = Accept(i) /\ correct' = Eligible(i)
                 /\ owner' = IF Accept(i) THEN i ELSE owner
                 /\ ready' = ready \ {i}
           /\ UNCHANGED <<provider, hasKey, epoch, page, revision, issued,
               latest, reqEpoch, reqPage, reqRevision, wanted, readIssued,
               readEpoch, readValue, shownKey, canceled, beforeKey,
               publicSecret>>
Next == (\E p \in {"local", "elevenlabs", "openrouter"}: Select(p))
        \/ (\E k \in BOOLEAN: ChangeKey(k)) \/ CancelPrompt \/ ReplacePage
        \/ Read \/ (\E i \in Ids: ReadReply(i)) \/ Intent \/ Request
        \/ (\E i \in Ids: Deliver(i)) \/ Consume
Spec == Init /\ [][Next]_vars /\ WF_vars(Request) /\ WF_vars(Consume)
RequestProgress == []((wanted /\ provider \in {"elevenlabs", "openrouter"}
                        /\ hasKey /\ issued < 2)
                    => <>(~wanted \/ provider = "local" \/ ~hasKey))
ReplyProgress == \A i \in Ids:
    []((i \in ready /\ Eligible(i)) => <>(owner = i \/ ~Eligible(i)))
CatalogSafe == owner # 0 =>
    /\ provider \in {"elevenlabs", "openrouter"} /\ hasKey
    /\ reqEpoch[owner] = epoch
    /\ reqPage[owner] = page /\ reqRevision[owner] = revision
AcceptedSafe == accepted => correct
ReadSafe == shownKey = hasKey
PromptSafe == canceled => hasKey = beforeKey
NoSecret == ~publicSecret
================================================================================
