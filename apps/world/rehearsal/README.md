# Hallway rehearsal

## On a teammate’s laptop

Use Node.js 22.12 or newer with npm. Run these commands from the checkout root.

```sh
npm run rehearsal:setup
npm run rehearsal
```

Setup installs the locked Crowd and Brain dependencies. Run it once per checkout and again when either lane changes its lockfile. The server prints three local links.

1. Open [Host](http://127.0.0.1:8914/team). Choose **Rehearse offline** to start the 30-second audience opening.
2. Open [Audience](http://127.0.0.1:8914/haunt) in another tab. Submit “A gust blows loose papers across the aisle” or choose a preset. The phone displays an assigned ghost name and a private receipt.
3. Open [Projector](http://127.0.0.1:8914/stage). Open **Queue** to see the proposal. After play begins, Crowd dispatches the approved idea, Brain reacts to the hallway frames, and World resolves the round.

This checkout runs the three lanes together on one loopback server. Offline play uses Courtney’s rules-based moderation, Sri’s fixture perception and navigation, and Kevin’s local renderer. It runs on CPU without a Gemini key. Each laptop starts its own round. To share one round on a projector, open all three links against the same running host. Stop the local server with **Ctrl+C**.

Set `PG_STAGE_PORT` to use a different local port. Set `PG_VENUE_PHOTO` to show a local JPEG in the venue opening. The included sample is an empty version of the venue. In **Host** you can also capture or choose a new photo. A newly selected photo receives a local preview during an offline rehearsal.

## On Kevin’s live World host

Use the same setup above. Install the capture package once on the World laptop.

```sh
npx --yes pnpm@9.15.9 --dir apps/world/painted-door install --frozen-lockfile --ignore-workspace
npm run rehearsal:world
```

The live host uses its private root `.env` with `GEMINI_API_KEY`. If the capture package and credentials already live in another checkout, set `PG_CAPTURE_DIR` to that checkout’s absolute `apps/world/painted-door` directory. Keep the key on that laptop.

Open **Host**, capture or choose the hallway photo, and select **Prepare photo for Genie**. This sends the selected photo to Gemini to build the angled room. **Start Genie round** opens one paid world interaction. The projector shows the complete stream from that interaction. A new run uses the same robot reference. Gemini Robotics ER 2 observes the floor and obstacles from pixels, and Brain chooses the next input. A haunting can pause the robot or request a flinch. Fear increases only after World observes the reaction.

The host serves on loopback. Any event deployment or audience gateway should expose Courtney’s audience route separately from the host controls.
