# hazard-after-haunt (owner: brain)

Crowd's FIXTURE-REQUEST on #2: a new hazard label appears within 2 s of an injected haunting, with a display-safe rationale.

- `ht_01JDPG00000000000000000003` (preset `chair-tips`) is injected at **t = 8000 ms** (`injected.jsonl`, `ok: true`).
- Ticks run at 2 Hz from t = 0. No tick has a hazard before t = 9500.
- At **t = 9500 ms (seq 19)**, 1.5 s after the injection, `perception.hazards` first contains `{ "label": "chair" }`. That tick's rationale is **"obstacle ahead, turning toward exit"** (`ArrowRight`). Later ticks keep the chair and go back to walking.
- The episode times out at 12 500 ms with no success claim.

**Expected under Crowd's interim rule:** the haunting is confirmed "In the hallway" at t = 9500 (seq 19). The observed response is "obstacle ahead, turning toward exit".

Synthetic. The perception values come from World's live `chair-ahead.jpg` labels. `framePath`s are placeholders.
