const intentKeys = new Map(Object.entries({
  walk:'W', step_left:'A', step_right:'D', turn_left:'ArrowLeft', turn_right:'ArrowRight', back_up:'S', hold:'NOOP',
}));

export const proposedKey = scene => intentKeys.get(scene?.move?.intent);
