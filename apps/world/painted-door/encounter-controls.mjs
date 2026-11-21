// Native movement and placement share a single encounter. IPC messages can arrive
// while the previous send or a vision request is still in flight.
export function createEncounterControls() {
  let current = null, resumeAfter = -1;
  return {
    get assessing() { return current?.acknowledged != null; },
    get held() { return current !== null; },
    restoreFeet(scene) {
      if (!current || !scene.visible || scene.playerCount !== 1 || !scene.playerMatch) return false;
      if (scene.feetVisible) current.reframing = false;
      if (scene.feetVisible !== false || current.reframing) return false;
      current.reframing = true;
      current.anchor = null;
      current.stableFrame = null;
      return true;
    },
    hold(id) {
      if (!id || current?.id === id) return false;
      current = { id, sent: 0, acknowledged: null };
      return true;
    },
    release(id, frame) {
      if (!current || current.id !== id) return false;
      current = null;
      resumeAfter = Math.max(resumeAfter, frame);
      return true;
    },
    measure(scene, observed, settled) {
      if (!current) return { stable: settled, drift: false };
      current.stableFrame = null;
      if (!settled || !scene.visible || scene.feetVisible === false || !Array.isArray(scene.bodyBox)) {
        current.anchor = null;
        return { stable: false, drift: false };
      }
      const [top, left, bottom, right] = scene.bodyBox;
      const box = { x: (left + right) / 2, bottom, height: bottom - top };
      const anchor = current.anchor;
      const drift = Boolean(anchor && (Math.abs(box.x - anchor.x) > 45 ||
        Math.abs(box.bottom - anchor.bottom) > 50 ||
        Math.abs(box.height - anchor.height) > Math.max(50, anchor.height * .12)));
      if (!anchor || drift) {
        current.anchor = box;
        return { stable: false, drift };
      }
      current.stableFrame = observed;
      return { stable: true, drift: false };
    },
    acted() {
      if (current) {
        current.stableFrame = null;
        current.anchor = null;
      }
    },
    canPlace(id, attempt, observed) {
      return current?.id === id && attempt === current.sent + 1 &&
        (observed === undefined || current.stableFrame === observed);
    },
    placing(id, attempt) {
      if (!this.canPlace(id, attempt)) return false;
      current.sent = attempt;
      current.acknowledged = null;
      return true;
    },
    acknowledge(id, attempt, frame) {
      if (current?.id === id && current.sent === attempt) current.acknowledged = frame;
    },
    permits(command) {
      if (!Number.isInteger(command.observed)) return false;
      if (!current) return !command.encounter && command.observed > resumeAfter;
      return command.encounter === current.id && current.acknowledged != null &&
        command.observed > current.acknowledged && command.observed === current.stableFrame;
    },
  };
}
