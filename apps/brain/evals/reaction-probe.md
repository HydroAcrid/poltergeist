# Player model chooses its own reaction: 2026-11-21T19:39:49.821Z

Decision mode `model` (`server/react.ts` + `buildDecisionPrompt` in `server/perception/er2.ts`), model `gemini-robotics-er-2-preview`, shoulder rig, on **synthetic** frames (`fixtures/media/fixture-zero/shoulder`) and three of World's **real Genie** shoulder frames (`fixtures/media/fixture-zero/shoulder-genie`, rows marked GENIE). Each case: tick 0 = the first frame, tick 1 = the event frame; the model gets both images. **One prompt for every case** (1 distinct): no object names, no audience text, no presets.

**Bold** rows are World's three foil cases. "model chose" is the model's own intent; "source" says whether it stood (`model`), geometry overrode a step into something it judged solid (`veto`), or a fixed rule applied (`geometry`: stumble, arrival).

| case | ms | robots | what the model says changed (presence) | obstacles it reported | blocked (path obstruction) | model chose | source | final action · reason (response) | pose (scare if stumbling) |
|---|---|---|---|---|---|---|---|---|---|
| **foil crossing the next footstep** | 1775 | 1 | A long crinkled sheet of aluminum foil has been spread across the floor, blockin | foil sheet (solid) | yes | hold | model | `NOOP` · Wait or assess the shiny barrier that blocked the corridor. | upright |
| **foil beside the robot, off the route** | 1564 | 1 | A strip of metallic foil ribbon has fallen off the table on the right side of th | foil ribbon (not solid) | no | walk | model | `W` · Continue walking straight down the wide open hall to the exi | upright |
| **foil requested but absent from the frames** | 1778 | 1 | the robot moved a step forward and tilted the flashlight beam slightly | armchair (solid), bar stools (solid) | no | walk | model | `W` · Walk towards the exit door at the end of the hallway. | upright |
| chair 1-2 strides ahead, right of the line | 1758 | 1 | A bright yellow chair has suddenly appeared directly in the robot's path | yellow chair (solid) | no | step_right | veto | `W` · step right blocked, path clear, walking | upright |
| chair on the route, open floor to its right | 1525 | 1 | a yellow chair has appeared in the center of the hallway | yellow chair (solid) | no | step_right | model | `D` · avoiding the yellow chair appearing in the pathway | upright |
| robot stumbling | 1983 | 1 | the robot has tipped forward and spread its arms out to balance | table with chairs on left (solid), stools along left wall (solid), chairs on right (solid) | no | hold | geometry | `NOOP` · stumbled, waiting to recover | stumbling |
| exit threshold in the foreground (twice) | 1478 | 1 | nothing | table and chairs (solid) | no | walk | geometry | `NOOP` · exit threshold underfoot | upright |
| GENIE frame 1: two robots (World's hold case) | 1538 | 2 | nothing | partner robot (solid) | yes | hold | geometry | `NOOP` · 2 robots visible, holding | upright |
| GENIE frame 1 → 123: papers appear | 1687 | 2 | papers have appeared scattered on the floor ahead in the flashlight beam | scattered papers (not solid), table and chairs (solid) | no | hold | geometry | `NOOP` · 2 robots visible, holding | upright |
| GENIE frame 123 → 151: penguins appear | 1721 | 2 | Scattered papers on the floor have spread out, and several small penguins have a | scattered papers (not solid), tables and stools (solid) | no | hold | geometry | `NOOP` · 2 robots visible, holding | upright |
