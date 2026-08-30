//@ts-check
//#region 
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { WebStorageItemStorage } from "@54145a/storage2/storage.js";
import { ScanHelper, AStarContext, BackwardAStarContext, BiDirectionalAStarContext } from "./scanBasedAStar.js";
import { querySelector, querySelectorAll } from "@keupoz/strict-queryselector";

const PATH_GEN_STEP_LENGTH = 10;
const SCAN_RADIUS = PATH_GEN_STEP_LENGTH * 2;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
renderer.localClippingEnabled = true;
camera.aspect = innerWidth / innerHeight;

document.body.appendChild(renderer.domElement);

const mapScene = new THREE.Scene();

const axesHelper = new THREE.AxesHelper(100);
scene.add(axesHelper);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
mapScene.add(new THREE.AmbientLight(0xffffff));
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
scene.add(directionalLight);

/**
 * @param {THREE.Object3D} object
 * @param {(object: THREE.Material)=>void} func 
 */
function processMesh(object, func) {
	object.traverse(child => {
		if (child instanceof THREE.Mesh) {
			if (Array.isArray(child.material)) {
				child.material.forEach(func);
			} else {
				func(child.material);
			}
		}
	});

}
/**
 * @param {THREE.Object3D} object 
 */
function applyDoubleSide(object) {
	/**
	 * @param {THREE.Material} material
	 */
	const processSingleMaterial = material => {
		material.side = THREE.DoubleSide;
	};
	return processMesh(object, processSingleMaterial);
}
/**
 * @param {THREE.Object3D} object 
 * @param {THREE.Plane} plane 
 */
function applyClip(object, plane) {
	return processMesh(object, m => m.clippingPlanes = [plane]);
}

/**
 * @typedef {{mapObject3D: THREE.Object3D, mapConf: import("./mapDefinition.d.ts").mapDefinition}} LoadMapResult
 * @property {THREE.Object3D} mapObject3D
 * @property {import("./mapDefinition.d.ts").mapDefinition} mapConf
 * @param {import("./mapDefinition.d.ts").mapDefinition} mapDefinition
 * @param {THREE.Euler} rotation
 * @param {number} scale
 * @returns {Promise<LoadMapResult>}
 */
async function loadMap(mapDefinition, rotation = new THREE.Euler(0, 0, 0), scale = 1) {
	let resultObject3D;
	/**
	 * @param {OBJLoader} objLoader 
	 * @param {THREE.Scene} targetScene 
	 */
	const loadObj = (objLoader, targetScene) => new Promise(resolve => {
		objLoader.load(`/${mapDefinition.name}.obj`, (object) => {
			object.rotation.copy(rotation);
			object.scale.setScalar(scale);
			applyDoubleSide(object);
			targetScene.add(object);
			resultObject3D = object;
			resolve(object);
		});
	});
	await Promise.all([
		new Promise((resolve) => {
			const objLoader = new OBJLoader();
			const mtlLoader = new MTLLoader();
			mtlLoader.load(`/${mapDefinition.name}.mtl`, (mtl) => {
				mtl.preload();
				objLoader.setMaterials(mtl);
				resolve(objLoader);
			}, undefined, (e) => {
				console.warn(e);
				resolve(objLoader);
			});
		}).then(objLoader => loadObj(objLoader, scene)),
		loadObj(new OBJLoader, mapScene)
	]);
	for (const spot of Object.values(mapDefinition.pointsOfInterest)) {
		scene.add(createPointIndicator(
			new THREE.Vector3(...spot.position),
			0xffa500,
			5,
			spot.displayName
		));
	}
	return {
		mapObject3D: resultObject3D,
		mapConf: mapDefinition
	};
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.minDistance = 5;

let showAStarFootprint = THREE.Object3D.prototype.visible;
const scanHelper = new ScanHelper({ mapScene, scanRadius: SCAN_RADIUS });

//#endregion
//#region 
const PATH_GEN_DEBUG_LOG = true;

const aStarSearchFootprintIndicatorGroup = new THREE.Group();
Object.defineProperty(aStarSearchFootprintIndicatorGroup, "visible", {
	get() {
		return showAStarFootprint;
	}
});
scene.add(aStarSearchFootprintIndicatorGroup);

const pathIndicatorGroup = new THREE.Group();
scene.add(pathIndicatorGroup);

/**
 * @param {THREE.Vector3} start 
 * @param {THREE.Vector3} end 
 */
function createArrowIndicator(start, end, gapScale = 0.1, color = 0xffffff) {
	Object.freeze(start);
	Object.freeze(end);
	const delta = Object.freeze(end.clone().sub(start));
	if (PATH_GEN_DEBUG_LOG) console.log("delta", delta);
	const arrow = new THREE.ArrowHelper(delta.clone().normalize(), start.clone(), delta.length() * (1 - gapScale), color, 5, 5);
	return arrow;
}

/**
 * @param {THREE.Vector3} start 
 * @param {THREE.Vector3} end 
 */
function createPathArrowIndicator(start, end) {
	console.group("Draw Arrow");
	const color = 0xffffff;
	if (PATH_GEN_DEBUG_LOG) console.log("Drawing path", start, end);
	Object.freeze(start);
	Object.freeze(end);
	const delta = end.clone().sub(start);
	const totalLength = delta.length();
	if (totalLength === 0) return new THREE.Group();
	const direction = delta.clone().normalize();
	const MAX_ARROW_SEGMENT_LENGTH = 20;
	const group = new THREE.Group();
	const segmentCount = Math.max(1, Math.floor(totalLength / MAX_ARROW_SEGMENT_LENGTH));
	const segmentLength = totalLength / segmentCount;
	let currentStart = start;
	for (let i = 0; i < segmentCount; i++) {
		currentStart = start.clone().addScaledVector(direction, i * segmentLength);
		if (i < segmentCount - 1) {
			const arrow = createArrowIndicator(currentStart, currentStart.clone().add(direction.clone().multiplyScalar(segmentLength)), 0, color);
			group.add(arrow);
		} else {
			const geometry = new THREE.BufferGeometry().setFromPoints([currentStart, end]);
			const material = new THREE.LineBasicMaterial({ color: 0xffffff });
			const line = new THREE.Line(geometry, material);
			group.add(line);
		}
	}
	console.groupEnd();
	return group;
}
/**
 * @param {THREE.Vector3} pos 
 * @param {Number} color 
 * @param {number} size
 * @param {string} [label]
 */
function createPointIndicator(pos, color = 0xffffff, size = 2, label) {
	if (label) {
		const group = new THREE.Group();
		const coneGeo = new THREE.ConeGeometry(0.5 * size, 2 * size);
		const coneMat = new THREE.MeshBasicMaterial({
			color: color,
			depthTest: false,
			depthWrite: true
		});

		const cone = new THREE.Mesh(coneGeo, coneMat);
		cone.rotation.x = Math.PI;
		cone.position.y += size;
		group.add(cone);

		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new TypeError();
		canvas.height = 64;
		ctx.font = "32px sans-serif";
		canvas.width = Math.ceil(ctx.measureText(label).width) + 8;
		ctx.fillStyle = "white";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(label, canvas.width / 2, canvas.height / 2);

		const texture = new THREE.CanvasTexture(canvas);
		const spriteMat = new THREE.SpriteMaterial({
			map: texture,
			depthTest: false,
			sizeAttenuation: false
		});

		const sprite = new THREE.Sprite(spriteMat);
		const spriteHeight = 0.1;
		sprite.scale.set(spriteHeight * (canvas.width / canvas.height), spriteHeight, 1);
		sprite.position.y += size * 4;
		group.add(sprite);

		group.position.copy(pos);
		return group;
	} else {
		const geometry = new THREE.BoxGeometry(size, size, size);
		const material = new THREE.MeshBasicMaterial({ color: color });
		const cube = new THREE.Mesh(geometry, material);
		cube.position.copy(pos);
		return cube;
	}
}

/**
 * @param {THREE.Vector3} pos
 * @param {number} color 
 */
function addAStarFootprintIndicator(pos, color) {
	const indicator = createPointIndicator(pos, color);
	aStarSearchFootprintIndicatorGroup.add(indicator);
	return indicator;
}

/**
 * @param {{node: import("./scanBasedAStar.js").PathNode}} param0
 */
function addFootprint({ node }) {
	if (showAStarFootprint) addAStarFootprintIndicator(node.position, 0xffffff);
};
/** @type {AStarContext|null} */
let warmupContext = null;

/**
 * @param {THREE.Vector3} startPos 
 */
async function* warmUp(startPos) {
	console.info("Starting Dijkstra", startPos);
	warmupContext = new AStarContext(startPos, null, PATH_GEN_STEP_LENGTH, scanHelper);
	warmupContext.addEventListener("reachableNodeFound", addFootprint);
	for await (const _iteratorResult of warmupContext) {
		yield _iteratorResult
		await new Promise(requestAnimationFrame);
	}
	console.info("Warmup reached limit");
}
/**
 * @param {THREE.Vector3} startPos 
 * @param {THREE.Vector3} endPos 
 */
async function findPath(startPos, endPos) {
	if (PATH_GEN_DEBUG_LOG) console.info("Launching A*", startPos, endPos);
	Object.freeze(startPos);
	Object.freeze(endPos);
	//scene.add(createPointIndicator(endPos, 0x00ff00, 5));
	if (PATH_GEN_DEBUG_LOG) console.time("A*");
	if (!warmupContext) warmupContext = new AStarContext(startPos, endPos, PATH_GEN_STEP_LENGTH, scanHelper, true);
	warmupContext.endPos = endPos;
	const aStarContext = new BiDirectionalAStarContext(warmupContext
	);
	aStarContext.addEventListener("reachableNodeFound", ({ node, context }) => {
		const color = context instanceof BackwardAStarContext ? 0x777777 : 0xffffff;
		addAStarFootprintIndicator(node.position, color);
	});
	let stepCount = 0;
	do {
		await aStarContext.next();
		stepCount++;
		if (stepCount % 5 == 0) await new Promise(requestAnimationFrame);/*r => setTimeout(r, 1000)*/
	} while (!aStarContext.ended);
	if (aStarContext.result) {
		if (PATH_GEN_DEBUG_LOG) console.info("Result position list", aStarContext.result.map(v => v.position));
		aStarContext.result.slice(0, -1).forEach((v, i) => {
			const thisPos = v.position;
			const nextPos = aStarContext.result?.[i + 1]?.position;
			if (!nextPos) throw new TypeError();
			pathIndicatorGroup.add(createPathArrowIndicator(thisPos, nextPos));
		});
	}
	if (PATH_GEN_DEBUG_LOG) console.timeEnd("A*");
	aStarSearchFootprintIndicatorGroup.clear();
	warmupContext = new AStarContext(startPos, null, PATH_GEN_STEP_LENGTH, scanHelper);
}

//#endregion

let clipY = 10000;
/**
 * @param {PointerEvent} event 
 * @param {boolean} round
 */
function parseClickPosition(event, round = true) {
	const raycaster = new THREE.Raycaster();
	const rendererSize = new THREE.Vector2();
	renderer.getSize(rendererSize);
	//转换坐标系
	const originX = (event.clientX / rendererSize.x) * 2 - 1;
	const originY = -(event.clientY / rendererSize.y) * 2 + 1;//屏幕y轴向下为正，Three.js向上为正
	raycaster.setFromCamera(new THREE.Vector2(originX, originY), camera);
	const intersects = raycaster.intersectObjects(scene.children);
	const validIntersect = intersects.find(i => i.point.y < clipY);
	if (validIntersect) {
		const normal = validIntersect.face?.normal.transformDirection(validIntersect.object.matrixWorld);
		console.info("normal", normal);
		if (!normal) {
			console.warn("Invalid normal.");
			return null;
		};
		const resultPos = validIntersect.point.clone().addScaledVector(normal, 5);
		return new THREE.Vector3(...resultPos.toArray().map(round ? Math.round : n => n));
	}
	return null;
}
/**
 * @enum {string}
 */
const CustomEventName = {
	POSITION_PICK: "custom:positionpick"
};
for (const name of Object.values(CustomEventName)) console.assert(name.startsWith("custom:"));

const menuRight = querySelector("div#menu-right");

/**
 * @returns {Promise<THREE.Vector3|null>}
 */
function pickPositionOnce() {
	console.info("Position pick start");
	const originalMenuDisplay = menuRight.style.display;
	menuRight.style.display = "none";
	return new Promise((resolve, _reject) => {
		/**
		 * @param {PointerEvent} event 
		 */
		function success(event) {
			console.info("Position pick succeed");
			const position = parseClickPosition(event);
			if (!position) {
				console.info("Position pick empty result");
				resolve(null);
			};
			dispatchEvent(new CustomEvent(CustomEventName.POSITION_PICK, { detail: { position } }));
			resolve(position);
		}
		/*function cancel() {
			console.log("Position pick canceled");
			removeEventListener("pointerup", success);
			resolve(null);
		}*/
		addEventListener("pointerdown", _e => {
			addEventListener("pointerup", success, { once: true });
		}, { once: true });
	}).finally(() => {
		menuRight.style.display = originalMenuDisplay;
	});
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {{isModel?: boolean, message?: string}} options
 */
function showDialog(dialog, { isModel = true, message } = {}) {
	if (!(dialog instanceof HTMLDialogElement)) throw new TypeError();
	dialog.returnValue = "";
	if (message) {
		const messageWrapper = dialog.querySelector(".message");
		if (!messageWrapper) throw new TypeError();
		messageWrapper.textContent = message;
	}
	dialog[isModel ?? true ? "showModal" : "show"]();
	return new Promise(r => dialog.addEventListener("close", r, { once: true }));
}

/**
 * @todo 封装为通用楼层切换函数
 * @param {boolean} [smooth=false] 
 */
function viewGlobal(smooth = false) {
	const targetLookAt = new THREE.Vector3(200, 0, -100);
	const targetPosition = targetLookAt.clone().add(new THREE.Vector3(0, 2000, 0));
	if (smooth) {
		const animate = () => {
			let alpha = 0.1;
			camera.position.lerp(targetPosition, alpha);
			controls.target.lerp(targetLookAt, alpha);
			controls.update();
			if (camera.position.distanceTo(targetPosition) > 50) {
				requestAnimationFrame(animate);
				alpha *= 2;
			} else {
				camera.up.set(0, 1, 0);
			}
		};
		animate();
	} else {
		camera.position.copy(targetPosition);
		controls.target.copy(targetLookAt);
	}
	controls.update();
}

querySelectorAll("button.camMove-global").forEach(e => {
	bindButton(e, async () => viewGlobal(true));
});

const pickDialog = querySelector("dialog#pickDialog");
const pickFailedDialog = querySelector("dialog#pickFailed");
const pickConfirmDialog = querySelector("dialog#pickConfirm");

/** @type {Promise<import("./mapDefinition.d.ts").mapDefinition>|null} */
let mapDefinitionPromise = null;
function getMapDefinition() {
	return mapDefinitionPromise ??= import("./map.mapMeta.js").then(m => m.default);
}

/**
 * @param {import("./mapDefinition.d.ts").ScenicSpot} spot
 * @returns {THREE.Vector3}
 */
function spotToPosition(spot) {
	return new THREE.Vector3(...spot.position);
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {import("./mapDefinition.d.ts").mapDefinition} mapDefinition
 */
function populatePoiButtons(dialog, mapDefinition) {
	const form = dialog.querySelector("form");
	if (!(form instanceof HTMLFormElement)) throw new TypeError();
	form.querySelectorAll("button[data-poi-id]").forEach(button => button.remove());
	for (const [spotId, spot] of Object.entries(mapDefinition.pointsOfInterest)) {
		const button = document.createElement("button");
		button.type = "submit";
		button.value = `poi:${spotId}`;
		button.dataset.poiId = spotId;
		button.textContent = spot.displayName;
		form.appendChild(button);
	}
}

/**
 * @param {string} [message]
 */
async function requestPositionPick(message) {
	if (!pickDialog || !pickFailedDialog || !pickDialog || !pickConfirmDialog) throw new TypeError();
	const mapDefinition = await getMapDefinition();
	populatePoiButtons(pickDialog, mapDefinition);
	await showDialog(pickDialog, { message: message, isModel: false });
	console.log("result is", pickDialog.returnValue, typeof pickDialog.returnValue, !pickDialog.returnValue);

	const spotId = pickDialog.returnValue.startsWith("poi:")
		? pickDialog.returnValue.slice("poi:".length)
		: null;
	if (spotId) {
		const spot = mapDefinition.pointsOfInterest[spotId];
		if (!spot) throw new TypeError();
		return spotToPosition(spot);
	}
	if (!pickDialog.returnValue) {
		console.log("canceled");
		return null;
	}
	console.log("pick dialog confirmed");
	const result = await pickPositionOnce();
	if (!result) {
		await showDialog(pickFailedDialog);
		if (pickFailedDialog.returnValue) return await requestPositionPick(...arguments);
		return null;
	}
	const indicator = createPointIndicator(result, 0xffffff, 5);
	scene.add(indicator);
	await showDialog(pickConfirmDialog, { message: `你选择了 ${result.toArray().join(",")}`, isModel: false });
	scene.remove(indicator);
	switch (pickConfirmDialog.returnValue) {
		case "confirm":
			return result;
		case "retry":
			return await requestPositionPick(...arguments);
	}
	return null;
}
/**
 * @param {HTMLElement} button 
 * @param {Function} task
 */
async function lockButtonAndRun(button, task) {
	button.style.visibility = "hidden";
	await task();
	button.style.visibility = "visible";
}
/**
 * @param {Element?} button 
 * @param {()=>Promise<*>} task
 * @returns {asserts button is HTMLButtonElement}
 */
function bindButton(button, task) {
	if (!button || !(button instanceof HTMLButtonElement)) throw new TypeError();
	button.addEventListener("click", async () => {
		await lockButtonAndRun(button, task);
	});
}
addEventListener(CustomEventName.POSITION_PICK, (/** @type {any} */event) => {
	console.log("pick", event.detail.position);
});

const startButton = querySelector("button#startNav");
const navStartDialog = querySelector("dialog#navStart");
const navInProgressDialog = querySelector("dialog#navInProgress");
bindButton(startButton, toggleNavPanel);
async function toggleNavPanel() {
	const position = await requestPositionPick("现在选择起点。");
	if (!position) return;
	const startPointIndicator = createPointIndicator(position, 0x4CAF50, 5, "起");
	scene.add(startPointIndicator);
	let warmUpStopFlag = false;
	(async () => {
		for await (const _warmUpResult of warmUp(position)) {
			if (warmUpStopFlag) break;
		}
	})();
	await showDialog(navStartDialog, { message: `已选择起点：${position.toArray()}`, isModel: false });
	const cleanUp = async () => {
		scene.remove(startPointIndicator);
		warmUpStopFlag = true;
		await new Promise(requestAnimationFrame);
		aStarSearchFootprintIndicatorGroup.clear();
	};
	if (!navStartDialog) throw new TypeError();
	if (!navStartDialog.returnValue) return cleanUp();
	switch (navStartDialog.returnValue) {
		case "pickEnd":
			const endPos = await requestPositionPick("现在选择终点。");
			if (!endPos) return cleanUp();
			const endPointIndicator = createPointIndicator(endPos, 0xF44336, 5, "终");
			scene.add(endPointIndicator);
			warmUpStopFlag = true;
			showDialog(navInProgressDialog, { isModel: false });
			await findPath(position, endPos);
			navInProgressDialog.close();
			break;
	}
}
const settings = new WebStorageItemStorage("settings", localStorage).data;

const settingsPanel = querySelector("#settingsPanel");
if (!(settingsPanel instanceof HTMLDialogElement)) throw new TypeError();

const openSettings = querySelector("#openSettings");
if (!(openSettings instanceof HTMLButtonElement)) throw new TypeError();
bindButton(openSettings, async () => showDialog(settingsPanel));

const showMapChecker = querySelector("#showMap");
if (!(showMapChecker instanceof HTMLInputElement)) throw new TypeError();
showMapChecker.checked = settings.showMap ?? true;
showMapChecker.addEventListener("change", () => {
	settings.showMap = showMapChecker.checked;
});
showMapChecker.dispatchEvent(new InputEvent("change"));

const showAStarFootprintChecker = querySelector("#showAStarFootprint");
if (!(showAStarFootprintChecker instanceof HTMLInputElement)) throw new TypeError();
showAStarFootprintChecker.checked = settings.showAStarFootprint ?? false;
showAStarFootprintChecker.addEventListener("change", () => {
	//console.log("checked", showAStarFootprintChecker.checked);
	showAStarFootprint = showAStarFootprintChecker.checked;
	settings.showAStarFootprint = showAStarFootprintChecker.checked;
});
showAStarFootprintChecker.dispatchEvent(new InputEvent("change"));

/**
 * @param {LoadMapResult} map
 * @param {number} index
 */
function switchFloorClipIndex(map, index) {
	const elevation = map.mapConf.floorElevationByIndex[`${index}`];
	console.info("switchFloorClipIndex", floorIndexInput.value, elevation);
	clipY = elevation;
	applyClip(map.mapObject3D, new THREE.Plane(new THREE.Vector3(0, -1, 0), elevation));
}

const floorIndexInput = querySelector("input#floorIndex");

const barometerButton = querySelector("button#barometer");
bindButton(barometerButton, async () => showDialog(querySelector("dialog#barometerPanel")));

const aboutUsButton = querySelector("button#aboutUs");
const aboutUsDialog = querySelector("dialog#aboutUsDialog");
bindButton(aboutUsButton, async () => showDialog(aboutUsDialog));

addEventListener("load", async () => {
	//scene.add(scanHelper.cameraHelper);
	if (0) {
		console.info("Map disabled.");
		return;
	}
	const loadMapResult = (await loadMap(await getMapDefinition(), new THREE.Euler(/*-Math.PI / 2*/0, 0, 0), 0.5));
	Object.defineProperty(loadMapResult.mapObject3D, "visible", {
		get() {
			return showMapChecker.checked;
		}
	});
	floorIndexInput.addEventListener("input", () => {
		//console.log("Displaying floor index", floorIndexInput.value);
		switchFloorClipIndex(loadMapResult, floorIndexInput.valueAsNumber + 1);
	});
	renderer.setAnimationLoop(() => {
		renderer.render(scene, camera);
	});
	viewGlobal(false);
	//await findPath(new THREE.Vector3(0, 10, 90), new THREE.Vector3(50, 10, 350));//一层测试
	//地下室路口坐标 -60, 30, -530; 100, 30, -530
	//await findPath(new THREE.Vector3(100, 30, -530), new THREE.Vector3(-200, 40, 200));//地下测试
	//await findPath(new THREE.Vector3(100, 30, -530), new THREE.Vector3(80, 30, -530));//地下短距
	/*const start = new THREE.Vector3(0, 20, -20);
	scene.add(createPointIndicator(start, 0x0000ff, 5));
	await findPath(start, new THREE.Vector3(15, 20, 50));*/
	//测试坐标：299,58,-130;45,58,-70
});

Object.assign(globalThis, {
	debugInsights: {
		settings
	}
});
