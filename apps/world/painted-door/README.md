# The painted exit

[Open the replay](replay/index.html) locally or play the [nine-second clip](replay/painted-door.mp4). **Compare angles** shows the last frame before movement and the view after the sidestep. The replay works offline when opened from a local checkout. To serve it locally with chapter seeking, run `pnpm dlx http-server replay -a 127.0.0.1` from this directory.

In one completed Genie 4 session, the left wall started blank. At one second we asked for a red door painted onto the plaster. At six seconds we held D for one second. The red outline and handle stayed on the wall through the sidestep. The real green door retained a visibly recessed frame. This was a scripted camera test. The player's choice is the next experiment.

## Repeat the capture

From this directory, with Node 22+, pnpm, and the World laptop’s ignored root `.env` configured:

```sh
pnpm install --frozen-lockfile
PG_ALLOW_GENIE=1 pnpm capture --live
```

Each invocation opens one paid session. The script requests completion after 216 video frames and waits for confirmation. A timeout or interruption triggers cancellation. Raw frames and the control timeline are saved to a new directory under `runs/`. The included replay is from the first run.
