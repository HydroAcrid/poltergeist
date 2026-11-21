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

The live host uses its private root `.env` with `GEMINI_API_KEY`. To use the current checkout’s camera with a key stored elsewhere, set `PG_WORLD_ENV_FILE` to the absolute path of the World host’s private environment file. `PG_CAPTURE_DIR` overrides the capture package itself. Keep the key on that laptop.

Open **Host** and capture or choose the hallway photo. World opens the lobby and sends the selected photo to Gemini to prepare the right-shoulder view. Guests can submit while it prepares. The host can retry preparation if it fails. **Start Genie round** opens one paid world interaction when the host is ready. An open photo lobby skips the second countdown. The public lobby phase and photo status are available at `GET /rehearsal/lobby`. On the projector, the venue photo gives way to an opaque ghost loading screen. The audience can submit ideas while the world opens. The screen lifts when decoded frames show motion in the robot’s region. The projector then shows the complete native stream. The reduced-motion setting keeps the loading artwork still. A new run uses the same robot reference. Gemini Robotics ER 2 observes the floor and obstacles from pixels, and Brain chooses the next input. A haunting can pause the robot or request a flinch. Fear increases only after World observes the reaction.

The projector shows the chosen haunting in a small **Up next** card before World sends it. **Taking effect** means the request went to Genie. **In the robot’s path** requires a sighting in its walking lane. A scare requires an observed change of pose. The card stays clear of the score and sits on the opposite side from the robot when its latest position is available.

Live World captures save a framing report in the run’s `session.json`. It measures robot size, horizontal position and clipping from observed frames. Check the uncut native recording for forward travel alongside the robot, especially during a pause or sidestep. The framing report measures composition and can flag drift even when the robot is still visible.

The host serves on loopback. Any event deployment or audience gateway should expose Courtney’s audience route separately from the host controls.

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
