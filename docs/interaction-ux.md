# Exploration and visible work

Question defaults to `explore`: inspect the page, navigate relevant material and use the harness's native history/memory/file search. Existing custom mappings are preserved. Select **Observe only** in Signals when no desktop navigation is wanted. Wards and setup tests force observation regardless of the Question mapping.

The project gate allows exploration scrolls, navigation keys and left clicks with a stated navigation purpose. It rejects typing, arbitrary shortcuts and window changes. A purpose string does not prove a click harmless: the agent must identify navigation controls from fresh evidence and avoid submissions or edits. Explicit work uses Assist/All in. Existing interruption, target identity and stale-coordinate checks still apply.

Repeated signals are contextual expression, not multiplied authority. Same signal/harness/generation within three seconds and 48 logical pixels can join an active request only when window identity matches. Different windows, remote/agent events, timer visits and execution mappings are not grouped. Claude's existing steering is delivered after the current result, so immediate mid-turn reactions are not promised there.

Emotional requests locate the ping target without taking a screenshot when the native locator is available. They do not enable desktop actions. The skill encourages short expressive counter-emotes and contextual humor; banter-off remains respected. An emotional question reply is not marked as a pending clarification.

## Visible context and progress

Conversation rows store the first captured region's file reference/time/map, while the active task shows the agent's latest screenshot separately. Queued requests capture when admitted, so the displayed time is capture time, not necessarily ping time. Recent images live only in the private captures directory (bounded to 100); expired images show an explicit placeholder. The renderer receives images through authenticated local IPC with a recorded-name allowlist and resolved-path containment, never an arbitrary file URL. No screenshot bytes enter the conversation JSON or source repository.

Replies render Markdown/GFM, fenced code and KaTeX math. Raw HTML is skipped, remote images do not load, trusted math commands are disabled, and web links open only on user click. Code is displayed, never executed. The floating card shows a generated work emote while a non-emotional desktop task is active, elapsed time and streamed public output. It stays until dismissed/completed, never focuses itself, and offers Retreat. No fake progress percentage or private reasoning is displayed. Reduced-motion settings disable the decorative breathing animation.

## Working emote provenance

`src/renderer/assets/working.png` was generated with the built-in imagegen tool, using a transparent background, on 2026-10-16. It is a status illustration, not a replacement for the user's LoL signal/audio pack.

Prompt: “Use case: stylized-concept. Asset type: a single compact transparent desktop working-status emote for LOLPingYourAI. Draw a charming, intensely focused little fantasy AI teammate studying and typing on a small laptop, determined expressive face, tiny magical spark above its head, playful game-emote illustration with bold clean silhouette, readable at 64px. Square composition, entire character and laptop inside the frame, polished shaded sticker illustration, no letters, no words, no watermark, transparent background. This is a persistent 'working on your request' indicator, so convey concentration rather than completion or panic.”

## Verification cases

Automated service cases cover navigation versus mutation, forced read-only wards, repeated questions versus different windows, emotion-only reactions, initial/latest capture separation and stale-context cancellation. Preview tests cover arbitrary paths, unknown files, expiration and symlink escape. Electron fixtures exercise rendered math/code, screenshot preview and working state. Record the actual run results and real harness limitations in release notes; prompt quality cannot be proved by protocol mocks alone.
