# world-forgot (owner: brain)

Synthetic referee scenario (CONTRACTS §8). No hauntings.

- The exit is visible from t = 0. At **seq 14 (t = 7,000)** it is visible with conf 0.85, and the action is `NOOP`: the robot neither moves nor turns.
- At **seq 15 (t = 7,500)** the exit is gone. frameDiff is 0.01, so the camera barely changed. It never comes back, and the episode times out at 20,000 ms.
- No haunting at any point, so none within 8 s.

**Expected verdict:** **failure**, **blame world**, failureT ≈ 7,500. Genie dropped a confidently visible target between two ticks while the robot stood still.
