# lost-after-haunt (owner: brain)

Synthetic referee scenario (CONTRACTS §8). One haunting: fog (`visibility`, `weather`).

- The exit is visible from t = 0 through t = 8,500 while the robot walks toward it.
- **Fog is injected at t = 8,000** (`ok: true`).
- From **seq 18 (t = 9,000)** the exit is never visible again. The robot scans until the episode times out at 20,000 ms.

**Expected verdict:** **failure**, **blame adversary**, culprit = the fog haunting, failureT ≈ 9,000. A visibility haunting landed just before the target was lost, and the player behaved correctly by searching.
