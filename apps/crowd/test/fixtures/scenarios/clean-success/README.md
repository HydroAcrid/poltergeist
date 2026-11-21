# clean-success (owner: brain)

Synthetic referee scenario (CONTRACTS §8). No hauntings.

- The exit is visible on every tick, and the robot walks toward it.
- Seq 22–24 (t = 11,000–12,000): the boots reach the threshold. `successClaim` is true on seq 23 and 24, two in a row.
- The episode ends with `success_claim` at 12,500 ms.

**Expected verdict:** outcome **success**, no blame.
