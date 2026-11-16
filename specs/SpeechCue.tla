---- MODULE SpeechCue ----------------------------------------------------------
(******************************************************************************)
(* The text a line of narration sends to its speech model, for #101: the      *)
(* `providerText` that `SpeechService.speak` builds in                        *)
(* packages/vscode/src/speech_service.ts. A model that takes audio tags       *)
(* (`speechContextCapabilities`' `tags`) gets the programmer's accent as a    *)
(* tag, such as `[Australian accent]`, before every line, preview included;   *)
(* and the line's delivery cue, such as `[excited]`, as before #101: not in a *)
(* preview, and only with speech context on. Checked over every case: a tag  *)
(* reaches only a model that takes tags, which would otherwise read it aloud; *)
(* the accent is sent wherever it can be; the delivery rule is unchanged; the *)
(* line's own text comes last, once; and what the panel shows and what the   *)
(* context remembers is the line's text alone.                                *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    Providers,   \* the speech providers
    Models,      \* the OpenRouter models, some taking tags
    TagModels,   \* the models that take audio tags
    Accents,     \* the accents the setting offers, and NoAccent
    NoAccent,    \* the setting's default: no accent
    Deliveries,  \* a say's delivery cues, "neutral" among them
    NoDelivery   \* a say without a delivery cue

ASSUME AssumeModels == TagModels \subseteq Models
ASSUME AssumeAccents == NoAccent \in Accents

--------------------------------------------------------------------------------

\* Every line: its provider and model, the settings, its cue, and whether it is
\* a preview.
Cases == [provider : Providers, model : Models, accent : Accents,
          delivery : Deliveries \cup {NoDelivery}, preview : BOOLEAN,
          context : BOOLEAN]

\* speechContextCapabilities' tags: an OpenRouter model that takes them.
Tags(x) == x.provider = "openrouter" /\ x.model \in TagModels

\* The code: the accent's tag, then the delivery cue's, then the line.
AccentTag(x) == IF Tags(x) /\ x.accent # NoAccent THEN <<"accent">> ELSE <<>>
DeliveryTag(x) ==
    IF /\ ~x.preview
       /\ x.context
       /\ Tags(x)
       /\ x.delivery \notin {NoDelivery, "neutral"}
    THEN <<"delivery">>
    ELSE <<>>
ProviderText(x) == AccentTag(x) \o DeliveryTag(x) \o <<"text">>

\* What the panel shows, and what the context remembers: the line's `text`.
Shown(x) == <<"text">>
Remembered(x) == <<"text">>

Range(s) == {s[i] : i \in 1..Len(s)}

--------------------------------------------------------------------------------

\* A tag goes only to a model that takes tags; any other would read it aloud.
OnlyTagged(x) == Len(ProviderText(x)) > 1 => Tags(x)

\* The accent is sent wherever it can be, preview included: a code that never
\* sends it fails, so it says something must happen.
AccentSent(x) ==
    (Tags(x) /\ x.accent # NoAccent) <=> "accent" \in Range(ProviderText(x))

\* The delivery cue's rule is the one before #101.
DeliveryKept(x) ==
    ("delivery" \in Range(ProviderText(x))) <=>
        (~x.preview /\ x.context /\ Tags(x)
         /\ x.delivery \notin {NoDelivery, "neutral"})

\* The line's own text is sent last, once: tags only before it.
TextLast(x) ==
    /\ ProviderText(x)[Len(ProviderText(x))] = "text"
    /\ \A i \in 1..(Len(ProviderText(x)) - 1) : ProviderText(x)[i] # "text"

\* The panel and the context see the line's text, never a tag.
NeverShown(x) == Shown(x) = <<"text">> /\ Remembered(x) = <<"text">>

ASSUME AssumeOnlyTagged == \A x \in Cases : OnlyTagged(x)
ASSUME AssumeAccentSent == \A x \in Cases : AccentSent(x)
ASSUME AssumeDeliveryKept == \A x \in Cases : DeliveryKept(x)
ASSUME AssumeTextLast == \A x \in Cases : TextLast(x)
ASSUME AssumeNeverShown == \A x \in Cases : NeverShown(x)

================================================================================
