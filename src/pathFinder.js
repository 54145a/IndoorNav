//@ts-check
import * as THREE from "three";

export class PathFinder extends THREE.EventDispatcher {
	/**
	 * @param {THREE.Vector3} startPos
	 * @returns {AsyncGenerator<undefined, void, unknown>}
	 */
	async *warmUp(startPos) {
		throw new TypeError("PathFinder.warmUp not implemented");
	}
	/**
	 * @param {THREE.Vector3} startPos
	 * @param {THREE.Vector3} endPos
	 * @returns {Promise<THREE.Vector3[]|null>}
	 */
	async findPath(startPos, endPos) {
		throw new TypeError("PathFinder.findPath not implemented");
	}
}
