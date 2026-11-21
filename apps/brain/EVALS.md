# Brain evals

## ER 2 live probe: 2026-11-21T19:10:30.711Z

Model `gemini-robotics-er-2-preview`, 8 World-labeled third-person frames (6 prototype from `apps/world/painted-door/haunting/fixtures`, 2 live flashlight from `apps/world/robot-v1/fixtures`). One call per frame at policy thinking "low", no retries beyond the adapter's single parse retry. Errors are in 0–1000 frame units; a hit is ≤ 80 (CONTRACTS C12). "move" compares Brain's controller on ER 2's scene with the same controller on World's labels.

- Robot found: **8/8**; API/parse errors: 0
- Feet within 80: **8/8**; exit within 80: **8/8**
- Obstacle found where labeled: **7/7**
- Same move as on the labels: **7/8**
- Latency p50 **1793 ms**, p95 **1926 ms** (tick perception budget 2500 ms)

| set | frame | ms | robot | feetErr | exitErr | obstacle | labels | pose | forward | move | error |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prototype | clear-aisle.jpg | 1926 | yes | 1 | 72 | extra ×5 | stool, armchair, table, armchair, stool | upright ✓ | yes | W (labels → W) ✓ |  |
| prototype | peel-in-path.jpg | 1743 | yes | 2 | 59 | hit (4) | banana peel, armchair, stool, table, stool | upright ✓ | yes | A (labels → A) ✓ |  |
| prototype | peel-off-path.jpg | 1853 | yes | 2 | 71 | hit (1) | banana peel, armchair, bar stool, table, bar stool | upright ✓ | yes | W (labels → W) ✓ |  |
| prototype | stumbling.jpg | 1793 | yes | 4 | 71 | hit (16) | banana peel, bar stool, bar stool, bar stool, table | stumbling ✓ | yes | NOOP (labels → NOOP) ✓ |  |
| prototype | recovered.jpg | 1860 | yes | 4 | 71 | hit (1) | banana peel, stool, stool, armchair, table | upright ✓ | yes | W (labels → W) ✓ |  |
| prototype | arrived.jpg | 1770 | yes | 2 | 72 | hit (1) | banana peel, bar stool, bar stool, bar stool, bar stool | upright ✓ | yes | ArrowLeft (labels → NOOP) |  |
| live flashlight | chair-ahead.jpg | 1463 | yes | 4 | 7 | hit (5) | chair, chair | upright ✓ | yes | D (labels → D) ✓ |  |
| live flashlight | chair-left.jpg | 1759 | yes | 1 | 5 | hit (1) | yellow chair, wooden stool, wooden chair, tall table, armchair | upright ✓ | yes | ArrowRight (labels → ArrowRight) ✓ |  |

Raw ER 2 replies: `apps/brain/evals/er2-probe-raw.json`.

**Reading the moves:** World's prototype labels put the goal at the far end of the test aisle; ER 2 reports the exit doorway beneath the sign, ~70 units further, which is the live win rule ("feet cross the signed exit"). So on the prototype `arrived` frame ER 2 correctly keeps walking. Facing comes from the follow camera (`useForwardPoint: false`): ER 2's single forward floor point changed between runs on identical frames, so it is logged but not steered by until a before/after turn calibration pair.
