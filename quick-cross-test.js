// Quick test for infinite cross-beam using local optical system JSON
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateInfiniteSystemCrossBeam } from './gen-ray-cross-infinite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const jsonPath = path.join(__dirname, 'No.135 逆Unilite型 100_2.0.json');
  const hasFile = fs.existsSync(jsonPath);
  if (!hasFile) {
    console.error('Lens JSON not found:', jsonPath);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const opticalSystemRows = data.opticalSystem;

  const objectAngles = [
    { x: 0, y: 0 },
    { x: 0, y: 23 }
  ];

  const res = generateInfiniteSystemCrossBeam(opticalSystemRows, objectAngles, {
    rayCount: 41,
    debugMode: true,
    crossType: 'both'
  });

  for (let oi = 0; oi < res.objectResults.length; oi++) {
    const obj = res.objectResults[oi];
    console.log(`\n=== Object ${oi + 1} (angle x=${obj.objectAngle.x}, y=${obj.objectAngle.y}) ===`);
    console.log('Stop surface index (0-based):', obj.stopSurfaceInfo?.index, 'radius:', obj.stopSurfaceInfo?.radius);
    console.log('Chief origin:', obj.chiefRayOrigin);

    const sides = new Set(obj.apertureBoundaryRays.map(r => r.side || r.direction));
    console.log('Boundary sides found:', Array.from(sides));

    // Check that interpolated rays reach boundary when side is missing
    const sideNeeded = ['upper','lower','left','right'];
    for (const s of sideNeeded) {
      const hasSide = sides.has(s);
      const dirVec = s === 'upper' ? {x:0,y:1} : s === 'lower' ? {x:0,y:-1} : s === 'left' ? {x:-1,y:0} : {x:1,y:0};
      const rays = obj.crossBeamRays.filter(r => r.side === s);
      if (rays.length > 0) {
        const last = rays[rays.length - 1];
        console.log(`Side ${s}: rays=${rays.length}, hasBoundary=${hasSide}, last.type=${last.type}`);
      } else {
        console.log(`Side ${s}: rays=0, hasBoundary=${hasSide}`);
      }
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
