import { projectPoint } from '../core/geometry.js';

// Shared by thematic surfaces, reference geometry, labels and final outlines.
export function geometryPath(geometry, projection) {
  if (!geometry) return '';
  const xy = point => projectPoint(point,projection).map(value=>Number(value.toFixed(2))).join(',');
  const line = points => `M${points.map(xy).join(' ')}`;
  const polygon = rings => rings.map(ring=>`${line(ring)}Z`).join(' ');
  switch (geometry.type) {
    case 'Polygon': return polygon(geometry.coordinates);
    case 'MultiPolygon': return geometry.coordinates.map(polygon).join(' ');
    case 'LineString': return line(geometry.coordinates);
    case 'MultiLineString': return geometry.coordinates.map(line).join(' ');
    case 'GeometryCollection': return geometry.geometries.map(child=>geometryPath(child,projection)).join(' ');
    case 'Point': case 'MultiPoint': return (geometry.type==='Point'?[geometry.coordinates]:geometry.coordinates).map(point=>{
      const [x,y]=projectPoint(point,projection);return `M${x-3},${y}a3,3 0 1,0 6,0a3,3 0 1,0 -6,0`;
    }).join(' ');
    default: return '';
  }
}
