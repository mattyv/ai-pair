---- MODULE WorkerProvider -----------------------------------------------------
\* A provider is a routing hint bound to a successful owner attachment, never
\* authentication. Known client metadata takes precedence over an explicit
\* hint. Unknown metadata and hint use no provider override. Generations never
\* repeat, even when a resumed session has the same persistent session ID.
EXTENDS Naturals

CONSTANTS Codex, Claude, NoProvider, PreferClient, ClearOnDisconnect,
          AllowForeignGrant
ASSUME /\ Codex # Claude /\ NoProvider \notin {Codex, Claude}
       /\ PreferClient \in BOOLEAN /\ ClearOnDisconnect \in BOOLEAN
       /\ AllowForeignGrant \in BOOLEAN

Providers == {Codex, Claude}
Choices == Providers \cup {NoProvider}
Generations == {1, 2}
NoOwner == 0

VARIABLES owner, bound, client, hint, grantedBy
vars == <<owner, bound, client, hint, grantedBy>>

Init == /\ owner = NoOwner
        /\ bound = NoProvider
        /\ client = NoProvider
        /\ hint = NoProvider
        /\ grantedBy = NoOwner

Select(c, h) == IF PreferClient /\ c # NoProvider THEN c ELSE h

\* Successful start binds its metadata to the exact socket generation.
Start(g, c, h) == /\ owner = NoOwner
                  /\ owner' = g
                  /\ client' = c /\ hint' = h
                  /\ bound' = Select(c, h)
                  /\ grantedBy' = NoOwner

\* Disconnect retires the attachment identity and provider.
Disconnect == /\ owner # NoOwner
              /\ owner' = NoOwner
              /\ bound' = IF ClearOnDisconnect THEN NoProvider ELSE bound
              /\ grantedBy' = NoOwner
              /\ UNCHANGED <<client, hint>>

\* Only the current owner can request a grant.
Grant(g) == /\ owner # NoOwner /\ grantedBy = NoOwner
            /\ (g = owner \/ AllowForeignGrant)
            /\ grantedBy' = g
            /\ UNCHANGED <<owner, bound, client, hint>>

Next == \/ \E g \in Generations, c \in Choices, h \in Choices : Start(g, c, h)
        \/ Disconnect
        \/ \E g \in Generations : Grant(g)
Spec == Init /\ [][Next]_vars /\ (\A g \in Generations : WF_vars(Grant(g)))

TypeOK == /\ owner \in Generations \cup {NoOwner}
          /\ bound \in Choices /\ client \in Choices /\ hint \in Choices
          /\ grantedBy \in Generations \cup {NoOwner}
KnownClientWins == owner # NoOwner /\ client # NoProvider => bound = client
HintForUnknown == owner # NoOwner /\ client = NoProvider => bound = hint
DetachedHasNoProvider == owner = NoOwner => bound = NoProvider
\* Provider is never admission: only the owner may request a grant.
NoForeignGrant == grantedBy # NoOwner => grantedBy = owner
GrantProgress == owner # NoOwner ~> (owner = NoOwner \/ grantedBy = owner)
================================================================================
