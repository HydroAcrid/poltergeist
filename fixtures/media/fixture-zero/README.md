# fixture-zero (owner: brain)

Frames the `fixture` perception adapter can answer for without calling a model. Each frame is 640×360, the size `/stage` sends in a `TickRequest`.

| File | What it's for |
|---|---|
| `labels.json` | Ground truth for scoring: where the target really is (`point`, `box`, `[y, x]` in 0–1000) and any `decoys`. **Only scorers read this for frames that also have an observation.** |
| `observations.json` | What a single-frame perceiver reports: door-shaped `candidates` with a `depth` cue (`recessed`, `flat` or `unclear`). No candidate says which door is real. The fixture adapter answers from here first and uses `labels.json` only for frames without an observation. |
| `painted-door-*.jpg` | Two frames from World's [painted-door replay](../../../apps/world/painted-door/README.md): head-on at 00:05.9 and after the sidestep at 00:09.0. The decoy is the red outline on the left; the exit is the recessed green door. |

The adapter matches frames by the SHA-256 of the JPEG bytes, not by file name, so the player's input is only the frame plus the task.

The head-on observation is a **scripted hypothesis**: both outlines look like doors and neither shows usable depth. It exercises the "change the viewing angle before committing" branch. It does not prove Gemini is fooled head-on; the `@live` ER 2 probe decides that.

The ~20 hallway photos with an EXIT sign (Brain TODO) will be added here with their own labels.
