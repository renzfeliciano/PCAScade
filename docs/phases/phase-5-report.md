# Phase 5 report (2026-11-22): reveal scenes and sound

The storyboards, camera plans, tier budgets, asset licences and sound cues are in [the creative direction](../creative/phase-5-direction.md). This report covers what was built, how it was checked, and what is still open.

## Built

| Area | What exists |
|---|---|
| Scene host | `RevealScene` loads the 3D stage lazily and shows the Phase 4 placeholder until it is ready. The countdown now plays over the scene's first frame, so textures and code load during the countdown, and the 3D code starts loading as soon as the display shows "drawing". Every frame is a pure function of the server's reveal time (a paused GSAP timeline set to the elapsed time, particles in closed form with fixed seeds), so a refresh resumes at the same moment. `StageClock` smooths between the once-a-second server updates, never steps backwards on jitter, jumps on a refresh-sized correction and holds still while frozen. |
| Fallbacks | No WebGL, a lost WebGL context, an error inside a scene, or a software renderer (in automatic mode) all fall back to the placeholder reveal, so a reveal always completes. |
| Quality tiers | High, standard and low (pixel ratio, shadows, particle count, Grand Finale floor count, antialiasing), picked from the graphics adapter name. A tier can be pinned per PC, and `?quality=` on the display overrides both. Reduced motion uses the low tier and drops camera shake. |
| Winner overlay | The winner card fades in over a dark backdrop at a set point in each scene, as crisp HTML rather than text in WebGL. |
| Brick by Brick (7 s) | A brick wall under a work light; one brick's joints glow in the event accent, it grinds out in three jolts with dust and chips, drops away, and the camera pushes into the lit cavity. |
| Build It Up (8 s) | A floodlit cast-concrete wall at night; accent light traces a doorway-sized section, the seam cracks, the halves slide into the wall like hidden doors, debris falls and light spills across the ground. |
| The Big Lift (9 s) | A lattice tower crane at dusk; the hook lifts a covered steel load, it swings and settles, turns to the camera, the cover panels drop away to show a glowing steel cage, and floodlights come on. |
| The Grand Finale (11 s) | A tower rises floor by floor in time lapse with two climbing cranes while dusk turns to night; floodlights come on, the top floors and the steel crown light up in the accent, and light bursts from the spire. 24, 18 or 10 floors by tier; the camera framing is computed from the tower height. |
| Sound | Synthesised in the browser with the Web Audio API, no audio files: countdown ticks and cues for every scene timed to the picture, ending on a chord as the winner appears. It follows the same server clock as the picture: after a refresh only the remaining cues play. A "Turn sound on" button sits next to "Enter full screen"; the choice is remembered per PC, and after a reload any click or key press resumes it. |
| Scene preview | `/admin/animations`: pick a scene, quality and accent colour, play or pause at any moment, turn sound on, read a live FPS counter with the detected graphics adapter, and pin a tier on that PC. |
| Assets | Five 1k PBR texture sets and one 1k HDRI from Poly Haven (CC0), 8.9 MB in `public/scenes`. All geometry is generated in code. New dependencies: three 0.187.0, @react-three/fiber 9.8.2, @react-three/drei 10.7.9, gsap 3.15.1. |

## Verified

| Check | Result |
|---|---|
| Automated tests | 205 passing (9 new): stage clock (frozen during the countdown, projection without stepping back, refresh-sized jumps, paused frame), quality tiers (adapter names to tiers, software renderers, budgets in order), and sound timing (future cues scheduled, past cues skipped, long sounds resumed part way through, late countdown ticks, cues within each scene's length). |
| Browser tests | `npm run test:e2e`, 2 of 2, after every scene. The headless browser uses a software renderer, so these runs exercise the placeholder fallback path. |
| Frame by frame | Every scene was paused and screenshotted repeatedly in a GPU browser and corrected until each beat read clearly; the main fixes are listed below. Each final frame was checked with the winner card on top. |
| Frame rate (this laptop, Intel Iris Xe) | A steady 60 fps on every scene at standard quality, and on the Grand Finale at high quality (24 floors) as well. |
| Sound | Scheduling checked by counting the oscillators and noise sources each cue list starts and when: every scene queues its full set from the start, the last cue lands on its chord, Restart replays from the beginning, and on the live presentation flow (three reveals on the local test database) the timing follows the server clock, any click resumes sound, and resuming mid-countdown plays only the remaining ticks and the whole scene. Nobody has listened to it yet: the sounds themselves are unreviewed. |
| Production build, type check, lint | Clean. |
| Dependency audit | Production 0. The 4 moderate dev-only `minimatch` findings via the shadcn CLI remain (carried from Phase 4). |

Not done this phase: mutation checks. The scenes are visual and were checked by eye; the logic around them (clock, tiers, sound planning) is covered by the unit tests above.

## Problems found and fixed during this phase

1. **Brick by Brick ran at 5 fps with the wall missing.** The texture helper returned a new object on every render, so the material was rebuilt and the instanced wall recreated about ten times a second. Memoised, textures configured once, canvas settings hoisted: about 60 fps.
2. **Unreadable winner name** over a glaring cavity in the first Brick by Brick. Darker cavity, toned-down light, and a backdrop behind the card in every scene.
3. **Headless browsers stalled on WebGL** (software rendering), timing out the e2e tests. The 3D stage now loads lazily behind the placeholder, and software renderers get the placeholder in automatic mode.
4. **Build It Up:** the wall was lit too flatly, the ground was black (a dark floor texture darkened again by its tint), the chamber read as a flat yellow block, and the debris was too big. Floodlights moved onto masts, the chamber became a deep room with a soft glowing core, the debris was shrunk, and the final camera now stops outside the opening instead of passing through it.
5. **The Big Lift:** the site HDRI shown as the sky was a ground-level photo of apartment blocks, wrong from 20 m up. It was replaced with a dusk gradient sky painted in code, and the HDRI is kept for reflections only. The load's faces rendered black at dusk (hemisphere light in three.js is divided by π), so the cover became painted steel with a brighter fill light; the open bottom got a floor plate; the floodlight beams fade out instead of ending in hard rims.
6. **The Grand Finale** first ended right up at the crown, so the accent-lit floors never showed. The camera now pulls back to frame the top floors, the crown and the burst together, and the crown's base colour was darkened so the accent reads.
7. **Sound: clicking "Click to resume sound" turned sound off.** The page-wide resume listener switched it on first and the button's own click then toggled it off. The listener now ignores clicks on the button.
8. **Sound in the preview** was scheduled from the old position after Restart or a scene change. Both now reset the clock and loop count together.
9. **The first countdown tick never played**, because the display learns of a reveal on its next poll. Countdown ticks may now play up to 0.9 s late, which matches when the number first appears.
10. The admin hints for Brick by Brick and Build It Up described ideas that were not built ("bricks stack up", "scaffolding rises"). Rewritten to match the scenes.

## Decisions taken

- Scenes are built in code with CC0 materials (D11) and the Grand Finale runs in real time with a lighter tier chosen automatically (R9), as agreed at the start of the phase.
- In automatic mode a software renderer gets the placeholder rather than a slow 3D scene. Pinning a tier or `?quality=` still forces WebGL.
- Two storyboard changes, recorded in the creative direction: Build It Up's camera stops at the opening, and The Big Lift uses a painted dusk sky instead of the HDRI backdrop.
- Sound is off until someone turns it on, per display PC, because browsers require a click before playing sound and an unexpected sound in a hall is worse than none.

## Still open

- **Owner review on the presentation PC**, which is the exit criterion for this phase: the FPS shown at automatic quality for each scene, approval or changes for each look, and a first listen to the sound. If any scene runs under 60 fps there, pin a lower tier and report which one stays smooth.
- An unexplained single test failure in one of six full-suite runs early in the phase. It was not captured and has not come back in any full run since.
- Should "winner absent" exclude that person from every remaining prize? (Carried from Phase 3. Current behaviour: same prize only.)

## Deploy note

No migration this phase. All five commits are on `main`: `79d91eb`, `5da8ec7`, `c7a9b42`, `9f3803d` and `6a33a74`.

## Carry-overs

| Item | When |
|---|---|
| Line-up and winner wall layouts for many prizes (paging or auto-scroll on a TV). Planned for this phase and not done. | Phase 7 |
| Photos orphaned by update imports | Phase 7 |
| Any changes from the owner's review of the scenes and sound | Before Phase 6 sign-off |
