/** The eight compass points, clockwise from north. On every map north is −Z and east is +X (the sun rises there). */
export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

export const COMPASS_NAMES: Record<CompassPoint, string> = {
  N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest',
};

/**
 * Bearing in degrees clockwise from north, in [0, 360), for a player facing `yaw`. Yaw 0 looks down −Z (north) and
 * turning right lowers the yaw, so the bearing is simply −yaw.
 */
export function headingDegrees(yaw: number): number {
  const d = ((-yaw * 180) / Math.PI) % 360;
  return (d + 360) % 360;
}

/** The nearest of the eight compass points to where a player facing `yaw` is looking. */
export function compassPoint(yaw: number): CompassPoint {
  return COMPASS_POINTS[Math.round(headingDegrees(yaw) / 45) % 8];
}
