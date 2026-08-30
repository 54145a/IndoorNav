//@ts-check
import * as THREE from "three";
import { init, importNavMesh, NavMeshQuery } from "recast-navigation";
import { PathFinder } from "./pathFinder.js";

const NAVMESH_DEBUG_LOG = true;

/**
 * PathFinder implemented on top of a precomputed Detour nav mesh.
 *
 * The nav mesh is generated offline (see scripts/generateNavMesh.ts) and
 * shipped as a static binary in public/. This class only imports and queries it.
 */
export class NavMeshPathfinder extends PathFinder {
	/**
	 * @param {{
	 * 	navMeshUrl?: string,
	 * }} param0
	 */
	constructor({ navMeshUrl = "/map.navmesh.bin" } = {}) {
		super();
		this.navMeshUrl = navMeshUrl;
		/** @type {import("recast-navigation").NavMesh|null} */
		this.navMesh = null;
		/** @type {NavMeshQuery|null} */
		this.navMeshQuery = null;
		this.readyPromise = this.init();
	}
	async init() {
		await init();
		const response = await fetch(this.navMeshUrl);
		if (!response.ok) throw new Error(`Failed to fetch navmesh ${this.navMeshUrl}: ${response.status}`);
		const data = new Uint8Array(await response.arrayBuffer());
		const { navMesh } = importNavMesh(data);
		this.navMesh = navMesh;
		this.navMeshQuery = new NavMeshQuery(navMesh);
		if (NAVMESH_DEBUG_LOG) console.info("NavMesh imported", navMesh);
		return this;
	}
	/**
	 * Snap a world-space position onto the nav mesh (closest walkable point).
	 * @param {THREE.Vector3} pos
	 * @returns {Promise<THREE.Vector3|null>}
	 */
	async closestPoint(pos) {
		await this.readyPromise;
		if (!this.navMeshQuery) throw new TypeError();
		const result = this.navMeshQuery.findClosestPoint(
			{ x: pos.x, y: pos.y, z: pos.z },
			{ halfExtents: { x: 200, y: 200, z: 200 } }
		);
		if (!result.success || result.polyRef === 0) return null;
		return new THREE.Vector3(result.point.x, result.point.y, result.point.z);
	}
	/**
	 * @param {THREE.Vector3} _startPos
	 * @returns {AsyncGenerator<undefined, void, unknown>}
	 */
	async *warmUp(_startPos) {
		// The whole nav mesh is precomputed offline; nothing to warm up.
		yield undefined;
		return;
	}
	/**
	 * @param {THREE.Vector3} startPos
	 * @param {THREE.Vector3} endPos
	 * @returns {Promise<THREE.Vector3[]|null>}
	 */
	async findPath(startPos, endPos) {
		await this.readyPromise;
		if (!this.navMeshQuery) throw new TypeError();
		if (NAVMESH_DEBUG_LOG) console.info("NavMesh findPath", startPos, endPos);
		const start = await this.closestPoint(startPos);
		const end = await this.closestPoint(endPos);
		if (!start || !end) {
			if (NAVMESH_DEBUG_LOG) console.warn("NavMesh start/end not on navmesh", { startPos, endPos, start, end });
			return null;
		}
		const result = this.navMeshQuery.computePath(
			{ x: start.x, y: start.y, z: start.z },
			{ x: end.x, y: end.y, z: end.z }
		);
		if (!result.success) {
			if (NAVMESH_DEBUG_LOG) console.warn("NavMesh path failed", result);
			return null;
		}
		const path = result.path.map(p => new THREE.Vector3(p.x, p.y, p.z));
		if (NAVMESH_DEBUG_LOG && path.length) console.info("NavMesh result", path.length, path);
		return path;
	}
}
