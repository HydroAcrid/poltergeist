# Brain evals

## ER 2 live probe: 2026-11-21T18:36:59.933Z

Model `gemini-robotics-er-2-preview`, 8 World-labeled third-person frames (6 prototype from `apps/world/painted-door/haunting/fixtures`, 2 live flashlight from `apps/world/robot-v1/fixtures`). One call per frame at policy thinking "low", no retries beyond the adapter's single parse retry. Errors are in 0–1000 frame units; a hit is ≤ 80 (CONTRACTS C12). "move" compares Brain's controller on ER 2's scene with the same controller on World's labels.

- Robot found: **8/8**; API/parse errors: 0
- Feet within 80: **8/8**; exit within 80: **8/8**
- Obstacle found where labeled: **7/7**
- Same move as on the labels: **6/8**
- Latency p50 **1763 ms**, p95 **2007 ms** (tick perception budget 2500 ms)

| set | frame | ms | robot | feetErr | exitErr | obstacle | labels | pose | forward | move | error |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prototype | clear-aisle.jpg | 1998 | yes | 1 | 69 | extra ×5 | bar stool, bar stool, dining chair, armchair, small round table | upright ✓ | yes | W (labels → W) ✓ |  |
| prototype | peel-in-path.jpg | 2007 | yes | 2 | 69 | hit (4) | banana peel, stool, table, armchair, stool | upright ✓ | yes | A (labels → A) ✓ |  |
| prototype | peel-off-path.jpg | 1762 | yes | 2 | 69 | hit (1) | banana peel, bar stool, armchair, table, bar stool | upright ✓ | yes | W (labels → W) ✓ |  |
| prototype | stumbling.jpg | 1790 | yes | 4 | 69 | hit (16) | banana peel, stool, stool, stool, chair | stumbling ✓ | yes | NOOP (labels → NOOP) ✓ |  |
| prototype | recovered.jpg | 1763 | yes | 4 | 54 | hit (1) | banana peel, stool, bar stool, table with base, armchair | upright ✓ | yes | W (labels → W) ✓ |  |
| prototype | arrived.jpg | 1630 | yes | 2 | 76 | hit (1) | banana peel, stool, table, armchair, stool | upright ✓ | yes | ArrowLeft (labels → NOOP) |  |
| live flashlight | chair-ahead.jpg | 1343 | yes | 4 | 7 | hit (5) | chair, chair | upright ✓ | yes | ArrowRight (labels → ArrowRight) ✓ |  |
| live flashlight | chair-left.jpg | 1511 | yes | 4 | 4 | hit (3) | yellow chair, wooden counter, brown chair | upright ✓ | yes | W (labels → ArrowRight) |  |

Raw ER 2 replies: `apps/brain/evals/er2-probe-raw.json`.

**Reading the moves:** World's prototype labels put the goal at the far end of the test aisle; ER 2 reports the exit doorway beneath the sign, ~70 units further, which is the live win rule ("feet cross the signed exit"). So on the prototype `arrived` frame ER 2 correctly keeps walking. Facing comes from the follow camera (`useForwardPoint: false`): ER 2's single forward floor point changed between runs on identical frames, so it is logged but not steered by until a before/after turn calibration pair.
