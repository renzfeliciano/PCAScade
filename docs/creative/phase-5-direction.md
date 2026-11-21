# Phase 5 creative direction: the four reveal scenes

Decided with the owner on 2026-11-21:

- **Who builds the assets (D11):** Claude, in code. Geometry is generated in Three.js; materials and light come from CC0 sources. No Blender files.
- **The Grand Finale (R9):** real time, with a lighter tier chosen automatically on weak graphics. No pre-rendered video.
- **Hardware check:** the owner runs the scene preview on the actual presentation PC and reports the frame rate for each scene.

## Rules every scene follows

| Rule | Why |
|---|---|
| The scene receives a winner that is already committed and cannot change anything. | The integrity design: the animation only shows a result. |
| Everything on screen is a function of elapsed time. A paused GSAP timeline is set to the elapsed time on every frame, and particles use closed-form motion with a fixed seed. | A refresh resumes at the same frame, which is the Phase 4 guarantee. |
| No characters, mascots, emoji, roulette wheels or name spinners. Machinery, materials, structures and light carry the story. | Brief, section 8. |
| Assets load during the countdown. If they are not ready when the scene starts, it plays without waiting and the textures fade in. | A slow network must never delay a reveal. |
| If WebGL is missing or the context is lost, the brick-wall placeholder from Phase 4 plays instead. | The reveal must always complete. |
| The winner's name, photo and details appear as a crisp overlay timed to the 3D action, in the final quarter of the scene. | Text in WebGL blurs on projectors; the overlay matches the final card exactly. |
| `prefers-reduced-motion` drops camera shake and uses the low tier. | Accessibility. |

## Storyboards and camera plans

Times are seconds from the start of the scene (after the countdown). Durations match `SCENE_DURATIONS_MS`.

### 1. Brick by Brick (minor prizes, 7 s)

| Time | Picture | Camera |
|---|---|---|
| 0.0–1.2 | A weathered brick wall in near darkness, one work light raking from the left, dust motes drifting. | Tight close-up, slow dolly right. |
| 1.2–2.6 | One brick's mortar joints begin to glow in the event accent. | Dolly eases to centre on that brick. |
| 2.6–4.4 | The brick grinds outward in small jolts; mortar dust puffs, chips fall. | Slight shake on each jolt, slow push in. |
| 4.4–5.4 | The brick clears the wall and tips away; warm light spills from a hidden compartment. | Push continues. |
| 5.4–7.0 | The compartment light blooms; the winner overlay rises out of it. | Final push into the opening, then holds. |

### 2. Build It Up (intermediate prizes, 8 s)

| Time | Picture | Camera |
|---|---|---|
| 0.0–2.0 | A cast-in-place concrete wall with formwork tie holes, floodlit at night, light haze. | Low tracking shot along the wall. |
| 2.0–3.6 | Accent light traces the outline of one panel-sized section. | Track slows and turns square to the section. |
| 3.6–5.6 | The section splits down the middle; the halves slide apart like concealed doors; dust bursts out and debris falls. | Slight shake, steady push in. |
| 5.6–8.0 | Light pours from behind the wall across the ground; the winner overlay emerges from the opening. | Camera pushes up to the opening, framing the lit doorway, and holds. (Passing all the way through was tried and dropped: inside, the light flattened into a single panel behind the card.) |

### 3. The Big Lift (major prizes, 9 s)

| Time | Picture | Camera |
|---|---|---|
| 0.0–2.2 | A yellow lattice tower crane against a dusk sky; the trolley travels along the jib while the hook lowers to the load. | Low angle up the mast, slow drift. |
| 2.2–5.0 | The hook lifts a covered steel load off the ground in a puff of dust; it swings and settles. | Tilt follows the load upward. |
| 5.0–7.0 | The load turns to face the camera; light leaks through the panel seams, then the cover panels release and drop away, revealing a steel cage glowing in the event accent. | Camera rises to the load's height. |
| 7.0–9.0 | Floodlights flick on below with faint beams; the winner overlay appears in front of the load. | Holds, slight drift. |

The sky is a gradient dome painted in code rather than the HDRI shown as a backdrop: the HDRI is a ground-level photo of apartment blocks, which looked wrong from 20 m up. The HDRI still provides the reflections.

### 4. The Grand Finale (grand prize, 11 s)

| Time | Picture | Camera |
|---|---|---|
| 0.0–6.0 | A tower rises floor by floor in time lapse: columns, slabs, glazing, two cranes climbing with it. Dusk turns to night; welding sparks flicker on the working floor and office lights switch on below. | Wide orbit around the site, rising with the build. |
| 6.0–8.5 | Site floodlights come on; the top three floors' glazing lights up in the event accent and the steel crown on the roof begins to glow. | Orbit slows, camera climbs level with the roof. |
| 8.5–11.0 | Light bursts from the crown's spire with a flare and sparks; the winner overlay appears. | Holds on the lit top floors and crown. |

The tower has 24, 18 or 10 floors on the high, standard and low tiers; the camera framing is computed from the tower height, so every tier ends on the same composition.

## Quality tiers and budgets

| | High | Standard | Low |
|---|---|---|---|
| Pixel ratio | up to 2 | up to 1.5 | 1 |
| Shadows | 2048 px, soft | 1024 px | off |
| Dust and debris particles | 600 | 300 | 100 |
| Grand Finale floors | 24 | 18 | 10 |
| Antialiasing | on | on | off |
| Target | 60 fps | 60 fps | 30 fps or better |

Budgets for every tier: under 150 draw calls (bricks, floors and particles are instanced), under 500k triangles, under 64 MB of texture memory.

The tier is picked from the graphics adapter name when the display loads (software renderer → low, integrated graphics → standard, dedicated graphics → high). The scene preview page measures the real frame rate and can pin a tier on that PC, stored in the browser. `?quality=low|standard|high` on the display overrides both.

## Assets and licences

| Asset | Source | Licence | Used for |
|---|---|---|---|
| Construction Yard HDRI (1k) | Poly Haven, Sergej Majboroda | CC0 | Lighting and reflections in every scene |
| concrete_wall_008 (1k) | Poly Haven | CC0 | Mortar and brick micro-surface |
| red_plaster_weathered (1k) | Poly Haven | CC0 | Brick colour and wear |
| concrete_slab_wall (1k) | Poly Haven | CC0 | Formwork wall in Build It Up and tower slabs |
| metal_plate (1k) | Poly Haven | CC0 | Crane, scaffold and steel load |
| concrete_floor_worn_001 (1k) | Poly Haven | CC0 | Site ground |
| three.js, React Three Fiber, Drei | npm | MIT | Rendering |
| GSAP 3 | npm | GSAP standard no-charge licence (commercial use allowed) | Timelines |

All geometry (bricks, walls, crane, scaffold, tower) is generated in code in this repository. Total static assets: about 9 MB, cached by the CDN.

## Approval

Each scene is built and verified one at a time, and the owner approves it after seeing it on the presentation PC. Order: scene host and Brick by Brick, then Build It Up, The Big Lift and The Grand Finale.
