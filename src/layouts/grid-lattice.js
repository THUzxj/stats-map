// Unit centre distance. Hexagons use odd-q offset coordinates at the boundary.
export const gridKey = ([c, r]) => `${c},${r}`;
const parity = c => ((c % 2) + 2) % 2;
export function gridPoint([c, r], type) {
  return type === 'grid-hex' ? [Math.sqrt(3) / 2 * c, r + parity(c) / 2] : [c, r];
}
export function gridDistance(a, b, type) {
  const dc = a[0] - b[0];
  if (type !== 'grid-hex') return Math.abs(dc) + Math.abs(a[1] - b[1]);
  const du = a[1] - Math.floor(a[0] / 2) - b[1] + Math.floor(b[0] / 2);
  return (Math.abs(dc) + Math.abs(du) + Math.abs(dc + du)) / 2;
}
export function gridNeighbors([c, r], type) {
  if (type !== 'grid-hex') return [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
  const u = r - Math.floor(c / 2);
  return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
    .map(([dq, du]) => [c + dq, u + du + Math.floor((c + dq) / 2)]);
}
