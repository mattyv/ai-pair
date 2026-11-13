# AI Pair Local Audio

Use the hand button to the left of Reply to request a chance to interject. The agent
finishes the current speech and safe action before handing you the floor. Press
it again while waiting to lower your hand; once the floor is yours, press it
to focus Reply. The panel shows "What's up?" and, when speech is available,
plays the same cue. Other pauses still apply.

The fixed voice prompt is generated on first use and cached in memory, without
conversation history. Relevant voice, synthesis, privacy or credential changes
invalidate it; the next use creates a new clip. Replays make no new synthesis
request. Generating a cloud clip may use account credits.

Pair narration connects relevant choices to earlier verified work; ask for a
teaching style for more concept explanations without compulsory exercises.

Optional **Speech context and delivery cues** can be enabled in Pair Settings.
For supported models, the provider receives up to three previously completed
agent utterances, bounded to 500 Unicode code points, to improve continuity.
Previous context requires OpenRouter Zero Data Retention; ordinary narration
and supported delivery cues remain available without it.
This is plain previous agent narration, not chat history; it is held only for
the current session. OpenRouter ElevenLabs v4 supports previous text and
delivery cues; v3, v3 conversational and v4 turbo support delivery cues only.
Other models use ordinary speech. This does not enable speech, change the
provider, add a microphone, or create a voice chat.
AI Pair Local Audio runs the Pair panel and speech on the local VS Code client.
Install it alongside AI Pair from the same
[GitHub release](https://github.com/mattyv/ai-pair/releases/latest), then reload
the window and reconnect the agent. In SSH, WSL, and container windows, install
this companion on the local client and AI Pair in the workspace. See the
[full guide](https://github.com/mattyv/ai-pair#readme) for setup and limitations.

The companion stores the ElevenLabs and OpenRouter keys locally through secure
VS Code prompts; saving a key does not enable speech. Cloud narration and
previews use account credits. OpenRouter models and advertised voices come from
the account, and a listed model can reject a selected format or voice. Its ZDR
filter requests ZDR routing, subject to account Safety Retention settings.
Keys and generated audio are not sent to the workspace extension.

Kokoro uses a pinned local model and requires a Linux x64 desktop with glibc
in the companion. GPU support is experimental with limited hardware testing.
On a Mac, local main-extension Kokoro can be used without the companion;
remote speech requires the companion. Cross-platform playback does not make
Kokoro available on every platform. Linux playback requires `pw-play`,
`pw-dump`, and `setpriv`; macOS and Windows playback helpers ship with it.

**Listening speed** adjusts local playback separately from synthesis speed;
rates other than 1 remain experimental. Agents can use `speech_mode: "continue"`
for narration over subsequent work; default `"wait"` finishes speech first.
The panel offers **Allow all for session** for commands and **Require command
approval** to clear grants. Speech readiness does not prove audible output.

The guided Pair demo includes the hand control and its fixed voice prompt,
using your current speech settings. It cleans up verified demo files after
completion; uncertain files or work you ask to keep are retained. If cleanup
cannot run, the demo reports the retained paths.
