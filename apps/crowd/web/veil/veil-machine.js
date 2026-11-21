// Ghost veil state machine (pure, no DOM). The veil must never expose the scene while it
// is sweeping in: a part() that arrives early waits until coverage is complete.
//
//   idle --cover--> sweeping --coverDone--> holding --part--> parting --partDone--> gone
//                      |  part (early) → remembered, runs right after coverDone
//   gone --cover--> sweeping (next round)

export function createVeilMachine() {
  let state = "idle";
  let partQueued = false;
  const listeners = new Set();
  const set = (next) => {
    state = next;
    for (const fn of listeners) fn(state);
  };
  return {
    get state() {
      return state;
    },
    /** True whenever nothing behind the veil can be seen. */
    get isCovered() {
      return state === "holding";
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    cover() {
      if (state === "idle" || state === "gone" || state === "parting") {
        partQueued = false;
        set("sweeping");
      }
      return state;
    },
    /** The sweep-in finished: the screen is now fully covered. */
    coverDone() {
      if (state !== "sweeping") return state;
      set("holding");
      if (partQueued) {
        partQueued = false;
        set("parting");
      }
      return state;
    },
    part() {
      if (state === "sweeping") partQueued = true;
      else if (state === "holding") set("parting");
      return state;
    },
    /** The part-out finished. */
    partDone() {
      if (state === "parting") set("gone");
      return state;
    },
  };
}
