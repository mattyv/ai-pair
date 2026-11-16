---- MODULE VoiceLanguage ------------------------------------------------------
(******************************************************************************)
(* The language an OpenRouter voice's label names, for #100: `voiceLanguage`  *)
(* and `voiceLabel` in packages/vscode/src/voice_language.ts. A voice is the  *)
(* model it belongs to and its ID; the code reads the ID only by its model's  *)
(* provider's scheme (a locale in the ID, a prefix letter, a speaker, a       *)
(* suffix), and looks the part it reads up in that provider's documented      *)
(* table. Checked over every voice of the small model below: a label names a  *)
(* language only where the voice's own provider documents it, and then the    *)
(* documented one; every documented voice is named; and the ID is always in   *)
(* the label, since it is what is stored and sent.                            *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    Providers,  \* the providers whose models list voices, documented or not
    Forms,      \* the shapes a voice ID can take
    Keys,       \* the part of an ID a scheme reads: a prefix, speaker, locale
    Languages,  \* the language tags a table can give
    None        \* no language: the voice keeps its bare ID

ASSUME AssumeNone == None \notin Languages

--------------------------------------------------------------------------------

\* Each documented provider's scheme: the one form of ID its docs explain.
Scheme == [p \in {"mai", "kokoro", "voxtral", "deepgram"} |->
              CASE p = "mai" -> "locale"
                [] p = "kokoro" -> "prefix"
                [] p = "voxtral" -> "speaker"
                [] p = "deepgram" -> "suffix"]

\* What each provider's docs say a key means, for the keys this model uses: a
\* provider documents some keys and not others.
Documented == {<<"mai", "k1">>, <<"kokoro", "k1">>, <<"kokoro", "k2">>,
               <<"voxtral", "k2">>, <<"deepgram", "k1">>}
Table == [d \in Documented |->
             CASE d = <<"kokoro", "k2">> -> "l2"
               [] d = <<"voxtral", "k2">> -> "l2"
               [] OTHER -> "l1"]

\* Every voice: a provider's model, and an ID of any form and key.
Voices == [provider : Providers, form : Forms, key : Keys]

\* The code: the voice's own provider's scheme, if it has one and the ID has
\* its form, then that provider's table.
Language(v) ==
    IF /\ v.provider \in DOMAIN Scheme
       /\ v.form = Scheme[v.provider]
       /\ <<v.provider, v.key>> \in Documented
    THEN Table[<<v.provider, v.key>>]
    ELSE None

\* The label: the ID, then the language when there is one.
Label(v) == IF Language(v) = None THEN <<v>> ELSE <<v, Language(v)>>

--------------------------------------------------------------------------------

\* A language only where the voice's own provider documents its form and key,
\* and then the one documented.
NoGuess(v) ==
    Language(v) # None =>
        /\ v.provider \in DOMAIN Scheme
        /\ v.form = Scheme[v.provider]
        /\ <<v.provider, v.key>> \in Documented
        /\ Language(v) = Table[<<v.provider, v.key>>]

\* Every voice its provider documents is named: a code that names nothing
\* fails it, so it says something must happen.
Named(v) ==
    (/\ v.provider \in DOMAIN Scheme
     /\ v.form = Scheme[v.provider]
     /\ <<v.provider, v.key>> \in Documented) => Language(v) # None

\* The ID is always the label's first part, so the voice stays recognizable.
KeepsId(v) == Label(v)[1] = v

ASSUME AssumeNoGuess == \A v \in Voices : NoGuess(v)
ASSUME AssumeNamed == \A v \in Voices : Named(v)
ASSUME AssumeKeepsId == \A v \in Voices : KeepsId(v)

================================================================================
