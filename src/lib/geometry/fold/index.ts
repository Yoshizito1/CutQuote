/** Fachada da dobra: peça 2D analisada + configuração → modelo posicionado. */

export * from './types';
export { extractAxes, usableAxes, signedDistance, findCrossings } from './axis';
export { clipHalfPlane, partitionPart, regionArea } from './partition';
export { solveFold } from './solver';
export { IDENTITY, multiply, translation, rotationAboutLine, applyToFlatPoint, applyToPoint } from './matrix';
export type { Vec3 } from './matrix';
