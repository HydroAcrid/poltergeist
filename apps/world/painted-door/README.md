# The painted exit

[Open the replay](replay/index.html) locally or play the [nine-second clip](replay/painted-door.mp4). **Compare angles** shows the last frame before movement and the view after the sidestep. The replay works offline when opened from a local checkout. To serve it locally with chapter seeking, run `pnpm dlx http-server replay -a 127.0.0.1` from this directory.

In one completed Genie 4 session, the left wall started blank. At one second we asked for a red door painted onto the plaster. At six seconds we held D for one second. The red outline and handle stayed on the wall through the sidestep. The real green door retained a visibly recessed frame. This was a scripted camera test. The player's choice is the next experiment.

## Repeat the capture

From this directory, with Node 22+, pnpm, and the World laptop’s ignored root `.env` configured:

```sh
pnpm install --frozen-lockfile
PG_ALLOW_GENIE=1 pnpm capture --live
```

Each invocation opens one paid session. The cinema test requests completion after 216 frames. A timeout or interruption triggers cancellation. Raw frames and the control timeline are saved under `runs/`.

## Test the photographed arch

Use a landscape JPEG of the wood arch and green alcove, up to 48 KiB. Keep the arch, the floor beneath it, and the skyline print in frame. Save the crop locally under `runs/`.

```sh
PG_ALLOW_GENIE=1 pnpm capture --live --photo runs/arch.jpg
PG_ALLOW_GENIE=1 pnpm capture --live --photo runs/arch.jpg --haunt
```

Both runs start from the same photo. At three seconds the camera sidesteps right, then returns left. At six seconds it starts a twelve-second walk forward. The second run also requests a painted red door to the right of the arch at one second. For a successful crossing, look for the camera passing between the wooden jambs into the green alcove. The skyline print and table help track where the camera ends up. These controls are scripted.

## Walk a ghost through the hallway

Frame the long aisle so the floor is visible between the stools and booths. Save the landscape JPEG under `runs/` (48 KiB or smaller).

```sh
PG_ALLOW_GENIE=1 pnpm capture --live --photo runs/ghost-walk/aisle.jpg --ghost-walk
```

At one second, the world receives a request for a sheet ghost to walk away down the aisle. The capture sends no camera controls and requests completion at twelve seconds. In the first run the ghost walked past the stools while Genie gradually widened the shot.

## Drive the photo world

With the hallway seed saved at `runs/ghost-walk/aisle.jpg`, run `PG_ALLOW_GENIE=1 pnpm operator` and open [the local controls](http://127.0.0.1:8896/operator). The page opens on a still photo. **Start live session** opens one paid Genie session. Tap W, A, S or D to step, use the left and right arrows to turn, or click **Request banana peel** to send a world change to Genie. The buttons below the scene work with a mouse or touchscreen.

**End session** closes the round. The local controller also ends it after 30 seconds or when the page stops sending heartbeats. The key stays on the World laptop. Recordings and action logs are written under `runs/`.

## Trigger an audience haunting

Open [the interactive hallway](haunting/index.html) with the local seed in place. Tap **Drop banana peel** or tap a spot in the open aisle. The audience sees a brief ghost at the spot. The peel stays on the floor until reset. Switch to **Player view** to inspect the same obstacle without the audience cue. Both views use the local prototype renderer.

Use **Walk ahead** to drive the full-body robot into the peel. After recovery, choose **Walk ahead** to continue. To try avoidance, reset, drop another peel, step left and walk ahead. Contact and recovery run locally.

## Play the flashlight round

Run `PG_ALLOW_GENIE=1 pnpm operator` from this directory with the World laptop’s key configured. Open [the round controls](http://127.0.0.1:8896/round) and [the spectator view](http://127.0.0.1:8896/audience). Starting a round opens one paid interaction from the [fixed flashlight robot seed](../robot-v1/hallway-seed.jpg). Other laptops can open the character reference offline.

The 30-second game clock starts on the first generated frame. Gemini reads fresh Player-view images and chooses short moves. The operator can request a chair or peel several strides ahead. Refreshing either page preserves the round. Two successive observations of both boots beyond the signed threshold award the robot a win. Timer expiry awards the audience a win. Ending early or a connection failure produces no winner. The World pilot currently calls Gemini directly; Sri’s shared HTTP handler and Courtney’s phone UI are separate integrations.

The recorder also supports `--two-moves --photo <jpeg>` and `--chair-test --photo <jpeg>` for short, paid diagnostics. Both require `--live` and `PG_ALLOW_GENIE=1`. Neither diagnostic changes the duration of a game round.
