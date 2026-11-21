# ER 2 on synthetic shoulder-POV frames: 2026-11-21T19:23:12.578Z

**Synthetic frames** (AI-generated, see `fixtures/media/fixture-zero/shoulder/README.md`), model `gemini-robotics-er-2-preview`, shoulder rig (estimated ground anchor [1000,220]).

- Robot found: **8/8**; exit within 80 units: **8/8**
- Move satisfies the frame's human `expect` label: **7/8**
- Latency p50 1524 ms, max 1754 ms

| frame | ms | robot | exitErr | hazards | pose | move · rationale | expect |
|---|---|---|---|---|---|---|---|
| clear-route.jpg | 1754 | yes (boots hidden) | 7 | bar stool, armchair, small table | upright | W · path clear, walking (gap 727) | walk ✓ |
| absent.jpg | 1487 | yes (boots hidden) | 5 | stool, armchair, side table | upright | W · path clear, walking (gap 726) | walk ✓ |
| chair-next-step.jpg | 1222 | yes (boots hidden) | 7 | chair | upright | W · path clear, walking (gap 727) | not-into-right ✓ |
| chair-ahead-right-open.jpg | 1524 | yes (boots hidden) | 8 | yellow chair, bar stool, bar chair | upright | D · obstacle ahead, stepping right | not-into-left ✓ |
| foil-crossing.jpg | 1303 | yes (boots hidden) | 2 | foil sheet | upright | ArrowLeft · blocked both sides, looking for a way | judgment ✓ |
| foil-beside.jpg | 1563 | yes (boots hidden) | 5 | foil ribbon, stool with ribbon, bar stools left | upright | W · path clear, walking (gap 726) | walk ✓ |
| stumbling.jpg | 1539 | yes (boots hidden) | 7 | chair on left, armchair, small bar tables | upright | W · path clear, walking (gap 727) | hold ✗ |
| at-exit.jpg | 1338 | yes (boots hidden) | 5 | table, chair | upright | NOOP · feet at threshold (gap 349), confirming | arrive ✓ |
