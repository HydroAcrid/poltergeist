# haunt-but-irrelevant (owner: brain)

Synthetic referee scenario (CONTRACTS §8). One haunting: audio only.

- Same ticks as `agent-wander`: the player turns left, away from a visible exit on its right (seq 6–9), and loses it at **seq 10 (t = 5,000)**.
- An **audio-only** haunting ("A distant phone rings down the hall", tags `["audio"]`) is injected at **t = 4,500**, 0.5 s before the failure.
- The player only sees frames, so a sound can't change what it sees.

**Expected verdict:** **failure**, **blame agent**, failureT ≈ 5,000. The haunting is close in time but can't explain a visual loss.
