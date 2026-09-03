//#region 
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { signal } from "@preact/signals";
import { render, type JSX } from "preact";

import "./App.css";
import { WebStorageItemStorage } from "@54145a/storage2/storage.js";
import { ScanBasedPathfinder } from "./scanBasedAStar.js";
import { NavMeshPathfinder } from "./navMeshPathfinder.js";
import { generatePathInstructions } from "./pathInstructions.js";
import { WifiLocator } from "./wifiLocator.js";
import { resolveDefaultScanner } from "./wifiScanner.js";

type FingerprintCell = import("./fingerprint.d.ts").FingerprintCell;
type WifiScanResult = import("./fingerprint.d.ts").WifiScanResult;
type ScenicSpot = import("./mapDefinition.d.ts").ScenicSpot;
type MapDefinition = import("./mapDefinition.d.ts").mapDefinition;
type PathInstruction = import("./pathInstructions.js").PathInstruction;
type ReachableNodeFoundEvent = import("./scanBasedAStar.js").ReachableNodeFoundEvent;
type InstructionItem =
	| { kind: "text"; text: string }
	| { kind: "spot"; spot: ScenicSpot; spotId: string };

/** 路径指引面板的内容项。 */
const instructionItems = signal<InstructionItem[]>([]);
/** 路径指引面板是否可见。 */
const instructionPanelVisible = signal(false);
/** 「指引」切换按钮是否可见（仅在面板被关闭后出现）。 */
const instructionToggleVisible = signal(false);
/** 楼层滑块当前值。 */
const floorSliderValue = signal(0);
/** 楼层滑块旁显示的输出文本。 */
const floorOutput = signal("0");



//#region 组件

/** 菜单容器：固定定位 flex 栏。 */
function Menu(props: { id?: string; children?: any }) {
	return <div id={props.id} class="menu">{props.children}</div>;
}

/** 侧边菜单容器：纵向、垂直居中。 */
function MenuSide(props: { id?: string; children?: any }) {
	return <div id={props.id} class="menu-side menu">{props.children}</div>;
}

/** 菜单按钮：`<button><div>图标</div>文字</button>`，图标放大。 */
function MenuButton(props: { id?: string; icon: string; label: string; hidden?: boolean; onClick?: () => void }) {
	return (
		<button id={props.id} hidden={props.hidden} onClick={props.onClick}>
			<div>{props.icon}</div>{props.label}
		</button>
	);
}

/** 原生 dialog 包装：统一基础样式。 */
function BaseDialog(props: { id: string; children?: any }) {
	return (
		<dialog id={props.id}>
			{props.children}
		</dialog>
	);
}

/** dialog 底部提交区：`<form method="dialog">`（按钮隐式提交即关闭并返回 value）。 */
function DialogForm(props: { children?: any }) {
	return <form method="dialog">{props.children}</form>;
}

/** dialog 内按钮。`type` 默认 "submit"（配合 method=dialog 自动关闭）；带自定义行为的按钮传 `type="button"` + onClick。 */
function DialogButton(props: { id?: string; value?: string; type?: "submit" | "button"; onClick?: (event: MouseEvent) => void; children?: any }) {
	return (
		<button id={props.id} value={props.value} type={props.type ?? "submit"} onClick={props.onClick}>
			{props.children}
		</button>
	);
}

//#endregion

//#region 场景 Scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(innerWidth, innerHeight);
renderer.localClippingEnabled = true;
camera.aspect = innerWidth / innerHeight;

document.body.appendChild(renderer.domElement);

const labelScene = new THREE.Scene();
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.sortObjects = false;
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.top = "0";
labelRenderer.domElement.style.left = "0";
labelRenderer.domElement.style.pointerEvents = "none";
document.body.appendChild(labelRenderer.domElement);

addEventListener("resize", () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(innerWidth, innerHeight);
	labelRenderer.setSize(innerWidth, innerHeight);
});

const mapScene = new THREE.Scene();

const axesHelper = new THREE.AxesHelper(100);
scene.add(axesHelper);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
mapScene.add(new THREE.AmbientLight(0xffffff));
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
scene.add(directionalLight);

function processMesh(object: THREE.Object3D, func: (object: THREE.Material) => void) {
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
function applyDoubleSide(object: THREE.Object3D) {
	const processSingleMaterial = (material: THREE.Material) => {
		material.side = THREE.DoubleSide;
	};
	return processMesh(object, processSingleMaterial);
}
function applyClip(object: THREE.Object3D, plane: THREE.Plane) {
	return processMesh(object, m => m.clippingPlanes = [plane]);
}

function createPointIndicator(pos: THREE.Vector3, color: number = 0xffffff, size: number = 2, label?: string): THREE.Object3D {
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

/** 仅创建锥形标记（不含文字），用于 POI 的空间锚点。 */
function createConeMarker(pos: THREE.Vector3, color: number = 0xffa500, size: number = 5): THREE.Group {
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
	group.position.copy(pos);
	return group;
}

/** 由 POI 标签 DOM 元素映射回对应的 ScenicSpot */
const poiLabelToSpot = new WeakMap<Element, ScenicSpot>();
/** 拾取模式下本次点击是否发生在 POI 标签上（pointerdown 时设置，click 时消费） */
let suppressPoiDetailOnClick = false;

/** 创建 POI 的 DOM 标签（CSS2DObject），点击弹出详情。样式用对象式 style 设置。 */
function createPoiLabel(spot: ScenicSpot): CSS2DObject {
	const element = document.createElement("div");
	element.className = "poi-label";
	const baseStyle: JSX.CSSProperties = {
		pointerEvents: "auto",
		cursor: "pointer",
		background: "rgba(0, 0, 0, 0.6)",
		color: "#fff",
		padding: "2px 6px",
		borderRadius: "3px",
		whiteSpace: "nowrap",
		fontSize: "13px"
	};
	Object.assign(element.style, baseStyle);
	element.textContent = spot.displayName;
	poiLabelToSpot.set(element, spot);
	element.addEventListener("pointerdown", () => {
		suppressPoiDetailOnClick = isPicking;
	});
	element.addEventListener("click", () => {
		if (suppressPoiDetailOnClick) {
			suppressPoiDetailOnClick = false;
			return;
		}
		showPoiDetail(spot);
	});
	element.addEventListener("mouseenter", () => {
		element.style.background = "rgba(0, 0, 0, 0.8)";
	});
	element.addEventListener("mouseleave", () => {
		element.style.background = "rgba(0, 0, 0, 0.6)";
	});
	const label = new CSS2DObject(element);
	label.position.set(...spot.position);
	label.position.y += 20;
	return label;
}

interface LoadMapResult {
	mapObject3D: THREE.Object3D;
	mapConf: MapDefinition;
}

async function loadMap(mapDefinition: MapDefinition, rotation: THREE.Euler = new THREE.Euler(0, 0, 0), scale: number = 1): Promise<LoadMapResult> {
	let sceneObject3D: THREE.Object3D | undefined;
	let mapSceneObject3D: THREE.Object3D | undefined;
	const loadObj = (objLoader: OBJLoader, targetScene: THREE.Scene) => new Promise<void>(resolve => {
		objLoader.load(`/${mapDefinition.name}.obj`, (object) => {
			object.rotation.copy(rotation);
			object.scale.setScalar(scale);
			applyDoubleSide(object);
			targetScene.add(object);
			if (targetScene === scene) sceneObject3D = object;
			else mapSceneObject3D = object;
			resolve();
		});
	});
	await Promise.all([
		new Promise<void>((resolve) => {
			const objLoader = new OBJLoader();
			const mtlLoader = new MTLLoader();
			mtlLoader.load(`/${mapDefinition.name}.mtl`, (mtl) => {
				mtl.preload();
				objLoader.setMaterials(mtl);
				resolve();
			}, undefined, (e) => {
				console.warn(e);
				resolve();
			});
		}).then(() => loadObj(new OBJLoader(), scene)),
		loadObj(new OBJLoader(), mapScene)
	]);
	for (const spot of Object.values(mapDefinition.pointsOfInterest)) {
		scene.add(createConeMarker(new THREE.Vector3(...spot.position)));
		labelScene.add(createPoiLabel(spot));
	}
	return {
		mapObject3D: sceneObject3D ?? new THREE.Object3D(),
		mapConf: mapDefinition
	};
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.minDistance = 5;

let showAStarFootprint = THREE.Object3D.prototype.visible;

//#endregion
//#region 寻路 Pathfinding
const PATH_GEN_STEP_LENGTH = 10;
const SCAN_RADIUS = PATH_GEN_STEP_LENGTH * 2;
const PATH_GEN_DEBUG_LOG = true;
const scanPathfinder = new ScanBasedPathfinder({ mapScene, scanRadius: SCAN_RADIUS, stepLength: PATH_GEN_STEP_LENGTH });
const navMeshPathfinder = new NavMeshPathfinder({ navMeshUrl: "/map.navmesh.bin" });
const settings = new WebStorageItemStorage("settings", localStorage).data;
const pathfinder = settings.useNavMesh ? navMeshPathfinder : scanPathfinder;

//#region 寻路可视化 Pathfinding visualization
const aStarSearchFootprintIndicatorGroup = new THREE.Group();
Object.defineProperty(aStarSearchFootprintIndicatorGroup, "visible", {
	get() {
		return showAStarFootprint;
	}
});
scene.add(aStarSearchFootprintIndicatorGroup);

const pathIndicatorGroup = new THREE.Group();
scene.add(pathIndicatorGroup);

/** 判定「沿途地点」时，POI 与路径的水平距离阈值。 */
const LOCATION_NEAR_RADIUS = 60;

function spotsNearPath(path: THREE.Vector3[]): Array<{ spotId: string; spot: ScenicSpot }> {
	const pois = loadedMapResult?.mapConf.pointsOfInterest;
	if (!pois) return [];
	/** @type {Array<{spotId: string, spot: ScenicSpot}>} */
	const found: Array<{ spotId: string; spot: ScenicSpot }> = [];
	for (const [spotId, spot] of Object.entries(pois)) {
		for (const point of path) {
			if (Math.hypot(spot.position[0] - point.x, spot.position[2] - point.z) <= LOCATION_NEAR_RADIUS) {
				found.push({ spotId, spot });
				break;
			}
		}
	}
	return found;
}

/** 位置沿路径的累计水平弧长（吸附到最近路径顶点），用于沿途排序。 */
function progressAlongPath(path: THREE.Vector3[], pos: THREE.Vector3): number {
	if (path.length === 0) return 0;
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < path.length; i++) {
		const d = Math.hypot(path[i].x - pos.x, path[i].z - pos.z);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	let length = 0;
	for (let i = 1; i <= best; i++) length += path[i].distanceTo(path[i - 1]);
	return length;
}

/**
 * 展示路径指引：路段指令为普通文本、沿途地点为可点击卡片，按沿路径顺序混合。
 */
function showPathInstructions(instructions: PathInstruction[], path: THREE.Vector3[] = []) {
	const items: Array<
		{ kind: "text"; text: string; progress: number }
		| { kind: "spot"; spot: ScenicSpot; spotId: string; progress: number }
	> = [];
	for (const instruction of instructions) {
		items.push({ kind: "text", text: instruction.text, progress: progressAlongPath(path, instruction.position) });
	}
	for (const { spotId, spot } of spotsNearPath(path)) {
		items.push({ kind: "spot", spotId, spot, progress: progressAlongPath(path, spotToPosition(spot)) });
	}
	items.sort((a, b) => a.progress - b.progress);
	const normalized: InstructionItem[] = items.map(item => item.kind === "text"
		? { kind: "text", text: item.text }
		: { kind: "spot", spot: item.spot, spotId: item.spotId });
	instructionItems.value = normalized;
	instructionPanelVisible.value = true;
	instructionToggleVisible.value = false;
}

function createArrowIndicator(start: THREE.Vector3, end: THREE.Vector3, gapScale: number = 0.1, color: number = 0xffffff) {
	Object.freeze(start);
	Object.freeze(end);
	const delta = Object.freeze(end.clone().sub(start));
	if (PATH_GEN_DEBUG_LOG) console.log("delta", delta);
	const arrow = new THREE.ArrowHelper(delta.clone().normalize(), start.clone(), delta.length() * (1 - gapScale), color, 5, 5);
	return arrow;
}

function createPathArrowIndicator(start: THREE.Vector3, end: THREE.Vector3): THREE.Group {
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
	for (let i = 0; i < segmentCount; i++) {
		const currentStart = start.clone().addScaledVector(direction, i * segmentLength);
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

function addAStarFootprintIndicator(pos: THREE.Vector3, color: number) {
	const indicator = createPointIndicator(pos, color);
	aStarSearchFootprintIndicatorGroup.add(indicator);
	return indicator;
}

function onReachableNodeFound(event: ReachableNodeFoundEvent) {
	if (!showAStarFootprint) return;
	const color = event.source === "backward" ? 0x777777 : 0xffffff;
	addAStarFootprintIndicator(event.node.position, color);
}
pathfinder.addEventListener("reachableNodeFound", onReachableNodeFound);
//#endregion 寻路可视化 Pathfinding visualization

//#region 寻路算法 Pathfinding algorithm
async function findPath(startPos: THREE.Vector3, endPos: THREE.Vector3) {
	const result = await pathfinder.findPath(startPos, endPos);
	lastPath = result;
	if (result) {
		pathIndicatorGroup.add(...result.slice(0, -1).map((thisPos, i) => {
			const nextPos = result[i + 1];
			if (!nextPos) throw new TypeError();
			return createPathArrowIndicator(thisPos, nextPos);
		}));
		const instructions = generatePathInstructions(result);
		showPathInstructions(instructions, result);
		console.group("路径指引 Path instructions");
		for (const instruction of instructions) {
			console.log(`${instruction.text} @ ${instruction.position.toArray().map(n => n.toFixed(1)).join(",")}`, instruction);
		}
		console.groupEnd();
	}
	aStarSearchFootprintIndicatorGroup.clear();
}
//#endregion 寻路算法 Pathfinding algorithm
//#endregion 寻路 Pathfinding

let clipY = 10000;
let loadedMapResult: LoadMapResult | null = null;
let isPicking = false;

function parseClickPosition(event: PointerEvent, round: boolean = true): THREE.Vector3 | null {
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
} as const;
for (const name of Object.values(CustomEventName)) console.assert(name.startsWith("custom:"));

let menuRight: HTMLElement | null = null;

function pickPositionOnce(): Promise<THREE.Vector3 | null> {
	console.info("Position pick start");
	const originalMenuDisplay = menuRight?.style.display;
	if (menuRight) menuRight.style.display = "none";
	isPicking = true;
	return new Promise<THREE.Vector3 | null>((resolve, _reject) => {
		function success(event: PointerEvent) {
			console.info("Position pick succeed");
			const spot = event.target instanceof Element ? poiLabelToSpot.get(event.target) : null;
			const position = spot ? spotToPosition(spot) : parseClickPosition(event);
			if (!position) {
				console.info("Position pick empty result");
				resolve(null);
			};
			dispatchEvent(new CustomEvent(CustomEventName.POSITION_PICK, { detail: { position } }));
			resolve(position);
		}
		addEventListener("pointerdown", _e => {
			addEventListener("pointerup", success, { once: true });
		}, { once: true });
	}).finally(() => {
		isPicking = false;
		if (menuRight && originalMenuDisplay !== undefined) menuRight.style.display = originalMenuDisplay;
	});
}

function showDialog(dialog: HTMLDialogElement, options: { isModel?: boolean; message?: string } = {}): Promise<Event> {
	const { isModel = true, message } = options;
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

async function showPoiDetail(spot: ScenicSpot) {
	const dialog = document.getElementById("poiDetail") as HTMLDialogElement;
	if (!(dialog instanceof HTMLDialogElement)) throw new TypeError();
	const nameEl = dialog.querySelector(".poi-name");
	const descEl = dialog.querySelector(".poi-description");
	const floorEl = dialog.querySelector(".poi-floor");
	const posEl = dialog.querySelector(".poi-position");
	if (!(nameEl instanceof HTMLElement) || !(descEl instanceof HTMLElement)
		|| !(floorEl instanceof HTMLElement) || !(posEl instanceof HTMLElement)) throw new TypeError();
	nameEl.textContent = spot.displayName;
	descEl.textContent = spot.description ?? "（暂无描述）";
	floorEl.textContent = String(spot.floorIndex);
	posEl.textContent = spot.position.join(", ");
	await showDialog(dialog, { isModel: false });
	if (dialog.returnValue === "fromHere") {
		toggleNavPanel(spot.displayName);
	}
}

/** 默认全局视角所注视的点（一层 y≈-37） */
const DEFAULT_VIEW_POINT = new THREE.Vector3(200, -37, -100);
/** 全局楼层视角的相机高度（离注视点的距离） */
const VIEW_POINT_DISTANCE = 1500;
/** 展示单个 POI/路径节点时的相机高度 */
const VIEW_POINT_DISTANCE_POI = 350;

/** 根据一点所在楼层自动切换楼层展示范围 */
function floorIndexForPoint(point: THREE.Vector3): number {
	const elevations = loadedMapResult?.mapConf.floorElevationByIndex;
	if (!elevations) return 0;
	let bestIndex = 0;
	let bestOffset = Infinity;
	for (const [index, elevation] of Object.entries(elevations)) {
		const offset = Math.abs(elevation + point.y);
		if (offset < bestOffset) {
			bestOffset = offset;
			bestIndex = Number(index);
		}
	}
	return bestIndex;
}

/**
 * 将视角移到某一点处：相机到点保持固定的距离与方向
 * （俯视角，位于点正上方 distance 处），并依据点的楼层自动切换楼层展示范围。
 */
function viewPoint(point: THREE.Vector3, smooth: boolean = false, applyFloor: boolean = true, distance: number = VIEW_POINT_DISTANCE) {
	const targetLookAt = point.clone();
	if (applyFloor && loadedMapResult) {
		const floorIndex = floorIndexForPoint(point);
		switchFloorClipIndex(loadedMapResult, floorIndex);
		syncFloorSlider(floorIndex);
	}
	const targetPosition = targetLookAt.clone().add(new THREE.Vector3(0, distance, 0));
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

/** 让楼层滑块与指定楼层索引同步（索引→滑块值：index-1）。 */
function syncFloorSlider(index: number) {
	const value = index - 1;
	if (value < -1 || value > 1) return;
	floorSliderValue.value = value;
	floorOutput.value = String(value + (value >= 0 ? 1 : 0));
}

let pickDialog: HTMLDialogElement | null = null;
let pickFailedDialog: HTMLDialogElement | null = null;
let pickConfirmDialog: HTMLDialogElement | null = null;

let mapDefinitionPromise: Promise<MapDefinition> | null = null;
function getMapDefinition() {
	return mapDefinitionPromise ??= import("./map.mapMeta.js").then(m => m.default);
}

function spotToPosition(spot: ScenicSpot): THREE.Vector3 {
	return new THREE.Vector3(...spot.position);
}

/** 查找距指定位置最近的已知地点（忽略 y，只按水平 XZ 距离）。 */
function nearestSpotTo(position: THREE.Vector3): { spot: ScenicSpot; spotId: string; distance: number } | null {
	const pointsOfInterest = loadedMapResult?.mapConf.pointsOfInterest;
	if (!pointsOfInterest) return null;
	let best: { spot: ScenicSpot; spotId: string; distance: number } | null = null;
	for (const [spotId, spot] of Object.entries(pointsOfInterest)) {
		const distance = Math.hypot(spot.position[0] - position.x, spot.position[2] - position.z);
		if (!best || distance < best.distance) best = { spot, spotId, distance };
	}
	return best;
}

/** 若某位置附近有已知地点，返回「在某地点附近」的文本；否则返回 null。 */
function nearestSpotDescription(position: THREE.Vector3): string | null {
	const nearest = nearestSpotTo(position);
	if (!nearest) return null;
	return `${nearest.spot.displayName} 附近`;
}

function populatePoiDatalist(dialog: HTMLDialogElement, mapDefinition: MapDefinition) {
	const input = dialog.querySelector("input#poiSearch");
	if (!(input instanceof HTMLInputElement)) throw new TypeError();
	input.value = "";
	const datalist = dialog.querySelector("datalist");
	if (!(datalist instanceof HTMLDataListElement)) throw new TypeError();
	datalist.replaceChildren();
	for (const [spotId, spot] of Object.entries(mapDefinition.pointsOfInterest)) {
		const option = document.createElement("option");
		option.value = spot.displayName;
		option.textContent = `${spot.displayName}（${spotId}）${spot.description ? `— ${spot.description}` : ""}`;
		datalist.appendChild(option);
	}
	input.addEventListener("input", () => {
		const spot = resolveSpot(mapDefinition, input.value.trim());
		if (spot) viewPoint(spotToPosition(spot), true, true, VIEW_POINT_DISTANCE_POI);
	}, { once: true });
}

function resolveSpot(mapDefinition: MapDefinition, query: string): ScenicSpot | null {
	for (const [spotId, spot] of Object.entries(mapDefinition.pointsOfInterest)) {
		if (spot.displayName === query || spotId === query) return spot;
	}
	return null;
}

async function requestPositionPick(message?: string, initialValue?: string): Promise<THREE.Vector3 | null> {
	if (!pickDialog || !pickFailedDialog || !pickConfirmDialog) throw new TypeError();
	const mapDefinition = await getMapDefinition();
	populatePoiDatalist(pickDialog, mapDefinition);
	if (initialValue) {
		const input = pickDialog.querySelector("input#poiSearch");
		if (input instanceof HTMLInputElement) input.value = initialValue;
	}
	const closePromise = showDialog(pickDialog, { message: message, isModel: false });
	if (initialValue) {
		const selectButton = pickDialog.querySelector('button[value="poi"]');
		if (selectButton instanceof HTMLButtonElement) selectButton.focus();
	}
	await closePromise;
	console.log("result is", pickDialog.returnValue, typeof pickDialog.returnValue, !pickDialog.returnValue);

	if (pickDialog.returnValue === "poi") {
		const input = pickDialog.querySelector("input#poiSearch");
		if (!(input instanceof HTMLInputElement)) throw new TypeError();
		const spot = resolveSpot(mapDefinition, input.value.trim());
		if (!spot) {
			await showDialog(pickFailedDialog, { message: `没有找到地点“${input.value}”。`, isModel: false });
			if (pickFailedDialog.returnValue) return await requestPositionPick(message, initialValue);
			return null;
		}
		const spotPos = spotToPosition(spot);
		return spotPos;
	}
	if (!pickDialog.returnValue) {
		console.log("canceled");
		return null;
	}
	console.log("pick dialog confirmed");
	const result = await pickPositionOnce();
	if (!result) {
		await showDialog(pickFailedDialog, { message: "你没有选择任何位置。", isModel: false });
		if (pickFailedDialog.returnValue) return await requestPositionPick(message, initialValue);
		return null;
	}
	const indicator = createPointIndicator(result, 0xffffff, 5);
	scene.add(indicator);
	const nearText = nearestSpotDescription(result);
	const confirmMessage = nearText ? `你选择了 ${result.toArray().join(",")}（${nearText}）` : `你选择了 ${result.toArray().join(",")}`;
	const copyButton = pickConfirmDialog.querySelector("button#copyCoord");
	if (copyButton instanceof HTMLButtonElement) {
		copyButton.addEventListener("click", async () => {
			const coords = result.toArray().join(",");
			await navigator.clipboard.writeText(coords);
			const originalText = copyButton.textContent;
			copyButton.textContent = `已复制 ${coords}`;
			setTimeout(() => { copyButton.textContent = originalText; }, 1500);
		}, { once: true });
	}
	await showDialog(pickConfirmDialog, { message: confirmMessage, isModel: false });
	scene.remove(indicator);
	switch (pickConfirmDialog.returnValue) {
		case "confirm":
			return result;
		case "retry":
			return await requestPositionPick(message, initialValue);
	}
	return null;
}
addEventListener(CustomEventName.POSITION_PICK, (event: any) => {
	console.log("pick", event.detail.position);
});

let navStartDialog: HTMLDialogElement | null = null;
let navInProgressDialog: HTMLDialogElement | null = null;

async function toggleNavPanel(initialValue?: string) {
	const position = await requestPositionPick("现在选择起点。", initialValue);
	if (!position) return;
	const startPointIndicator = createPointIndicator(position, 0x4CAF50, 5, "起");
	scene.add(startPointIndicator);
	let warmUpStopFlag = false;
	(async () => {
		for await (const _warmUpResult of pathfinder.warmUp(position)) {
			if (warmUpStopFlag) break;
		}
	})();
	if (!navStartDialog) throw new TypeError();
	await showDialog(navStartDialog, { message: `已选择起点：${position.toArray()}`, isModel: false });
	const cleanUp = async () => {
		scene.remove(startPointIndicator);
		warmUpStopFlag = true;
		await new Promise(requestAnimationFrame);
		aStarSearchFootprintIndicatorGroup.clear();
	};
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

/** 显示地图开关（map 可见性 getter 读取此变量）。 */
let showMap = settings.showMap ?? true;

function applyShowMap(value: boolean) {
	showMap = value;
	settings.showMap = value;
}

function applyShowAStarFootprint(value: boolean) {
	showAStarFootprint = value;
	settings.showAStarFootprint = value;
}

function applyUseNavMesh(value: boolean) {
	settings.useNavMesh = value;
}

function applyUseWifiLoc(value: boolean) {
	settings.useWifiLoc = value;
}

/** 可用的 Wi-Fi 扫描源（Android 插件 / PC mock），当前环境不可用为 null。 */
const wifiScanner = resolveDefaultScanner();
/** Wi-Fi 指纹定位器；仅当设置开启且扫描源可用时创建。 */
const wifiLocator = settings.useWifiLoc && wifiScanner ? new WifiLocator(wifiScanner) : null;

//#region Wi-Fi 指纹定位
let wifiStatusDialog: HTMLDialogElement | null = null;

/** 定位结果的常驻地图标记；每次定位复用同一标记。 */
let wifiLocateMarker: THREE.Object3D | null = null;

/** 在当前环境做一次 Wi-Fi 指纹定位：展示「你在这里」标记并移动视角。 */
async function toggleWifiLocate() {
	if (!wifiLocator) {
		await showDialog(wifiStatusDialog, { message: "Wi-Fi 指纹定位不可用：需 Android 环境，并在设置中开启「Wi-Fi 指纹定位(需刷新)」。" });
		return;
	}
	if (!loadedMapResult) {
		await showDialog(wifiStatusDialog, { message: "地图尚未加载完成，请稍后再试。" });
		return;
	}
	const data = await wifiLocator.loadFingerprints();
	if (!data) {
		await showDialog(wifiStatusDialog, { message: "指纹库缺失或加载失败（public/fingerprints.json）。" });
		return;
	}
	showDialog(navInProgressDialog, { message: "正在扫描附近 Wi-Fi…", isModel: false });
	let result: { position: THREE.Vector3; score: number } | null;
	try {
		result = await wifiLocator.locate();
	} catch (error) {
		console.error("Wi-Fi 定位异常。", error);
		result = null;
	} finally {
		navInProgressDialog.close();
	}
	if (!result) {
		await showDialog(wifiStatusDialog, { message: "定位失败：请确认 Wi-Fi 与系统位置服务已开启、位置权限已授予，并处于指纹库覆盖范围内。" });
		return;
	}
	const estimated = result.position;
	if (wifiLocateMarker) scene.remove(wifiLocateMarker);
	wifiLocateMarker = createPointIndicator(estimated, 0x00e5ff, 6, "你");
	scene.add(wifiLocateMarker);
	viewPoint(estimated, true, true);
	const coords = estimated.toArray().map(n => n.toFixed(1)).join(",");
	const nearText = nearestSpotDescription(estimated);
	const floorHint = floorIndexForPoint(estimated);
	await showDialog(wifiStatusDialog, { message: `定位到（约 ${floorHint} 层）：(${coords})${nearText ? `（${nearText}）` : ""}`, isModel: false });
}
//#endregion

//#region 指纹采集
const FINGERPRINT_CELLS_KEY = "fingerprintCells";
/** 每个指纹点采集时连续扫描的帧数（取均值抗噪）。 */
const COLLECT_FRAMES = 3;

/** 指纹点存储 */
const fingerprintCellsStorage = new WebStorageItemStorage(FINGERPRINT_CELLS_KEY, localStorage);
const fingerprintCellsData: { cells?: FingerprintCell[] } = fingerprintCellsStorage.data;
if (!Array.isArray(fingerprintCellsData.cells)) fingerprintCellsData.cells = [];
/** 当前会话缓存的采集指纹点（保持数组引用不变，变更自动持久化）。 */
const fingerprintCells: FingerprintCell[] = fingerprintCellsData.cells;

/** 将多帧扫描逐 AP 取均值，合并为一帧指纹读数（BSSID → 平均 RSSI）。 */
function averageFrames(frames: WifiScanResult[]): { [bssid: string]: number } {
	const samples: Map<string, number[]> = new Map();
	for (const frame of frames) {
		for (const ap of frame) {
			if (!ap.bssid) continue;
			const list = samples.get(ap.bssid);
			if (list) list.push(ap.rssi);
			else samples.set(ap.bssid, [ap.rssi]);
		}
	}
	const averaged: { [bssid: string]: number } = {};
	for (const [bssid, rssis] of samples) {
		averaged[bssid] = Math.round(rssis.reduce((a, b) => a + b, 0) / rssis.length);
	}
	return averaged;
}

/** 采集当前位置指纹：点选位置 → 连续扫描数帧取均值 → 存入本地缓存。 */
async function collectCurrentFingerprint() {
	if (!wifiScanner) {
		await showDialog(wifiStatusDialog, { message: "当前环境无 Wi-Fi 扫描能力，无法采集。" });
		return;
	}
	const position = await pickPositionOnce();
	if (!position) return;
	const pickIndicator = createPointIndicator(position, 0xffffff, 5);
	scene.add(pickIndicator);
	showDialog(navInProgressDialog, { message: `正在扫描（位置 ${position.x},${position.y},${position.z}）…`, isModel: false });
	const frames: WifiScanResult[] = [];
	for (let i = 0; i < COLLECT_FRAMES; i++) {
		const scan = await wifiScanner.scan();
		if (scan && scan.length > 0) frames.push(scan);
	}
	navInProgressDialog.close();
	scene.remove(pickIndicator);
	if (frames.length === 0) {
		await showDialog(wifiStatusDialog, { message: "扫描失败：未采集到任何 AP，请检查 Wi-Fi 与位置权限。" });
		return;
	}
	const cell = {
		x: Math.round(position.x),
		y: Math.round(position.y),
		z: Math.round(position.z),
		macs: averageFrames(frames)
	};
	fingerprintCells.push(cell);
	const apCount = Object.keys(cell.macs).length;
	await showDialog(wifiStatusDialog, { message: `已采集指纹点 #${fingerprintCells.length}（@ ${cell.x},${cell.y},${cell.z}，${apCount} 个 AP）。` });
}

/** 导出指纹库为可下载的 fingerprints.json。 */
async function exportFingerprints() {
	if (fingerprintCells.length === 0) {
		await showDialog(wifiStatusDialog, { message: "还没有采集指纹点，无从导出。" });
		return;
	}
	const json = JSON.stringify({ version: "1", cells: fingerprintCells }, null, "\t");
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = "fingerprints.json";
	anchor.click();
	URL.revokeObjectURL(url);
	await showDialog(wifiStatusDialog, { message: `已导出 ${fingerprintCells.length} 个指纹点（fingerprints.json）。` });
}

/** 清空缓存的采集指纹点。 */
async function clearFingerprints() {
	fingerprintCells.length = 0;
	await showDialog(wifiStatusDialog, { message: "已清空缓存的指纹点。" });
}
//#endregion

/** 切换楼层裁剪层（楼层索引 → 对应标高）。 */
function switchFloorClipIndex(map: LoadMapResult, index: number) {
	const elevation = map.mapConf.floorElevationByIndex[`${index}`] ?? 0;
	console.info("switchFloorClipIndex", index, elevation);
	clipY = elevation;
	applyClip(map.mapObject3D, new THREE.Plane(new THREE.Vector3(0, -1, 0), elevation));
}

addEventListener("load", async () => {
	if (0) {
		console.info("Map disabled.");
		return;
	}
	const loadMapResult = (await loadMap(await getMapDefinition(), new THREE.Euler(0, 0, 0), 0.5));
	loadedMapResult = loadMapResult;
	Object.defineProperty(loadMapResult.mapObject3D, "visible", {
		get() {
			return showMap;
		}
	});
	renderer.setAnimationLoop(() => {
		renderer.render(scene, camera);
		labelRenderer.render(labelScene, camera);
	});
	viewPoint(DEFAULT_VIEW_POINT, false, false);
});

/** 最近一次 findPath 的原始路径点（供调试） */
let lastPath: THREE.Vector3[] | null = null;

Object.assign(globalThis, {
	debugInsights: {
		settings,
		camera() {
			return { position: camera.position.toArray(), target: controls.target.toArray() };
		},
		loadedMap() {
			if (!loadedMapResult) return null;
			const bbox = new THREE.Box3().setFromObject(loadedMapResult.mapObject3D);
			return {
				position: loadedMapResult.mapObject3D.position.toArray(),
				bbox: { min: bbox.min.toArray(), max: bbox.max.toArray() },
				floorElevations: loadedMapResult.mapConf.floorElevationByIndex,
				pointsOfInterest: loadedMapResult.mapConf.pointsOfInterest
			};
		},
		pathArrows() {
			return pathIndicatorGroup.children.map(o => ({ type: o.type, pos: o.position.toArray(), visible: o.visible }));
		},
		lastPath: () => lastPath,
		async runFindPath(start: number[], end: number[]) {
			await findPath(new THREE.Vector3(...start), new THREE.Vector3(...end));
			return lastPath;
		},
		async closestPoint(x: number, y: number, z: number) {
			return (await navMeshPathfinder.closestPoint(new THREE.Vector3(x, y, z)))?.toArray() ?? null;
		},
		surfaceYAt(x: number, z: number) {
			if (!loadedMapResult) return null;
			const raycaster = new THREE.Raycaster(
				new THREE.Vector3(x, 1000, z),
				new THREE.Vector3(0, -1, 0),
				0, 2000
			);
			const hits = raycaster.intersectObject(loadedMapResult.mapObject3D, true);
			return hits.map(h => h.point.y).sort((a, b) => a - b);
		},
		sceneObjects() {
			const out: Array<{ name: string; type: string; pos: number[]; visible: boolean }> = [];
			scene.traverse(obj => {
				if (obj.name) out.push({ name: obj.name, type: obj.type, pos: obj.position.toArray(), visible: obj.visible });
			});
			return out;
		},
		mapMeshes() {
			if (!loadedMapResult) return null;
			const meshes: Array<{ name: string; yMin: number; yMax: number; triangles: number }> = [];
			loadedMapResult.mapObject3D.traverse(child => {
				if (!(child instanceof THREE.Mesh)) return;
				const box = new THREE.Box3().setFromObject(child);
				const index = child.geometry.index;
				meshes.push({
					name: child.name,
					yMin: +box.min.y.toFixed(1),
					yMax: +box.max.y.toFixed(1),
					triangles: index ? index.count / 3 : child.geometry.attributes.position.count / 3
				});
			});
			return meshes;
		}
	}
});

/** 挂载完成后，按 ID 绑定 DOM 引用到本地变量。 */
function bindUiRefs() {
	menuRight = document.getElementById("menu-right") as HTMLDivElement;
	pickDialog = document.getElementById("pickDialog") as HTMLDialogElement;
	pickFailedDialog = document.getElementById("pickFailed") as HTMLDialogElement;
	pickConfirmDialog = document.getElementById("pickConfirm") as HTMLDialogElement;
	navStartDialog = document.getElementById("navStart") as HTMLDialogElement;
	navInProgressDialog = document.getElementById("navInProgress") as HTMLDialogElement;
	wifiStatusDialog = document.getElementById("wifiStatus") as HTMLDialogElement;
}

/** 根组件：渲染全部 DOM 外壳（菜单、对话框、设置、楼层滑块、路径指引面板）。 */
export default function App() {
	return (
		<>
			<Menu id="menu-top">
				<MenuButton id="toggleInstructions" icon="🧾" label="指引"
					hidden={!instructionToggleVisible.value}
					onClick={() => { instructionPanelVisible.value = true; instructionToggleVisible.value = false; }} />
				<MenuButton id="startNav" icon="🧭" label="导航" onClick={() => void toggleNavPanel()} />
				<MenuButton id="openSettings" icon="⚙️" label="设置" onClick={() => void showDialog(document.getElementById("settingsPanel") as HTMLDialogElement)} />
				<MenuButton id="aboutUs" icon="ℹ️" label="关于" onClick={() => void showDialog(document.getElementById("aboutUsDialog") as HTMLDialogElement)} />
			</Menu>
		<MenuSide id="menu-left">
			<div class="floor-controls">
				<label>楼层<br />
					<input type="range" id="floorIndex"
						class="floor-slider"
						min="-1" max="1" value={floorSliderValue.value}
						onInput={(event) => {
							const value = event.currentTarget.valueAsNumber;
							floorSliderValue.value = value;
							floorOutput.value = String(value + (value >= 0 ? 1 : 0));
							if (loadedMapResult) switchFloorClipIndex(loadedMapResult, value + 1);
						}} />
				</label>
				<output id="floor-output">{floorOutput.value}</output>
			</div>
			</MenuSide>
			<MenuSide id="menu-right">
				<MenuButton icon="🗺" label="全局" onClick={() => viewPoint(DEFAULT_VIEW_POINT, true, false)} />
				<MenuButton id="positioning" icon="📍" label="定位" onClick={() => void toggleWifiLocate()} />
			</MenuSide>

			<BaseDialog id="settingsPanel">
				<details>
					<summary>临时设置（刷新重置）</summary>
				</details>
				<details>
					<summary>一般设置</summary>
				</details>
				<details>
					<summary>调试选项</summary>
					<label>显示地图 <input type="checkbox" id="showMap"
						checked={settings.showMap ?? true}
						onInput={(event) => applyShowMap(event.currentTarget.checked)} /></label>
					<label>显示寻路搜索点云 <input type="checkbox" id="showAStarFootprint"
						checked={settings.showAStarFootprint ?? false}
						onInput={(event) => applyShowAStarFootprint(event.currentTarget.checked)} /></label>
					<label>使用导航网格(需刷新) <input type="checkbox" id="useNavMesh"
						checked={settings.useNavMesh ?? false}
						onInput={(event) => applyUseNavMesh(event.currentTarget.checked)} /></label>
					<hr />
					<label>Wi-Fi 指纹定位(需刷新) <input type="checkbox" id="useWifiLoc"
						checked={settings.useWifiLoc ?? false}
						onInput={(event) => applyUseWifiLoc(event.currentTarget.checked)} /></label>
					<p>
						<button type="button" id="collectFingerprint" onClick={() => void collectCurrentFingerprint()}>采集当前位置指纹</button>
						<button type="button" id="exportFingerprints" onClick={() => void exportFingerprints()}>导出指纹库 JSON</button>
						<button type="button" id="clearFingerprints" onClick={() => void clearFingerprints()}>清空缓存的指纹点</button>
					</p>
				</details>
				<DialogForm><DialogButton>关闭</DialogButton></DialogForm>
			</BaseDialog>

			<BaseDialog id="aboutUsDialog">
				<p>由Three.js驱动。</p>
				<p>此版本仅供内部评估。</p>
				<DialogForm><DialogButton>关闭</DialogButton></DialogForm>
			</BaseDialog>

			<BaseDialog id="poiDetail">
				<h3 class="poi-name"></h3>
				<span class="poi-description"></span><br />
				楼层：<span class="poi-floor"></span><br />
				坐标：<span class="poi-position"></span>
				<DialogForm>
					<DialogButton value="fromHere">从这里出发</DialogButton>
					<DialogButton value="">关闭</DialogButton>
				</DialogForm>
			</BaseDialog>

			<BaseDialog id="pickDialog">
				<div class="message"></div>
				<p>输入关键词搜索地点，或点击“自定义地点”在地图中手动选择。</p>
				<input id="poiSearch" list="poiList" placeholder="搜索地点名称/编号/描述…" />
				<datalist id="poiList"></datalist>
				<DialogForm>
					<DialogButton value="poi">选择该地点</DialogButton>或<DialogButton value="start">自定义地点</DialogButton><br />
					<DialogButton value="">取消</DialogButton>
				</DialogForm>
			</BaseDialog>

			<BaseDialog id="pickConfirm">
				<article>
					<div class="message"></div>
					<DialogForm>
						<DialogButton value="confirm">确定</DialogButton>
						<DialogButton id="copyCoord" type="button">复制坐标</DialogButton>
						<DialogButton value="retry">重新选择</DialogButton>
						<DialogButton value="">取消</DialogButton>
					</DialogForm>
				</article>
			</BaseDialog>

			<BaseDialog id="pickFailed">
				<div class="message"></div>
				<DialogForm>
					<DialogButton value="resume">重新选择</DialogButton>
					<DialogButton value="">取消</DialogButton>
				</DialogForm>
			</BaseDialog>

			<BaseDialog id="navStart">
				<div class="message"></div>
				<DialogForm>
					<DialogButton value="">敬请期待</DialogButton>
					<DialogButton value="pickEnd">自定义位置</DialogButton>
				</DialogForm>
			</BaseDialog>

			<BaseDialog id="navInProgress">
				<div class="message"></div>
				<progress></progress>
			</BaseDialog>

			<BaseDialog id="wifiStatus">
				<div class="message"></div>
				<DialogForm><DialogButton>关闭</DialogButton></DialogForm>
			</BaseDialog>

		<div id="instructionPanel"
			hidden={!instructionPanelVisible.value}>
			<header>
				<strong>路径指引</strong>
				<button id="closeInstructions" title="关闭"
					onClick={() => { instructionPanelVisible.value = false; instructionToggleVisible.value = true; }}>✕</button>
			</header>
			<div id="instructionList">
				{instructionItems.value.map((item) => item.kind === "text"
					? <p>{item.text}</p>
					: (
						<button type="button" title={item.spotId}
							onClick={() => viewPoint(spotToPosition(item.spot), true, true, VIEW_POINT_DISTANCE_POI)}>
							<span>{item.spot.displayName}</span><br />
							<small>{item.spot.description ?? `楼层 ${item.spot.floorIndex}`}</small>
						</button>
					)
				)}
			</div>
		</div>
		</>
	);
}

const solidRoot = document.querySelector("#solid-root") ?? document.body;
render(<App />, solidRoot);
bindUiRefs();
