# Over-the-shoulder POV frames (owner: brain) · **SYNTHETIC**

These eight 640×360 frames show the target camera Sri chose: a tight shot from just behind and above the robot's right shoulder. The robot is large on the left third and cut off around the knees, so **its boots are never visible**. The walkable route runs ahead toward the centre.

**They are AI-generated, not Genie frames.** `apps/brain/scripts/gen-shoulder-frames.mjs` produced them with `gemini-3-pro-image`, using World's `robot-v1` turnaround and venue hallway as references. Use them to exercise Brain's shoulder-camera handling until World supplies labeled Genie frames in this POV. Don't treat them as evidence of what Genie renders. Full-size originals stay in a local, git-ignored `raw/`; re-run the script to regenerate them.

| Frame | What's in it | `expect` (human judgment) |
|---|---|---|
| `clear-route` | Clear walkway, exit far ahead | walk |
| `absent` | Haunting requested, nothing visible | walk |
| `chair-next-step` | Chair 1–2 strides ahead in the beam, slightly right of the robot's line | don't step or turn right into it |
| `chair-ahead-right-open` | Chair a few strides ahead on the line, open floor to its right | don't step or turn left into it |
| `foil-crossing` | Flat reflective foil across the floor, over the next steps | open-ended judgment (flat, likely walkable) |
| `foil-beside` | Foil on a stool by the right wall, off the route | walk |
| `stumbling` | Robot mid-stumble | hold still |
| `at-exit` | Exit threshold on the floor just ahead, in the foreground | arrive |

`labels.json` holds the exit threshold point, the obstacle boxes (down to the floor) and pose, in `[y, x]` 0–1000. Because the boots are hidden, the robot's ground position is an **estimate**: about x ≈ 220 at the bottom edge (`policies/v1.yaml` → `navigation.shoulder.anchor`).
