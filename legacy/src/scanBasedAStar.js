//@ts-check
import * as THREE from "three";

const SCAN_DEBUG_LOG = false;
const ASTAR_DEBUG_LOG = true;

class PathGenScanCameraConfigType {
	/**
	 * @param {Number} top 
	 * @param {Number} bottom 
	 * @param {Number} left 
	 * @param {Number} right 
	 * @param {Number} near 
	 * @param {Number} far 
	 */
	constructor(top, bottom, left, right, near, far) {
		this.top = top;
		this.bottom = bottom;
		this.left = left;
		this.right = right;
		this.near = near;
		this.far = far;
	}
}

export class ScanHelper {
	/**
	 * @param {{
	 * 	scanRadius: number,
	 * 	mapScene: THREE.Scene,
	 * }} param0 
	 */
	constructor({
		scanRadius: SCAN_RADIUS,
		mapScene
	}) {
		this.scanRadius = SCAN_RADIUS;
		this.mapScene = mapScene;
		this.PATH_GEN_SCAN_CAMERA_CONFIG = Object.freeze({
			HAS_GROUND: new PathGenScanCameraConfigType(this.scanRadius / 4, -this.scanRadius / 4, -this.scanRadius / 4, this.scanRadius / 4, 0, this.scanRadius),
			DEBUG: new PathGenScanCameraConfigType(innerHeight / 2, -innerHeight / 2, -innerWidth / 2, innerWidth / 2, 0, this.scanRadius),
			DEBUG2: new PathGenScanCameraConfigType(this.scanRadius / 4, -this.scanRadius / 4, -this.scanRadius / 4, this.scanRadius / 4, 0, 1000),
			IS_CLEAR: new PathGenScanCameraConfigType(this.scanRadius * 2, -this.scanRadius * 2, -this.scanRadius * 2, this.scanRadius * 2, 0, this.scanRadius)
		});
	}
	/** @constant */
	SCAN_RESULT_BLANK = new Uint8Array([0, 0, 0, 255]);
	/**
	 * @param {Uint8Array} scanResult 
	 */
	isBlankScanResult(scanResult) {
		const result = scanResult.length === this.SCAN_RESULT_BLANK.length && scanResult.every((v, i) => v === this.SCAN_RESULT_BLANK[i]);
		return result;
	}
	scanRenderer = new THREE.WebGLRenderer();
	scanCamera = new THREE.OrthographicCamera();
	cameraHelper = new THREE.CameraHelper(this.scanCamera);

	/** @type {Map<String, Uint8Array>} */
	scanCache = new Map();

	/**
	 * @param {THREE.Vector2} size 
	 * @param {PathGenScanCameraConfigType} camConfig 
	 * @param {THREE.Vector3} A 
	 * @param {THREE.Vector3} B 
	 * @returns {Promise<Uint8Array>}
	 */
	async scan(size, camConfig, A, B) {
		if (SCAN_DEBUG_LOG) console.log("scanargs", arguments);
		if (SCAN_DEBUG_LOG) console.group("scan");
		console.assert(Object.values(A).concat(Object.values(B)).every(Number.isInteger));
		const cacheKey = JSON.stringify(arguments);
		if (this.scanCache.has(cacheKey)) {
			console.count("Scan cache hit");
			const result = this.scanCache.get(cacheKey);
			if (!result) throw new TypeError();
			if (SCAN_DEBUG_LOG) console.groupEnd();
			return result;
		} else {
			console.count("Scan cache miss");
			if (this.scanRenderer.domElement.width !== size.x || this.scanRenderer.domElement.height !== size.y) {
				this.scanRenderer.setSize(size.x, size.y);
			}
			Object.assign(this.scanCamera, camConfig);
			this.scanCamera.position.copy(A);
			this.scanCamera.lookAt(B);
			this.scanCamera.updateProjectionMatrix();
			this.cameraHelper.update();
			this.scanRenderer.render(this.mapScene, this.scanCamera);
			if (SCAN_DEBUG_LOG) await new Promise(r => setTimeout(r, 1000));
			const pixels = new Uint8Array(4 * size.x * size.y);
			const gl = this.scanRenderer.getContext();
			gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			this.scanCache.set(cacheKey, pixels);
			if (SCAN_DEBUG_LOG) console.groupEnd();
			return pixels;
		}
	}
	/**
	 * @param {THREE.Vector3} pos 
	 */
	async hasGround(pos) {
		if (SCAN_DEBUG_LOG) console.group("hasGround");
		if (SCAN_DEBUG_LOG) console.info("args", ...arguments);
		const scanResult = await this.scan(new THREE.Vector2(1, 1), this.PATH_GEN_SCAN_CAMERA_CONFIG.HAS_GROUND, pos.clone(), new THREE.Vector3(0, -1, 0).add(pos).clone());
		const result = !this.isBlankScanResult(scanResult);
		if (SCAN_DEBUG_LOG) console.log("result", result);
		console.groupEnd();
		return result;
	}
	/**
	 * @param {THREE.Vector3} currentPos 
	 * @param {THREE.Vector3} destination
	 * @param {number} [foreseeScale=1] 
	 */
	async hasObstacle(currentPos, destination, foreseeScale = 1) {
		if (SCAN_DEBUG_LOG) console.group("hasObstacle");
		if (SCAN_DEBUG_LOG) console.log("args", ...arguments);
		const scanResult = await this.scan(
			new THREE.Vector2(1, 1),
			new PathGenScanCameraConfigType(
				this.scanRadius * foreseeScale,
				-this.scanRadius * foreseeScale,
				-this.scanRadius * foreseeScale,
				this.scanRadius * foreseeScale,
				0,
				currentPos.distanceTo(destination) * foreseeScale
			),
			currentPos,
			destination
		);
		const result = !this.isBlankScanResult(scanResult);
		if (SCAN_DEBUG_LOG) console.log("result", result);
		if (SCAN_DEBUG_LOG) console.groupEnd();
		return result;
	}
}

export class PathNode {
	/**
	 * @param {PathNode|null} parent 
	 * @param {AStarContextInterface} aStarContext 
	 * @param {THREE.Vector3} position 
	 */
	constructor(parent, aStarContext, position) {
		this.parent = parent;
		this.position = position.clone();
		this.aStarContext = aStarContext;
		if (ASTAR_DEBUG_LOG) console.assert(this.parent == null || this.parent instanceof PathNode);
		if (this.parent) this.parent.children.push(this);
		this.costToStart = this.parent ? this.parent.costToStart + position.distanceTo(this.parent.position) : 0;
	}
	extraCost = 0;
	get relativeOrigin() {
		return this.aStarContext instanceof BackwardAStarContext ? this.aStarContext.forwardCtx.startPos : this.aStarContext.startPos;
	}
	get relativePosition() {
		if (!this.relativeOrigin) throw new TypeError();
		return Object.freeze(this.position.clone().sub(this.relativeOrigin));
	}
	get costToEnd() {
		console.assert(!!this.aStarContext.endPos == !!this.aStarContext._endPos, "Wrong endPos getter");
		return this.aStarContext.endPos ? this.aStarContext.endPos.distanceTo(this.position) : 0;
	}
	get cost() {
		return this.costToStart + this.costToEnd + this.extraCost;
	}
	/** @type {PathNode|null} */
	parent = null;
	/** @type {PathNode[]} */
	children = [];
	clone() {
		return new PathNode(this.parent, this.aStarContext, this.position);
	}
	get positionMapKey() {
		return AStarContext.getMapKey(this.position);
	}
	async generateAStarChildren() {
		if (!(this.aStarContext instanceof AStarContext)) throw new TypeError();
		const possibleChildren = this.aStarContext.generateNodePossibleChildren(this);
		return await this.aStarContext.filterNodePossibleChildren(this, possibleChildren);
	}
}
class AStarContextInterface extends THREE.EventDispatcher {
	/**
	 * @param {ScanHelper} scanHelper
	 */
	constructor(scanHelper) {
		super();
		this.scanHelper = scanHelper;
		const proto = Object.getPrototypeOf(this);
		for (const key of Object.getOwnPropertyNames(proto)) {
			const desc = Object.getOwnPropertyDescriptor(proto, key);
			if (!desc) throw new TypeError();
			if (desc.set) console.assert(!!desc.get, "Expecting getter:", key);
		}
	}
	/**
	 * @type {THREE.Vector3?}
	 */
	startPos = null;
	/**
	 * @type {THREE.Vector3?}
	 */
	_endPos = null;
	get endPos() {
		return this._endPos;
	}
	/**
	 * @param {THREE.Vector3?} newEndPos 
	 */
	set endPos(newEndPos) {
		if (newEndPos) {
			if (!this._endPos) {
				this._endPos = newEndPos.clone();
			} else {
				this._endPos.copy(newEndPos);
			}
		} else {
			this._endPos = null;
		}
	}
	ended = false;
	/**
	 * @type {PathNode[]|null}
	 */
	result = null;
	/**
	 * @type {()=>Promise<IteratorResult<undefined>>}
	 */
	async next() {
		throw new TypeError();
	}
	/**
	 * @type {ScanHelper}
	 */
	scanHelper;
	smooth = true;
	/**
	 * @param {PathNode} ancestor
	 * @param {boolean} [reverse=false]
	 * @param {boolean} [smooth=false] 
	 */
	async concatPath(ancestor, reverse = false, smooth = false) {
		const result = [];
		let node = ancestor;
		while (node) {
			result.push(node);
			node = node.parent;
		}
		result.reverse();
		if (smooth) {
			if (ASTAR_DEBUG_LOG) console.group("smooth");
			for (let i = 0; i < result.length - 2;) {
				const reachable = !await this.scanHelper.hasObstacle(result[i].position, result[i + 2].position, 1);
				if (reachable) {
					if (ASTAR_DEBUG_LOG) console.log("Smoothing: Removed node", result[i + 1].position);
					result.splice(i + 1, 1);
				} else {
					i++;
				}
			}
			if (ASTAR_DEBUG_LOG) console.groupEnd();
		}
		if (reverse) {
			result.reverse();
		}
		for (let i = 0; i < result.length; i++) {
			result[i].parent = i > 0 ? result[i - 1] : null;
			result[i].aStarContext = this;
		}
		return result;
	}
	/**
	 * @param {THREE.Vector3} pos
	 * @param {THREE.Vector3} origin
	 * @param {number} stepLength
	 * @returns {THREE.Vector3[]}
	 */
	static getSurroundingGridPositions(pos, origin, stepLength) {
		const relative = pos.clone().sub(origin);
		const flooredRelative = new THREE.Vector3(
			Math.floor(relative.x / stepLength) * stepLength,
			Math.floor(relative.y / stepLength) * stepLength,
			Math.floor(relative.z / stepLength) * stepLength
		);
		const offsets = [
			new THREE.Vector3(0, 0, 0),
			new THREE.Vector3(1, 0, 0),
			new THREE.Vector3(0, 1, 0),
			new THREE.Vector3(0, 0, 1),
			new THREE.Vector3(1, 1, 0),
			new THREE.Vector3(1, 0, 1),
			new THREE.Vector3(0, 1, 1),
			new THREE.Vector3(1, 1, 1),
		];
		return offsets.map(offset =>
			flooredRelative.clone().add(offset.clone().multiplyScalar(stepLength)).add(origin)
		);
	}
	/**
	 * @param {PathNode} endingNode
	 * @returns {Promise<PathNode[]|null>}
	 */
	async end(endingNode) {
		return [];
	}
}
export class AStarContext extends AStarContextInterface {
	/**
	 * @param {THREE.Vector3} startPos 
	 * @param {THREE.Vector3|null} endPos 
	 * @param {number} stepLength 
	 * @param {ScanHelper} scanHelper 
	 * @param {boolean} [smooth]
	 */
	constructor(startPos, endPos, stepLength, scanHelper, smooth = true) {
		Object.freeze(startPos);
		super(scanHelper);
		this.startPos = startPos;
		this._endPos = endPos;
		this.stepLength = stepLength;
		this.scanHelper = scanHelper;
		this.smooth = smooth;
		this.directions = [
			new THREE.Vector3(1, 0, 0),
			new THREE.Vector3(-1, 0, 0),
			new THREE.Vector3(0, 1, 0),
			new THREE.Vector3(0, -1, 0),
			new THREE.Vector3(0, 0, 1),
			new THREE.Vector3(0, 0, -1)
		].map(v => v.multiplyScalar(stepLength));
		this.candidateNodes = [new PathNode(null, this, startPos.clone())];
		this.openListMap = new Map();
	}
	/**
	 * @param {number} targetCost 
	 */
	findInsertionIndex(targetCost) {
		let left = 0;
		let right = this.candidateNodes.length;
		while (left < right) {
			const mid = (left + right) >>> 1;//商2
			if (this.candidateNodes[mid].cost >= targetCost) {
				left = mid + 1;
			} else {
				right = mid;
			}
		}
		return left;
	}
	resortOpenList() {
		if (this.candidateNodes && this.candidateNodes.length > 0) {
			this.candidateNodes.sort((a, b) => b.cost - a.cost);
		}
	}
	get endPos() {
		return this._endPos;
	}
	/**
	 * @param {THREE.Vector3|null} newEndPos 
	 */
	set endPos(newEndPos) {
		if (newEndPos) {
			if (!this._endPos) {
				this._endPos = newEndPos.clone();
			} else if (!this._endPos.equals(newEndPos)) {
				this._endPos.copy(newEndPos);
			}
		} else {
			this._endPos = null;
			return;
		}
		console.info("EndPos changed", this, newEndPos);
		const potentialPositions = AStarContextInterface.getSurroundingGridPositions(
			this._endPos,
			this.startPos,
			this.stepLength
		);
		this.addCandidate(...potentialPositions.map(pos => this.closeListSearch(pos)).filter(Boolean).map(node => {
			if (!node) throw new TypeError();
			this.closeList.delete(node.positionMapKey);
			return node;
		}));

		this.resortOpenList();

		this.ended = false;
	}
	ended = false;
	/**
	 * @param {THREE.Vector3} position
	 */
	openListFindPositionIndex(position) {
		return this.candidateNodes.findIndex(node => node.position.equals(position));
	}
	/**
	 * @type {Map<string, PathNode>}
	 */
	closeList = new Map();
	/**
	 * @param {THREE.Vector3} position 
	 */
	static getMapKey(position) {
		const rounded = position.toArray().map(n => Math.round(n));
		return rounded.toString();
	}
	/**
	 * @param {THREE.Vector3} position 
		 */
	closeListSearch(position) {
		return this.closeList.get(AStarContext.getMapKey(position));
	};
	/**
	 * @type {PathNode[]|null}
	 */
	result = null;
	/**
	 * @param {PathNode} node 
	 */
	generateNodePossibleChildren(node) {
		return this.directions.toSorted(() => Math.random() - 0.5).map(v => {
			return new PathNode(node, this, v.clone().add(node.position));
		});
	}
	/**
	 * @param {PathNode} node 
	 * @param {PathNode[]} possibleChildren
	 */
	async filterNodePossibleChildren(node, possibleChildren) {
		const result = [];
		for (const possibleChild of possibleChildren) {
			const possiblePos = possibleChild.position;
			if (this.closeListSearch(possiblePos)) {
				continue;
			}
			const existingNode = this.openListMap.get(possibleChild.positionMapKey);

			if (existingNode) {
				if (possibleChild.costToStart >= existingNode.costToStart) {
					continue;
				}
			}
			const obstacleFree = !(await this.scanHelper.hasObstacle(node.position, possiblePos));
			if (!obstacleFree) continue;
			const canStand = await this.scanHelper.hasGround(possiblePos);
			if (!canStand) continue;
			if (await this.canEnd(possibleChild)) {
				const result = await this.end(possibleChild);
				if (!result) throw new TypeError();
				this.result = result;
				this.ended = true;
				return [];
			}
			this.dispatchEvent({
				type: "reachableNodeFound",
				node: possibleChild,
				context: this
			});
			result.push(possibleChild);
		}
		return result;
	}
	/**
	 * 	 * @param {PathNode[]} newNodes
			 */
	addCandidate(...newNodes) {
		for (const newNode of newNodes) {
			const key = newNode.positionMapKey;
			if (this.openListMap.has(key)) {
				const existingNode = this.openListMap.get(key);
				if (newNode.cost < existingNode.cost) {
					const oldIndex = this.candidateNodes.indexOf(existingNode);
					if (oldIndex !== -1) {
						this.candidateNodes.splice(oldIndex, 1);
					}
				} else {
					continue;
				}
			}
			const insertIndex = this.findInsertionIndex(newNode.cost);
			this.candidateNodes.splice(insertIndex, 0, newNode);
			this.openListMap.set(key, newNode);
		}
	}
	/**
	 * @deprecated
	 */
	async nextStep() {
		return this.next();
	}
	/**
	 * @param {PathNode} node 
	 */
	async canEnd(node) {
		return this._endPos && node.position.distanceTo(this._endPos) <= this.stepLength * 2 && !(await this.scanHelper.hasObstacle(node.position, this._endPos));
	}
	/**
	* @returns {Promise<IteratorResult<undefined>>}
	*/
	async next() {
		if (this.ended) {
			return { value: undefined, done: true };
		}
		const node = this.candidateNodes.pop();
		if (!node) {
			this.ended = true;
			return { value: undefined, done: true };
		}
		this.openListMap.delete(node.positionMapKey);
		if (this.closeListSearch(node.position)) {
			throw new Error("Node found in open list, but it's already in close list.");
		}
		this.closeList.set(node.positionMapKey, node);
		if (await this.canEnd(node)) {
			this.result = await this.end(node);
			return { value: undefined, done: true };
		}
		const newCandidates = await node.generateAStarChildren();
		if (this.ended) {
			return { value: undefined, done: true };
		}
		this.addCandidate(...newCandidates);
		return { value: undefined, done: false };
	}
	/**
	 * @param {PathNode} [endingNode]
	 */
	async end(endingNode) {
		if (!this._endPos) throw new TypeError();
		if (!endingNode) return null;
		if (this.ended) {
			console.warn("A* already ended.");
			return null;
		}
		if (ASTAR_DEBUG_LOG) console.info("A* Ending at node", endingNode);
		this.ended = true;
		let pathNode = endingNode.position.equals(this._endPos) ? endingNode : new PathNode(endingNode, this, this._endPos);
		return await this.concatPath(pathNode, false, this.smooth);
	}
	[Symbol.asyncIterator]() {
		return this;
	}
}

export class BackwardAStarContext extends AStarContext {
	/**
	 * @param {AStarContext} forwardCtx
	 */
	constructor(forwardCtx) {
		if (!forwardCtx.endPos) throw new TypeError("Cannot create BackwardAStarContext without a valid endPos in forwardCtx");
		super(forwardCtx.endPos, forwardCtx.startPos, forwardCtx.stepLength, forwardCtx.scanHelper, forwardCtx.smooth);
		this.forwardCtx = forwardCtx;
	}
	/**
	 * @param {PathNode} node
	 */
	generateNodePossibleChildren(node) {
		if (!(node.relativePosition.toArray().every(n => n % this.stepLength == 0))) {
			if (!node.relativeOrigin) throw new TypeError();
			const positions = AStarContextInterface.getSurroundingGridPositions(
				node.position,
				node.relativeOrigin,
				this.stepLength
			);
			return positions.map(p => new PathNode(node, this, p));
		} else return super.generateNodePossibleChildren(node);
	}
}

export class BiDirectionalAStarContext extends AStarContextInterface {
	/**
	 * @param {AStarContext} forwardCtx
	 */
	constructor(forwardCtx) {
		super(forwardCtx.scanHelper);
		this.forwardCtx = forwardCtx;
		this.backwardCtx = new BackwardAStarContext(this.forwardCtx);
		this.startPos = this.forwardCtx.startPos;
		this._endPos = this.forwardCtx._endPos;
		if (!this.endPos) throw new TypeError();
		this.scanHelper = this.forwardCtx.scanHelper;
		this.smooth = this.forwardCtx.smooth;
		this.forwardMeetNode = null;
		this.backwardMeetNode = null;

		this.forwardCtx.canEnd = async (node) => {
			const foundNode = this.findNodeInOtherContext(this.backwardCtx, node.position);
			if (foundNode) {
				this.forwardMeetNode = node;
				this.backwardMeetNode = foundNode;
				return true;
			}
			return false;
		};

		this.backwardCtx.canEnd = async (node) => {
			const foundNode = this.findNodeInOtherContext(this.forwardCtx, node.position);
			if (foundNode) {
				this.forwardMeetNode = foundNode;
				this.backwardMeetNode = node;
				return true;
			}
			return false;
		};

		this.forwardCtx.end = async () => {
			this.forwardCtx.ended = true;
			return [];
		};
		this.backwardCtx.end = async () => {
			this.backwardCtx.ended = true;
			return [];
		};

		this.forwardCtx.addEventListener("reachableNodeFound", (event) => {
			this.dispatchEvent(event);
		});
		this.backwardCtx.addEventListener("reachableNodeFound", (event) => {
			this.dispatchEvent(event);
		});
	}
	/**
	 * @param {AStarContext} otherCtx 
	 * @param {THREE.Vector3} position 
	 * @returns 
	 */
	findNodeInOtherContext = (otherCtx, position) => {
		const key = AStarContext.getMapKey(position);
		return otherCtx.openListMap.get(key) ?? otherCtx.closeListSearch(position);
	};
	forwardNext = false;
	ended = false;
	/**
	 * Thanks ChatGLM for fixing this!
	 */
	async end() {
		if (!this.forwardMeetNode || !this.backwardMeetNode) {
			console.warn("2-way A* failed.");
			return null;
		}
		console.info("2-way A* ending.");
		if (!this.forwardMeetNode || !this.backwardMeetNode) {
			throw new TypeError();
		}
		const forwardPath = await this.forwardCtx.concatPath(this.forwardMeetNode, false, false);
		const backwardPath = await this.backwardCtx.concatPath(this.backwardMeetNode, true, false);
		const fullPath = forwardPath.concat(backwardPath.slice(1));
		for (let i = 0; i < fullPath.length - 1; i++) {
			fullPath[i + 1].parent = fullPath[i];
		}
		const pathAncestor = fullPath.at(-1);
		if (!pathAncestor) throw new TypeError();
		return await this.concatPath(pathAncestor, false, this.smooth);
	}
	/**
	 * @returns {Promise<IteratorResult<undefined>>}
	 */
	async next() {
		if (this.ended) throw new TypeError();
		this.forwardNext = !this.forwardNext;
		if (this.forwardNext) {
			await this.forwardCtx.next();
			if (this.forwardCtx.ended) {
				this.ended = true;
			}
		} else {
			await this.backwardCtx.next();
			if (this.backwardCtx.ended) {
				this.ended = true;
			}
		}
		if (this.ended) {
			this.result = await this.end();
		}
		return { value: undefined, done: this.ended };
	}
}
