# What we’re building

A judge plays the ghost. They change one thing in a room, watch Gemini investigate it, then get a rematch. The first trick is a painted exit beside a working door.

**Working today:** one recorded Genie 4 round shows the painted door appearing and staying on the plaster through a scripted sidestep. Everyone can replay it offline. The next milestone is a single round connecting a phone submission to an autonomous choice and a result on the projector. [Watch the first round](apps/world/painted-door/replay/painted-door.mp4)

## What each person builds for the first round

| Experience | Owner | What someone should be able to see or do |
|---|---|---|
| Submit a trick | Courtney · Crowd | Open the phone page, tap the painted-door preset or propose an idea, and immediately see a private receipt. A rejected idea gets a reason and a chance to try again. |
| See what’s next | Courtney · Crowd | Approved ideas appear on both phones, oldest eligible submission first. Players can switch between **All ideas** and **Mine**. Only approved wording reaches the projector. |
| Change the room | Kevin · World | Start and stop one hallway session. Apply the selected idea once and record when it was sent. The audience can watch whether the door actually appears. |
| Investigate and choose | Sri · Brain | Gemini sees the camera view, makes a movement choice and shows its target or short rationale. It can change angle before committing to a door. The ghost’s prompt and the answer stay hidden from the player. |
| Watch and score | Kevin · stage and replay; Sri · choice; Courtney · result | The projector shows the trick, move and chosen door. For the first demo the operator can score it: real exit wins for Gemini, painted exit wins for the ghost. If there is no clear choice, show that outcome. |
| Play again | Courtney · operator controls; Kevin · session lifecycle | Replay the decisive moment, close the session, and start a fresh round. If the live world stalls, the operator can show a clearly labeled recording. |

**First team test:** use two phones and one projector. Submit a rejected idea from one phone and an approved trick from the other. Verify who can see each one. Send the approved trick once, watch the player make its own move, call the result from the footage, then reset. Run the handoffs with fixtures before spending on another live world.

## What comes after the first round

| Area | Next features if the round works |
|---|---|
| Audience | QR entry, more presets, queue countdown, scoreboard and recent results. Try voting only if eligible ideas regularly outnumber the available slots. |
| World and stage | More rooms from photos, replay selection, reliable reconnect and a rehearsed fallback. Check session closure and budget on every live round. |
| Player | Better recovery when the target disappears. Use labeled replay frames to compare choices, accuracy and latency across runs. |
| Referee and coach | Give a verdict with a timestamped replay. Later, try a coach that proposes a policy change and evaluate it on held-out episodes before promotion. |
| Hosting and operations | Deploy a shared phone and stage URL, rehearse operator approval and stop controls, then record a backup demo. |

The first build decision is whether someone watching the projector can tell **what the ghost changed, what the player chose, and who won**. Save voting, automated judging and coaching until the team can demonstrate that sequence. [Lane assignments](KICKOFF.md#team-assignments) · [Technical spec](SPEC.md)
