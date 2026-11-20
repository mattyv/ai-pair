---- MODULE SettingsSections ---------------------------------------------------
EXTENDS Naturals

\* Models native disclosure state only: the fixed summaries, settings footer,
\* provider selection, and saved disclosure state. It abstracts field values,
\* actual DOM rendering, and persistence outside the webview state.
CONSTANTS Sections, Defaults, Providers, InitialProvider, Invalid,
          GuardDefaults, GuardSummaries, GuardFooter, GuardRestore,
          GuardProvider, GuardVisibility
ASSUME /\ Defaults \subseteq Sections
       /\ Providers \subseteq Sections
       /\ InitialProvider \in Providers
       /\ Invalid \notin SUBSET Sections

VARIABLES opened, summaries, footer, provider, visible, badDefault,
          badRestore, badProvider
vars == <<opened, summaries, footer, provider, visible, badDefault,
          badRestore, badProvider>>

Init ==
    /\ opened = IF GuardDefaults THEN Defaults ELSE {}
    /\ summaries = Sections
    /\ footer = TRUE
    /\ provider = InitialProvider
    /\ visible = {InitialProvider}
    /\ badDefault = (opened # Defaults)
    /\ badRestore = FALSE
    /\ badProvider = FALSE

\* Toggling one native summary cannot remove another summary or the footer.
Toggle(section) ==
    /\ section \in Sections
    /\ opened' = IF section \in opened THEN opened \ {section}
                 ELSE opened \cup {section}
    /\ summaries' = IF GuardSummaries THEN summaries ELSE summaries \ {section}
    /\ footer' = GuardFooter
    /\ UNCHANGED <<provider, visible, badDefault, badRestore, badProvider>>

\* Valid saved sets restore exactly; invalid or absent state gets defaults.
Restore(saved) ==
    /\ saved \in (SUBSET Sections) \cup {Invalid}
    /\ opened' = IF saved = Invalid
                   THEN IF GuardRestore THEN Defaults ELSE {}
                   ELSE saved
    /\ badRestore' = (badRestore \/
         IF saved = Invalid THEN opened' # Defaults ELSE opened' # saved)
    /\ UNCHANGED <<summaries, footer, provider, visible, badDefault,
                   badProvider>>

\* Selecting a provider opens its details and hides every other provider panel.
Select(nextProvider) ==
    /\ nextProvider \in Providers
    /\ provider' = nextProvider
    /\ opened' = IF GuardProvider THEN opened \cup {nextProvider} ELSE opened
    /\ visible' = IF GuardVisibility THEN {nextProvider} ELSE Providers
    /\ badProvider' = (badProvider \/ nextProvider \notin opened')
    /\ UNCHANGED <<summaries, footer, badDefault, badRestore>>

Next == (\E section \in Sections: Toggle(section))
        \/ (\E saved \in (SUBSET Sections) \cup {Invalid}: Restore(saved))
        \/ (\E nextProvider \in Providers: Select(nextProvider))
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ opened \subseteq Sections /\ summaries \subseteq Sections
    /\ footer \in BOOLEAN /\ provider \in Providers
    /\ visible \subseteq Providers
    /\ badDefault \in BOOLEAN /\ badRestore \in BOOLEAN
    /\ badProvider \in BOOLEAN
DefaultOpen == ~badDefault
AllSummariesReachable == summaries = Sections
FooterVisible == footer
RestoresState == ~badRestore
SelectedProviderOnly == visible = {provider}
SelectionOpens == ~badProvider
================================================================================
