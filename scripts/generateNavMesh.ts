//@ts-check
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { init } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import { exportNavMesh, getNavMeshPositionsAndIndices } from "@recast-navigation/core";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const objPath = path.join(repoRoot, "public", "map.obj");
const outPath = path.join(repoRoot, "public", "map.navmesh.bin");

// Must match main.js loadMap(): scale 0.5, rotation Euler(0,0,0).
// Verified against the app's runtime mapScene world bounds (x -378..426, y -132..110, z -258..280).
const MAP_SCALE = 0.5;
const MAP_ROTATION = new THREE.Euler(0, 0, 0);

// NOTE: walkableRadius is the *agent radius* used for erosion, NOT the old
// scan-based SCAN_RADIUS (=20, which was a scan-camera half-extent). A radius
// of 20 erodes away nearly all walkable corridors. A small radius (~3-5) keeps
// both known-good test points exactly on the navmesh.
// walkableClimb=10 connects all 4 floors (stairs); climb=4 drops the top floors.
const AGENT_RADIUS = 3;
const WALKABLE_HEIGHT = 20;
const WALKABLE_CLIMB = 10;
const WALKABLE_SLOPE_ANGLE = 45;

// Voxel resolution. cs=5/ch=5 quantizes walkable surfaces up to ~5 units and
// drops the lower floors entirely (closestPoint snapped POIs at y≈-35 to y≈59,
// ~95 above the real OBJ slab top of -45). cs=2/ch=2 puts walkable surfaces
// at y≈-44, right on the -45 slab. minRegionArea/mergeRegionArea are in cell
// units, so scale them up as the cell shrinks (8*25 -> 20*4).
const CELL_SIZE = 2;
const CELL_HEIGHT = 2;
const MIN_REGION_AREA = 20;
const MERGE_REGION_AREA = 50;

await init();

const objText = readFileSync(objPath, "utf8");
const loader = new OBJLoader();
const root = loader.parse(objText);
root.rotation.copy(MAP_ROTATION);
root.scale.setScalar(MAP_SCALE);
root.updateMatrixWorld(true);

const meshes: THREE.Mesh[] = [];
root.traverse(child => {
	if (child instanceof THREE.Mesh) meshes.push(child);
});
console.info(`Parsed ${meshes.length} meshes from ${objPath}`);

console.time("generateSoloNavMesh");
const result = threeToSoloNavMesh(meshes, {
	cs: CELL_SIZE,
	ch: CELL_HEIGHT,
	walkableSlopeAngle: WALKABLE_SLOPE_ANGLE,
	walkableHeight: WALKABLE_HEIGHT,
	walkableClimb: WALKABLE_CLIMB,
	walkableRadius: AGENT_RADIUS,
	maxEdgeLen: 12,
	maxSimplificationError: 1.3,
	minRegionArea: MIN_REGION_AREA,
	mergeRegionArea: MERGE_REGION_AREA,
	maxVertsPerPoly: 6,
	detailSampleDist: 6,
	detailSampleMaxError: 1,
});
console.timeEnd("generateSoloNavMesh");

if (result.success === false) {
	console.error("NavMesh generation failed:", result.error);
	process.exit(1);
}
const navMesh = result.navMesh;

const [positions, indices] = getNavMeshPositionsAndIndices(navMesh);
console.info(`NavMesh polygons: ${indices.length / 3}, vertices: ${positions.length / 3}`);

// Sanity: report world bounds and check the known-good test points sit on the navmesh.
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (let i = 0; i < positions.length; i += 3) {
	for (let k = 0; k < 3; k++) {
		if (positions[i + k] < min[k]) min[k] = positions[i + k];
		if (positions[i + k] > max[k]) max[k] = positions[i + k];
	}
}
console.info(`NavMesh bounds: x ${min[0].toFixed(1)}..${max[0].toFixed(1)}, y ${min[1].toFixed(1)}..${max[1].toFixed(1)}, z ${min[2].toFixed(1)}..${max[2].toFixed(1)}`);
const testPoints = [["t1", [299, 58, -130]], ["t2", [45, 58, -70]]] as Array<[string, [number, number, number]]>;
for (const [name, p] of testPoints) {
	const ok = p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2];
	console.info(`  test point ${name} ${p.join(",")} in-bounds: ${ok}`);
}

const navMeshExport = exportNavMesh(navMesh);
writeFileSync(outPath, navMeshExport);
console.info(`Wrote ${navMeshExport.byteLength} bytes to ${outPath}`);
