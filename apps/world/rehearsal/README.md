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

## Choose a show format

**5-minute buffered live game** uses the room photo and freshly moderated crowd ideas. New guests can join while World generates. The host groups up to two ideas per segment. The projector opens after two complete scenes are available, then World replenishes the buffer during playback. If the opening scene already contains a verified game finish, it can play through to that result. Each new Genie session starts from the preceding segment’s final native JPEG. The lights flicker at the cut. The next scene opens on the preceding native image and must match the room and framing across its first second before it enters the playback queue. If generation falls behind, the screen says the next scene is developing. The host report includes opening delay, time spent generating, playable duration and gaps. This mode uses paid generation and requires FFmpeg with libx264 on the live host. Set `PG_FFMPEG_PATH` if the executable is outside the system path.

**5-minute audience screening** uses previously recorded venue scenes and a live audience queue. Use the venue photo. Guests can choose filmed encounters that show both the haunting and the explorer’s visible response. The projector plays the full encounter at its original speed. The host can start a screening once a verified encounter is available. The phone offers available filmed alternatives for other ideas. This format needs no Genie session. Uploaded photos can be used with the buffered or direct live formats.

## On Kevin’s live World host

Use the same setup above. Install the capture package once on the World laptop.

```sh
npx --yes pnpm@9.15.9 --dir apps/world/painted-door install --frozen-lockfile --ignore-workspace
npm run rehearsal:world
```

The live host uses its private root `.env` with `GEMINI_API_KEY`. To use the current checkout’s camera with a key stored elsewhere, set `PG_WORLD_ENV_FILE` to the absolute path of the World host’s private environment file. `PG_CAPTURE_DIR` overrides the capture package itself. Keep the key on that laptop.

Open **Host** and capture or choose the hallway photo. World opens the lobby and sends the selected photo to Gemini to prepare the right-shoulder view. Guests can submit while it prepares. The host can retry preparation if it fails. Choose **5-minute demo** or **10 minutes of play** and press the matching Start button when the room is ready. **Host tools** contains the separate camera test and the offline rehearsal. An open photo lobby skips the second countdown. The public lobby phase and photo status are available at `GET /rehearsal/lobby`. On the projector, the venue photo gives way to an opaque ghost loading screen. The audience can submit ideas while the world opens. The screen lifts when decoded frames show motion in the robot’s region. The projector then shows the complete native stream. The reduced-motion setting keeps the loading artwork still. A new run uses the same robot reference. Gemini Robotics ER 2 observes the floor and obstacles from pixels, and Brain chooses the next input. A haunting can pause the robot or request a flinch. Fear increases only after World observes the reaction.

The projector shows the chosen haunting in a small **Up next** card before World sends it. **Taking effect** means the request went to Genie. **In the robot’s path** requires a sighting in its walking lane. A scare requires an observed change of pose. The card stays clear of the score and sits on the opposite side from the robot when its latest position is available.

A host opening now checks for one explorer on clear floor with room to see an obstacle along the upper-right diagonal. The camera follows from behind its right shoulder.

Live World captures save a framing report in the run’s `session.json`. It measures robot size, horizontal position and clipping from observed frames. Check the uncut native recording for forward travel alongside the robot, especially during a pause or sidestep. The framing report measures composition and can flag drift even when the robot is still visible.

The host serves on loopback. Any event deployment or audience gateway should expose Courtney’s audience route separately from the host controls.

## Match length and scoring

Google lists “Up to 120 seconds per session” for Genie 4. After an interaction ends, its final frame can seed another interaction. Visual continuity depends on the new generation. [Model limits](https://aistudio.google.com/docs/models/genie-4#genie-4) · [Interaction guide](https://aistudio.google.com/docs/genie#limitations)

The five-minute clock runs from the host’s click and includes loading and chapter changes. The ten-minute clock starts on the first native frame and pauses during chapter changes. A camera test runs one interaction for the duration printed on its button. To report a short or interrupted run, open **Host tools**, select **Copy run report**, and paste it into [the team issue](https://github.com/HydroAcrid/poltergeist/issues/2). For a multi-round show, keep the same World process running. Guests keep their assigned names, receipts and queued ideas. Each new round starts at zero fear. Three confirmed scares or an expired game clock award the round to the audience. Crossing the exit awards it to the robot. The scoreboard credits a separate scare to each idea that caused one. An observed sidestep appears in the feed.

After setup, run `node scripts/rehearse-room-span.cjs` to exercise ten minutes of virtual game time on the real offline World, Brain and Crowd routes. The check follows one guest through a scare win, a dodge, an escape and a timeout. It verifies the scoreboard and the guest's receipt after the ten-minute mark.

## Five-minute demo and ten-minute game

Guests can join and submit while the host prepares the photo. The host defaults to **Start 5-minute demo**, which ends within five minutes of pressing Start, including loading and blackouts. **Game length** also offers **10 minutes of play**. That longer format has up to ten minutes of active play. A doorway crossing, the third observed scare or time running out ends it sooner. Each phone keeps its name, submission history and place in the queue during a blackout. The longer format pauses the game clock while World changes provider interactions. New submissions can still enter the queue.

The hallway lights falter before the projector goes dark. World uses a recent single-player frame on clear floor to open the next view. It waits for the current interaction to close and the projector waits for movement in the incoming frames before bringing the lights back. An unavailable checkpoint or unclear provider closure interrupts the match. Ask the host to start a new game after an interruption.

The short live option still starts one interaction. Google publishes a 120-second limit per interaction and estimates about $6.05 per generated minute. Ten full minutes of generated video would cost about $60.50 at that rate, plus other model usage. [Genie limits](https://aistudio.google.com/docs/genie#limitations) · [Google pricing](https://aistudio.google.com/docs/pricing#genie-4)

## What failed in the wind-up penguin rehearsal

On November 21, thirty virtual guests joined the same photo-seeded Genie round. Their phones delivered 37 private receipts, including seven revisions. Four ideas were selected. One reached Genie. The audience won on time with zero observed scares.

The uncut footage failed the gameplay check. A robot was already baked into the generated hallway before the stage added its player. Vision returned a plausible box even when two robots were visible. The visible silhouette narrowed from 36% to 27% of the image in the measured segment. Brain sent seven left sidesteps, one right sidestep and two left turns. It issued no forward or reverse movement. The native camera made two sideways corrections. The word “windup” also triggered the wind effect. Loose papers earned the first on-screen confirmation before the penguins appeared. A penguin later entering the picture gives no evidence of a dodge. [Native frames](calibration/README.md#two-actors-in-the-shoulder-rehearsal)

Several decisions used frames only three to seven frames apart. When the 42-second timer expired the capture had received 261 of its eventual 1,016 frames. The provider finished closing about 27 seconds later, delaying the announced result. The live driver now associates each choice with its source frame, holds while media is too far behind, and pairs an eligible forward stride with native camera movement. The host ends gameplay on the winner signal and tracks connection cleanup separately.

### How to call a live take ready

Compare one continuous native recording with its projector capture. They must show the same single robot passing a fixed piece of hallway furniture at a steady shoulder distance, the actual requested obstacle entering its route, and a visible response before the next instruction. A dodge that leaves fear unchanged is a valid response. If the robot ignores the obstacle or the camera falls behind, record the take as failed. Check that the audience sees the verified cue at the corresponding moment.

To check existing capture evidence without opening a provider session or rendering video, run:

```sh
npm run rehearsal:review -- /path/to/session.json /path/to/outcome.json
```

The command checks round identity, observed player count, forward input, sampled framing and the identities in the first and in-path encounter frames. A clean result qualifies the recording for visual review. The next live take still needs to demonstrate forward parallax and a response to an unfamiliar obstacle. Phone load and fixture results measure different parts of the app.

## Hosted single-player test

The first Vercel take used an empty reconstruction of the venue and a single composited explorer. The opening check rejected the earlier two-robot frame and accepted the new seed. Across 776 native frames, all 12 vision samples reported the same explorer. Its visible width fell from 34% to 15%. The camera lost its shoulder distance. Crowd approved and selected the wind-up penguin, but World never found a current tracked view for placement. The penguin never appeared, and the audience won on time.

Replaying those frames on the amended tracker preserved the explorer’s identity. The first two observations permitted movement. The remaining ten requested a physical forward camera correction while the explorer waited. Recorded pixels cannot respond to a new command. The next live acceptance check is steady forward parallax, an obstacle appearing across the walking line, and a reaction visible in subsequent native frames.

The second hosted take also lasted 32 seconds. All ten sampled frames contained one explorer. The hallway showed forward parallax, but the robot shrank from 38% to 17% of the image width despite eight forward camera corrections. Brain issued one right sidestep. Crowd selected the penguin again. World treated the widening shot as a missing subject, so it never sent the penguin and recorded no reaction. Stable follow and an observed encounter are still open demo criteria.
