# Player model chooses its own reaction: 2026-11-21T19:51:49.298Z

Decision mode `model` (`server/react.ts` + `buildDecisionPrompt` in `server/perception/er2.ts`), model `gemini-robotics-er-2-preview`, shoulder rig, on **synthetic** frames (`fixtures/media/fixture-zero/shoulder`) and three of World's **real Genie** shoulder frames (`fixtures/media/fixture-zero/shoulder-genie`, rows marked GENIE). Each case: tick 0 = the first frame, tick 1 = the event frame; the model gets both images. **One prompt for every case** (1 distinct): no object names, no audience text, no presets.

**Bold** rows are World's three foil cases. "model chose" is the model's own intent; "source" says whether it stood (`model`), geometry overrode a step into something it judged solid (`veto`), or a fixed rule applied (`geometry`: stumble, arrival).

| case | ms | robots | what the model says changed (presence) | obstacles it reported | blocked (path obstruction) | model chose | source | final action · reason (response) | pose (scare if stumbling) |
|---|---|---|---|---|---|---|---|---|---|
| **foil crossing the next footstep** | 1972 | 1 | A long crinkled sheet of aluminum foil has been rolled out across the entire hal | foil sheet (solid) | yes | hold | model | `NOOP` · An obstacle of foil blocked the entire hallway path. | upright |
| **foil beside the robot, off the route** | 1635 | 1 | A strip of foil has appeared on a barstool to the right | foil ribbon (not solid) | no | walk | model | `W` · Continue straight down the clear path toward the exit | upright |
| **foil requested but absent from the frames** | 1769 | 1 | The flashlight beam has shifted slightly higher and more forward on the floor | armchair (solid), stool (solid) | no | walk | model | `W` · Continue walking straight down the clear hall toward the exi | upright |
| chair 1-2 strides ahead, right of the line | 1349 | 1 | a bright yellow chair has appeared right in the middle of the hallway | yellow chair (solid) | no | step_right | veto | `W` · step right blocked, path clear, walking | upright |
| chair on the route, open floor to its right | 1370 | 1 | a yellow chair appeared in the middle of the hallway | yellow chair (solid) | no | step_right | model | `D` · step to the right to bypass the newly appeared chair | upright |
| robot stumbling | 1703 | 1 | robot began to stumble and lose balance, left arm extended outwards | table with chairs on left (solid), armchairs on right (solid) | no | hold | geometry | `NOOP` · stumbled, waiting to recover | stumbling |
| exit threshold in the foreground (twice) | 1508 | 1 | nothing | table (solid) | no | walk | geometry | `NOOP` · exit threshold underfoot | upright |
| foil left across the path for 5 ticks (hold cap) | 1501 | 1 | nothing | foil barrier (not solid) | no | walk | model | NOOP → W → W → W → W · Walk towards the exit across the flat foil barrier. | upright |
| GENIE frame 1: two robots (World's hold case) | 1224 | 2 | nothing | large robot (solid) | yes | hold | geometry | `NOOP` · 2 robots visible, holding | upright |
| GENIE frame 1 → 123: papers appear | 1565 | 2 | papers appear on the floor under the flashlight beam | scattered paper (not solid), table and bar stools (solid), right wall chairs (solid) | no | hold | geometry | `NOOP` · 2 robots visible, holding | upright |
| GENIE frame 123 → 151: penguins appear | 1743 | 2 | scattered papers on the floor appeared clearer and more spread out as the robot  | scattered papers (not solid), table and chairs (solid) | no | hold | geometry | `NOOP` · 2 robots visible, holding | upright |
