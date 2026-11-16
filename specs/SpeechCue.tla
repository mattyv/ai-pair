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
(* line's own text comes last, as the agent wrote it; and the panel shows it  *)
(* with any audio tags the agent wrote hidden, every word and code span kept, *)
(* while the context remembers it as written.                                 *)
(******************************************************************************)
EXTENDS Naturals, Sequences, PairDefs

CONSTANTS
    Providers,   \* the speech providers
    Models,      \* the OpenRouter models, some taking tags
    TagModels,   \* the models that take audio tags
    Accents,     \* the accents the setting offers, and NoAccent
    NoAccent,    \* the setting's default: no accent
    Deliveries,  \* a say's delivery cues, "neutral" among them
    NoDelivery,  \* a say without a delivery cue
    MaxText      \* the longest say text the check covers, in parts

ASSUME AssumeModels == TagModels \subseteq Models
ASSUME AssumeAccents == NoAccent \in Accents

--------------------------------------------------------------------------------

\* What a say's text is made of: words, audio tags the agent wrote (a short run
\* of letters in brackets, such as `[Australian accent]`), and code spans,
\* whose brackets are not tags.
Parts == {"word", "tag", "code"}

\* Every line: its provider and model, the settings, its cue, whether it is a
\* preview, and its text.
Cases == [provider : Providers, model : Models, accent : Accents,
          delivery : Deliveries \cup {NoDelivery}, preview : BOOLEAN,
          context : BOOLEAN, text : Seqs(Parts, MaxText)]

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
ProviderText(x) == AccentTag(x) \o DeliveryTag(x) \o x.text

\* What the panel shows: the text without the tags the agent wrote. What the
\* context remembers: the text as written.
IsTag(part) == part = "tag"
NotTag(part) == part # "tag"
Shown(x) == SelectSeq(x.text, NotTag)
Remembered(x) == x.text

Range(s) == {s[i] : i \in 1..Len(s)}

--------------------------------------------------------------------------------

\* The extension's own tags go only to a model that takes tags; any other would
\* read them aloud.
OnlyTagged(x) == Len(ProviderText(x)) > Len(x.text) => Tags(x)

\* The accent is sent wherever it can be, preview included: a code that never
\* sends it fails, so it says something must happen.
AccentSent(x) ==
    (Tags(x) /\ x.accent # NoAccent) <=> "accent" \in Range(ProviderText(x))

\* The delivery cue's rule is the one before #101.
DeliveryKept(x) ==
    ("delivery" \in Range(ProviderText(x))) <=>
        (~x.preview /\ x.context /\ Tags(x)
         /\ x.delivery \notin {NoDelivery, "neutral"})

\* The line's text is sent last, as the agent wrote it: the extension's tags
\* only before it.
TextLast(x) ==
    LET n == Len(ProviderText(x)) - Len(x.text)
    IN  /\ Len(ProviderText(x)) >= Len(x.text)
        /\ SubSeq(ProviderText(x), n + 1, Len(ProviderText(x))) = x.text
        /\ \A i \in 1..n : ProviderText(x)[i] \in {"accent", "delivery"}

\* The panel shows no tag, and every word and code span of the text, in order;
\* the context remembers the text as written.
NeverShown(x) ==
    /\ \A i \in 1..Len(Shown(x)) : ~IsTag(Shown(x)[i])
    /\ Shown(x) = SelectSeq(x.text, NotTag)
    /\ Remembered(x) = x.text

ASSUME AssumeOnlyTagged == \A x \in Cases : OnlyTagged(x)
ASSUME AssumeAccentSent == \A x \in Cases : AccentSent(x)
ASSUME AssumeDeliveryKept == \A x \in Cases : DeliveryKept(x)
ASSUME AssumeTextLast == \A x \in Cases : TextLast(x)
ASSUME AssumeNeverShown == \A x \in Cases : NeverShown(x)

================================================================================
