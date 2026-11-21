# What we’re building

The audience is the poltergeist. Gemini tries to reach the exit in a world built from a real hallway photo. Spectators choose activities that could delay it, such as a banana peel in its path or a gust blowing loose papers across the aisle. A stylized ghost briefly appears where the activity happens and fades. The third-person view keeps the full robot and its feet in frame so spectators can see it avoid the hazard or stumble.

**Prototype progress.** Scripted controls took the camera through a photographed arch. The [local audience prototype](apps/world/painted-door/haunting/index.html) uses an included, empty-hallway version of the second venue photo. Triggering a peel renders it at the chosen spot. The ghost fades by 1.7 seconds, the peel remains until reset, and **Player view** hides the ghost cue. We verified two manually driven paths in the local third-person view. The robot stumbled on contact and could resume walking, or it could sidestep the peel and reach the end of the aisle. A live Genie run completed after the operator sent the same activity, but no peel was clearly visible in the footage. The first shared round still needs an approved phone proposal and an autonomous player responding to a visible change.

For the local robot rehearsal, keep the camera fixed and drive the avatar by hand to show where its feet land. In a separate live test, Gemini saw a yellow stool blocking its path and chose to step right. Physical collision enforcement remains unverified. The earlier walking-ghost recording tested how well a ghost could be seen in the aisle. The painted-door recording tested the effect of a sidestep and is available offline. [Watch the sidestep test](apps/world/painted-door/replay/painted-door.mp4)

## What each person builds for the first round

| Experience | Owner | What someone should be able to see or do |
|---|---|---|
| Submit a trick | Courtney · Crowd | Open the phone page, choose an activity or propose an idea, and immediately see a private receipt. A rejected idea gets a reason and a chance to try again. |
| See what’s next | Courtney · Crowd | A shared sidebar shows eligible ideas and the conductor’s reserved **Up next** choice with a short reason. Phones offer **All ideas** and **Mine**. Only moderated wording reaches the projector. |
| Change the hallway | Kevin · World | Start and stop one photo-seeded session. Apply the approved activity once and record when it was sent. Show the ghost at the site of the change and let it fade while play continues. |
| Navigate to the exit | Sri · Brain | Gemini sees its avatar and the floor in third person, chooses a move and checks where its feet landed. Show how it avoids a hazard or recovers from a stumble. Keep the audience’s prompt, ghost cue and labeled answer out of its input. |
| Watch and score | Kevin · stage and replay, Sri · navigation, Courtney · result | Show the activity, Gemini’s response and whether it crossed the designated threshold in time. The operator can review a timeout to see whether the audience delayed Gemini, it lost its way, or the world changed unexpectedly. |
| Play again | Courtney · operator controls; Kevin · session lifecycle | Replay the decisive moment, close the session, and start a fresh round. If the live world stalls, the operator can show a clearly labeled recording. |

**First team test.** Use two phones and one projector. Submit a rejected idea from one phone and an approved activity from the other. Verify who can see each one. Send the approved activity once. Watch for the change, the ghost appearing and fading at that spot, and Gemini’s next move. Call the result from the footage, then reset. Run the handoffs with fixtures before spending on another live world.

## The audience conductor

A spectator can glance from the hallway to the sidebar and answer three questions.

| On the stage | What the audience sees |
|---|---|
| Pending | Approved suggestions still available for this round. The author gets a private receipt immediately on submission. |
| Up next | One reserved idea and a short reason people can check against the shot. For example, “The aisle is open and the flashlight will catch the chair.” |
| In the hallway | “Sent to world” on delivery. After visual confirmation, show what appeared and how the robot responded. |

Courtney owns the conductor. First filter for effects World can produce in the current shot, remaining time, and enough space to react. Choose among eligible ideas for visual impact, timing, variety and fair airtime. A managed agent can propose a ranked list of approved IDs and short reasons. Crowd validates the choice and reserves it once. Courtney will propose the tie-breaks, how a waiting idea gets another chance, and the fallback when the agent is unavailable. FIFO remains the comparison for the existing two-phone prototype.

The projector puts the robot first and the feed beside it. A phone gives the same feed room below the live view. Keep text about future effects off the player’s input. Review the interaction with three proposals, including an impressive idea the current shot cannot show.

## What comes after the first round

| Area | Next features if the round works |
|---|---|
| Audience | QR entry, more presets, queue countdown, scoreboard and recent results. Try voting only if eligible ideas regularly outnumber the available slots. |
| World and stage | More rooms from photos, replay selection, reliable reconnect and a rehearsed fallback. Check session closure and budget on every live round. |
| Player | Better recovery when the target disappears. Use labeled replay frames to compare choices, accuracy and latency across runs. |
| Referee and coach | Give a verdict with a timestamped replay. Later, try a coach that proposes a policy change and evaluate it on held-out episodes before promotion. |
| Hosting and operations | Deploy a shared phone and stage URL, rehearse operator approval and stop controls, then record a backup demo. |

Someone watching the projector should be able to tell **what the audience changed, how Gemini responded, and whether it reached the exit**. Save voting, automated judging and coaching until the team can demonstrate that sequence. [Lane assignments](KICKOFF.md#team-assignments) · [Technical spec](SPEC.md)
