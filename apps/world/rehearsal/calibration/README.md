# Native Genie camera samples

Each JPEG is an unannotated full frame from a completed Genie 4 session, before the projector UI. Coordinates in the Brain observations use [y, x] normalized to 0–1000.

| Input | Before | After | Observation |
| --- | --- | --- | --- |
| Hold native W | [Frame 5](forward-before.jpg) | [Frame 101](forward-after.jpg) | The host holds forward during the entrance for 96 frames at 24 fps. Compare the near painting, plant and farther door. The robot turns its head while its backpack stays near the viewer. |
| Pulse native ArrowRight | [Frame 716](pan-before.jpg) | [Frame 732](pan-after.jpg) | The host sends a 126 ms camera pan at frame 717. The second image is captured about 0.6 seconds after the requested release. The pair samples the actual response at that duration. |

In the later 29-second navigation round, ER2 returned nine observations and Brain sent ArrowLeft, A, A and W. A yellow chair appeared. A correction still left it outside the estimated walking corridor. The round ended on time with zero fear. A camera key rotates the view; the images alone cannot establish that the robot’s body turned by the same amount.
