# never-seen (owner: brain)

Synthetic referee scenario (CONTRACTS §8). No hauntings.

- The exit is **never** visible on any tick, from t = 0 to the timeout at 20,000 ms. The player scans (`ArrowRight`) and explores forward (`W`).

**Expected verdict:** **failure**, **blame agent**, **failureT 0**. The player never found the target, and nothing else happened.
