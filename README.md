# Poltergeist

“Gemini is trying to escape this room. You’re the ghost. What do you change?”

A game for the Gemini 4 NYC Hackathon. Genie 4 builds a world from a photo of a real hallway. Gemini steers toward the exit. The audience plays the poltergeist and chooses what happens along the way.

[Watch the 58-second demo](https://raw.githubusercontent.com/HydroAcrid/poltergeist/main/docs/poltergeist-demo.mp4) · [Open the four-slide demo presentation](docs/poltergeist-demo.pdf) · [Join the haunting](https://poltergeist-world.vercel.app/haunt)

Start with the [feature map](FEATURES.md) and [lane assignments](KICKOFF.md#team-assignments). Share blockers and ready fixtures in the [lane handoffs issue](https://github.com/HydroAcrid/poltergeist/issues/2). The [review workflow kit](docs/workflows/README.md) is available for anyone who wants to try Kevin’s checks in Claude Code.

## Rehearse the team game

With Node.js 22.12+ and npm installed, run these commands from the checkout root.

```sh
npm run rehearsal:setup
npm run rehearsal
```

Open [Host](http://127.0.0.1:8914/team) and choose **Rehearse offline**. Use [Projector](http://127.0.0.1:8914/stage) for the game and [Audience](http://127.0.0.1:8914/haunt) for the phone view. The first 30 seconds are open for proposals. Crowd moderates and queues them, Brain chooses moves from labeled hallway frames, and World shows the round. This rehearsal uses no API key or credits. [World host and live Genie setup](apps/world/rehearsal/README.md)

## Play the third-person prototype

After pulling `main`, open [the hallway](apps/world/painted-door/haunting/index.html) from your local checkout in a browser. Choose **Drop banana peel → Walk ahead**. Reset and try **Drop banana peel → Step left → Walk ahead**. Both paths work offline without installing packages or adding a key.

## First playable round

1. Start Gemini in the photographed hallway. Give it the destination and show its robot avatar in third person, with the full body and both feet visible.
2. Someone on a phone chooses an activity, such as dropping a banana peel in Gemini’s path. When the approved change happens, a stylized ghost appears where the peel lands, then fades.
3. Watch the robot’s feet as it steps around the peel or hits it, stumbles and recovers. Reaching the designated exit before time runs out wins the round for Gemini. Replay the decisive moment and let someone propose a new trick for the rematch.

## Prototype progress

Scripted movement carried the camera through the arch in our first hallway photo. In the [local audience prototype](apps/world/painted-door/haunting/index.html), click the aisle to drop a banana peel and see the ghost fade beside it. The empty-hallway background and artwork are included. For the local rehearsal, a person drives the robot with the camera fixed so viewers can see its feet beside the peel. A separate live Genie run produced no clear peel. Contact with a live Genie obstacle and autonomous navigation both remain unverified.

The earlier walking-ghost clip tested visibility, and a painted-door clip tests how the world holds up through a sidestep. [Watch the painted-door test](apps/world/painted-door/replay/painted-door.mp4) · [Open the replay locally](apps/world/painted-door/README.md)
