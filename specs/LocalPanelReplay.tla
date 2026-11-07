---- MODULE LocalPanelReplay ---------------------------------------------------
(***************************************************************************
 * One bounded two-chunk visible message, with stale and malformed frames. *
 * Payload classes stand for validated text, audio, and secrets.             *
 ***************************************************************************)
EXTENDS Naturals
CONSTANTS GuardOrder, GuardEpoch, GuardBound, GuardPayload
VARIABLES connected, conn, page, lastSeq, lastMessage, partial, firstConn,
          firstPage, firstMessage, size, delivered, badOrder, badEpoch,
          badBound, badPayload
vars == <<connected, conn, page, lastSeq, lastMessage, partial, firstConn,
          firstPage, firstMessage, size, delivered, badOrder, badEpoch,
          badBound, badPayload>>

Init ==
  /\ connected = TRUE /\ conn = 1 /\ page = 1 /\ lastSeq = 0
  /\ lastMessage = 0 /\ partial = FALSE /\ firstConn = 0 /\ firstPage = 0
  /\ firstMessage = 0 /\ size = 0 /\ delivered = 0
  /\ badOrder = FALSE /\ badEpoch = FALSE /\ badBound = FALSE
  /\ badPayload = FALSE

Receive(c, p, seq, msg, index, count, len, payload) ==
  LET fresh == seq > lastSeq
      epochOK == c = conn /\ p = page
      orderOK == count = 2 /\
                 (IF partial THEN index = 1 /\ msg = firstMessage
                  ELSE index = 0 /\ msg > lastMessage)
      boundOK == len = 1 /\ (IF partial THEN size + len <= 2 ELSE len <= 2)
      payloadOK == payload = "text"
      accept == connected /\ fresh /\ (epochOK \/ ~GuardEpoch) /\
                (orderOK \/ ~GuardOrder) /\ (boundOK \/ ~GuardBound) /\
                (payloadOK \/ ~GuardPayload)
      complete == accept /\ partial
  IN
  /\ connected
  /\ lastSeq' = IF fresh THEN seq ELSE lastSeq
  /\ partial' = (accept /\ ~partial)
  /\ firstConn' = IF accept /\ ~partial THEN c ELSE 0
  /\ firstPage' = IF accept /\ ~partial THEN p ELSE 0
  /\ firstMessage' = IF accept /\ ~partial THEN msg ELSE 0
  /\ size' = IF accept /\ ~partial THEN len ELSE 0
  /\ delivered' = IF complete THEN delivered + 1 ELSE delivered
  /\ lastMessage' = IF complete THEN msg ELSE lastMessage
  /\ badOrder' = (badOrder \/ (accept /\ ~orderOK))
  /\ badEpoch' = (badEpoch \/ (accept /\ (~epochOK \/
                    (partial /\ (firstConn # c \/ firstPage # p)))))
  /\ badBound' = (badBound \/ (accept /\ ~boundOK))
  /\ badPayload' = (badPayload \/ (accept /\ ~payloadOK))
  /\ UNCHANGED <<connected, conn, page>>

PageChange ==
  /\ connected /\ page = 1 /\ page' = 2
  /\ partial' = FALSE /\ firstConn' = 0 /\ firstPage' = 0
  /\ firstMessage' = 0 /\ size' = 0
  /\ UNCHANGED <<connected, conn, lastSeq, lastMessage, delivered,
                  badOrder, badEpoch, badBound, badPayload>>
Disconnect ==
  /\ connected /\ connected' = FALSE /\ partial' = FALSE
  /\ firstConn' = 0 /\ firstPage' = 0 /\ firstMessage' = 0 /\ size' = 0
  /\ UNCHANGED <<conn, page, lastSeq, lastMessage, delivered, badOrder,
                  badEpoch, badBound, badPayload>>
Reconnect ==
  /\ ~connected /\ conn = 1 /\ connected' = TRUE /\ conn' = 2 /\ page' = 1
  /\ lastSeq' = 0 /\ lastMessage' = 0
  /\ UNCHANGED <<partial, firstConn, firstPage, firstMessage, size,
                  delivered, badOrder, badEpoch, badBound, badPayload>>
Next == (\E c \in 1..2, p \in 1..2, seq \in 1..3, msg \in 1..2,
            index \in 0..1, count \in 1..2, len \in 1..2,
            payload \in {"text", "audio", "secret"}:
            Receive(c, p, seq, msg, index, count, len, payload))
        \/ PageChange \/ Disconnect \/ Reconnect
Spec == Init /\ [][Next]_vars /\ WF_vars(Disconnect)
TypeOK == /\ connected \in BOOLEAN /\ conn \in 1..2 /\ page \in 1..2
          /\ lastSeq \in 0..3 /\ lastMessage \in 0..2 /\ partial \in BOOLEAN
          /\ size \in 0..2 /\ delivered \in 0..3
NoPartialOrMixed == ~badOrder
NoStaleDelivery == ~badEpoch
BoundedAssembly == ~badBound /\ size <= 2
NoAudioOrSecrets == ~badPayload
DisconnectClears == ~connected => ~partial /\ size = 0
GoodStart == ~partial /\ delivered = 0 /\
  Receive(conn, page, 1, 1, 0, 2, 1, "text")
GoodFinish == partial /\ delivered = 0 /\
  Receive(conn, page, 2, 1, 1, 2, 1, "text")
GoodSpec == Init /\ [][GoodStart \/ GoodFinish]_vars /\
            WF_vars(GoodStart) /\ WF_vars(GoodFinish)
EventuallyDelivered == <> (delivered > 0)
PendingSettles == partial ~> ~partial
CanAbort == partial => ENABLED Disconnect
CanStart == connected /\ ~partial /\ lastSeq < 3 /\ lastMessage < 2 =>
  ENABLED Receive(conn, page, lastSeq + 1, lastMessage + 1, 0, 2, 1, "text")
CanComplete == connected /\ partial /\ lastSeq < 3 =>
  ENABLED Receive(conn, page, lastSeq + 1, firstMessage, 1, 2, 1, "text")
================================================================================
