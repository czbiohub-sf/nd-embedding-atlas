/** Douglas-Peucker line simplification */
export function simplifyPath(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const [sx, sy] = points[0];
  const [ex, ey] = points[points.length - 1];
  const dx = ex - sx;
  const dy = ey - sy;
  const lenSq = dx * dx + dy * dy;

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    let dist: number;
    if (lenSq === 0) {
      dist = Math.hypot(px - sx, py - sy);
    } else {
      const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lenSq));
      dist = Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
    }
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPath(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}
