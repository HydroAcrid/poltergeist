# agent-wander (owner: brain)

Synthetic referee scenario (CONTRACTS §8). No hauntings.

- The exit is visible from t = 0. From **seq 6 (t = 3,000)** it is on the robot's **right**, but the player holds `ArrowLeft` four times while its own rationale says "door 2 o'clock". The target drifts further right each tick.
- From **seq 10 (t = 5,000)** the exit is gone for good. The player explores forward until the timeout at 20,000 ms.

**Expected verdict:** **failure**, **blame agent**, failureT ≈ 5,000. The player turned away from a visible target, and there was no haunting.
