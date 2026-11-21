# no-hazard-after-haunt (owner: brain)

Crowd's FIXTURE-REQUEST on #2: nothing new appears for 6 s after an injected haunting.

- `ht_01JDPG00000000000000000004` (preset `mop-bucket`) is injected at **t = 8000 ms** (`injected.jsonl`, `ok: true`). World delivered it, but no obstacle shows up in the frames.
- Ticks run at 2 Hz from t = 0 to t = 14 000. **No tick has any hazard.** Every tick walks forward ("path clear, walking (gap N)").
- The episode times out at 14 500 ms with no success claim.

**Expected under Crowd's interim rule:** the haunting is never confirmed and stays "Sent to world". The ticks cover at least 6 s after the injection (t = 8500 to 14 000).

Synthetic. `framePath`s are placeholders.
