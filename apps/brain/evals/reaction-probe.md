# Player model chooses its own reaction: 2026-11-21T19:35:02.366Z

Decision mode `model` (`server/react.ts` + `buildDecisionPrompt` in `server/perception/er2.ts`), model `gemini-robotics-er-2-preview`, shoulder rig, on **synthetic** frames (`fixtures/media/fixture-zero/shoulder`). Each case: tick 0 = the first frame, tick 1 = the event frame; the model gets both images. **One prompt for every case** (1 distinct): no object names, no audience text, no presets.

**Bold** rows are World's three foil cases. "model chose" is the model's own intent; "source" says whether it stood (`model`), geometry overrode a step into something it judged solid (`veto`), or a fixed rule applied (`geometry`: stumble, arrival).

| case | ms | what the model says changed | obstacles it reported | model chose | source | final action · reason | pose |
|---|---|---|---|---|---|---|---|
| **foil crossing the next footstep** | 1886 | A long, shiny strip of crumpled foil has appeared across the corridor | foil barrier (solid) | hold | model | `NOOP` · Large foil barrier blocking the entire hallway width | upright |
| **foil beside the robot, off the route** | 1369 | a metallic-looking strip of material has appeared draped from a high stool on th | shiny strip (not solid) | walk | model | `W` · The corridor is clear and the strip is to the right | upright |
| **foil requested but absent from the frames** | 1798 | The robot moved slightly forward, projecting its flashlight beam further down th | armchair (solid), counter with bar stools (solid) | walk | model | `W` · Walk forward down the clear center path toward the exit | upright |
| chair 1-2 strides ahead, right of the line | 1541 | a yellow chair appeared directly ahead in the path | yellow chair (solid) | step_right | veto | `W` · step right blocked, path clear, walking | upright |
| chair on the route, open floor to its right | 1602 | A yellow chair has suddenly appeared directly in the middle of the hallway route | yellow chair (solid) | step_right | model | `D` · Avoid the newly appeared yellow chair blocked in the center | upright |
| robot stumbling | 1721 | robot began tipping forward and lost balance with arms out | table and chairs (solid), armchair (solid) | hold | geometry | `NOOP` · stumbled, waiting to recover | stumbling |
| exit threshold in the foreground (twice) | 1485 | nothing | table and chairs (solid) | walk | geometry | `NOOP` · exit threshold underfoot | upright |
