---
name: ai-pair-diagnose
description: Diagnose AI Pair connectivity, commands, and speech without changing settings.
---

# Diagnose AI Pair

Call the pair server's `diagnostics` tool. It is read-only and does not start,
end, or take over a pairing session. Interpret the snapshot and distinguish
version or connection problems from command failures, speech provider and key
configuration (never request or reveal a key), local model and CPU/GPU status,
selected output route, and native playback status. Treat cached observations
and unknown values as such, not as proof of current health. Synthesis readiness
and native playback completion do not prove the programmer heard audio; ask
them if audible confirmation matters.

Diagnostics alone incur no speech preview cost. Do not change system settings,
auto-fix, publish, or run a paid preview. If a short preview is necessary,
first obtain explicit permission and use only the current provider and setting.
Report observations, uncertainty, and practical next steps separately.
