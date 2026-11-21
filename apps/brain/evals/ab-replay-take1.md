# Before/after replay on take 1 (real Genie frames)

Old Brain = `59bcdd7`. New Brain = steady decisions + previous move in the prompt + too-small hold + planned next move. Both ran the same 11 frames that World observed in live take 1 (`ep_01M7ZVQRQPBSZ0ZQMF97Y85X3R`, frames 1-945, 640x360), in order, through each version's real tick path: er2 model mode, shoulder rig, 2500 ms budget, live gemini-robotics-er-2-preview. Each version ran twice, because ER 2 varies between runs. The robot never moved in take 1, so the scene is almost static, which makes this a good test of flip-flopping.

| run | direction changes | timeouts | steady holds | perception p50 |
|---|---|---|---|---|
| OLD#1 | 7 | 1 | 0 | 1780 ms |
| OLD#2 | 3 | 0 | 0 | 1629 ms |
| NEW#1 | 2 | 0 | 1 | 1573 ms |
| NEW#2 | 0 | 0 | 3 | 1745 ms |

## Moves per frame

| frame | OLD#1 | OLD#2 | NEW#1 | NEW#2 |
|---|---|---|---|---|
| 1 | walk→`W` | walk→`W` | walk→`ArrowRight` (veto) | walk→`ArrowRight` (veto) |
| 86 | walk→`W` | walk→`W` | turn_right→`ArrowRight` | turn_right→`ArrowRight` |
| 221 | turn_right→`ArrowRight` | walk→`W` | turn_right→`ArrowRight` | turn_right→`ArrowRight` |
| 306 | walk→`W` | walk→`W` | walk→`ArrowRight` (steady) | turn_right→`ArrowRight` |
| 391 | walk→`W` | turn_right→`ArrowRight` | walk→`W` | walk→`ArrowRight` (steady) |
| 496 | turn_right→`ArrowRight` | step_right→`W` (veto) | turn_right→`ArrowRight` | turn_right→`ArrowRight` |
| 571 | step_right→`W` (veto) | turn_right→`ArrowRight` | turn_right→`ArrowRight` | turn_right→`ArrowRight` |
| 661 | turn_right→`ArrowRight` | turn_right→`ArrowRight` | turn_right→`ArrowRight` | step_right→`ArrowRight` (steady) |
| 776 | step_right→`D` | turn_right→`ArrowRight` | turn_right→`ArrowRight` | turn_right→`ArrowRight` |
| 856 | step_right→`D` | turn_right→`ArrowRight` | turn_right→`ArrowRight` | turn_right→`ArrowRight` |
| 945 | step_right→`NOOP` (timeout) | turn_right→`ArrowRight` | turn_right→`ArrowRight` | walk→`ArrowRight` (steady) |

Notes:
- In the new version, frame 1 was vetoed ("walk blocked, blocked both sides"). That came from ER 2's run-to-run variation in obstacle boxes: two direct rechecks of the same frame with the new prompt reported no blockage.
- The too-small hold never fired, because robot widths in take 1 were 23-30%. The planned-next fallback never fired either, because the new runs had no timeouts.
- ER 2 streaming spike (`scripts/spike-er2-streaming.mjs`): request/response p50 1449 ms, streaming p50 2133 ms (+369 ms to connect), and the streaming replies came back as empty text. Not adopted.
