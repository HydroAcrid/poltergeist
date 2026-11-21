# Five minutes with 300 guests

On November 21, 2026, 300 simulated phones joined the same room, submitted ideas and replaced them before play. Each phone used its own server-issued cookie, received a distinct ghost name and polled its private queue page every two game seconds. The load generator sent each wave together and validated the returned receipts. Both runs used the combined app at `6101a1c` on a two-vCPU Vercel Sandbox with Node 24.22.3.

| Result | One sustained match | Offline Stage and Brain |
| --- | ---: | ---: |
| Active game time | 5 minutes | 5 minutes across 6 rounds |
| Wall time to run the checks | 51.02 s | 30.82 s |
| Guests present at the end | 300 | 300 |
| Private receipts verified | 603 | 600 |
| Replaced ideas correctly withdrawn | 303 | 300 |
| Ideas still queued at five minutes | 275 | 273 |
| Audience impact measured | 25 fixture World acknowledgments | 27 obstacles in the offline hallway |
| Ideas dispatched or placed per minute | 5, 5, 5, 5, 5 | 6, 5, 5, 6, 5 |
| Paged phone polls | 48,603 | 45,900 |
| P95 poll latency | 331 ms | 162 ms |
| P95 submission latency | 134 ms | 181 ms |
| Failed requests or lost sessions | 0 | 0 |

In the sustained match, Crowd used its real HTTP routes and conductor with a fixture World. Three six-second pauses held the same episode ID, score, queue and remaining time. During each pause a guest submitted a replacement, received its receipt, and could see the new idea in the same match. Dispatch resumed on the game clock. The scoreboard recorded one completed episode.

The offline Stage run exercised the actual World and Brain routes with fixture perception. It verifies obstacle placement in the offline simulation. Both runs used rules-based moderation, virtual game time and real loopback HTTP on an isolated port. Venue Wi-Fi, public ingress, Gemini moderation latency and native Genie visuals require independent evidence.

After `npm run rehearsal:setup`, run these from the repository root.

```sh
node scripts/rehearse-crowd-five.cjs 300 --match
node scripts/rehearse-crowd-five.cjs 300
```
