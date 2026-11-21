# Hallway stage

The projector opens at `/stage`, host controls at `/team`, and private audience submissions at `/phone`. The host can use the venue photo, select another image, or capture one with the local camera. During the first 30 seconds the photo and robot entrance play while Crowd accepts ideas. With the venue photo, the opening uses the extended, art-directed version of that same hallway. A new photo gets an in-browser camera move, theatrical lighting and the shared robot cutout. Genie receives that composition when the host starts a live round. The opening sequence itself is rendered locally.

For the combined rehearsal checkout, install the Crowd and Brain branches and their dependencies alongside World. Run this from the combined checkout root:

```sh
apps/crowd/node_modules/.bin/vite-node -c apps/crowd/vitest.config.ts apps/world/rehearsal/lane-host.ts
```

The local server binds to loopback on port 8914. Set `PG_VENUE_PHOTO` to a local JPEG to show the original shot in the introduction. The offline round uses the fixture Brain service at `PG_BRAIN_URL`, defaulting to `http://127.0.0.1:8903/api/brain/tick`. The three-bay route takes about 45 seconds of walking and ends after 72 seconds if the robot is delayed. Rehearsal fear increases once per distinct flinch, and three flinches end the round. A clean sidestep earns zero.

For a paid round, set `PG_ALLOW_GENIE=1` and `PG_CAPTURE_DIR` to the absolute path to World’s `apps/world/painted-door` directory, with its dependencies installed and the project’s local Gemini credentials configured. The **Start Genie round** control opens one Genie 4 interaction after the opening. The projector switches to streamed Genie frames. Gemini Robotics ER 2 locates the robot’s feet, obstacles and exit from the unannotated camera frame. Brain’s navigation function chooses the input. Crowd’s moderated dispatch enters the same interaction. Submitting a prompt or sending it to Genie cannot score fear. Live fear needs a seen matching obstacle and an observed transition to stumbling. The live round defaults to 45 seconds; uploads and offline rehearsals use no model calls.

The throwaway room identities here are for the local rehearsal. Crowd owns the production phone, naming rules, and conductor. Queue order currently follows the Crowd scheduler. Teammate phones need a shared host URL for the actual event.
