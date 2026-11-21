# Poltergeist

“Gemini is trying to escape this room. You’re the ghost. What do you change?”

A game for the Gemini 4 NYC Hackathon. A player changes the room, Gemini investigates through its character’s camera, and the audience watches it choose an exit.

Start with the [feature map](FEATURES.md) and [lane assignments](KICKOFF.md#team-assignments). Share blockers and ready fixtures in the [lane handoffs issue](https://github.com/HydroAcrid/poltergeist/issues/2). The [review workflow kit](docs/workflows/README.md) is available for anyone who wants to try Kevin’s checks in Claude Code.

[Watch the first painted-door test](apps/world/painted-door/replay/painted-door.mp4) · [Open the replay locally](apps/world/painted-door/README.md)

## First playable round

1. Start in a hallway with one working door. Let the host add a painted door with a flickering EXIT sign.
2. Give Gemini its camera view and movement controls. Keep the player’s prompt and the identity of the real exit out of its input.
3. Show the audience Gemini’s view as it approaches a door, looks from the side, or tries the handle.
4. Replay the action that decided the round. Let someone suggest a new trick for the rematch.

## First prototype question

Does the painted door stay painted as the camera moves? Record a round from two angles. If the room holds together and the audience can see what Gemini learned by moving, build the phone input next.
