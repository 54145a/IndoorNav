//@ts-check
import * as THREE from "three";
/** @typedef {"straight"|"turn"|"stairs"|"arrive"} InstructionType */

/**
 * @typedef {{
 * 	type: InstructionType,
 * 	text: string,
 * 	position: THREE.Vector3,
 * 	distance?: number,
 * 	angle?: number,
 * }} PathInstruction
 */

/**
 * @typedef {{
 * 	stairYThreshold?: number,
 * 	stairMinStep?: number,
 * 	stairMinSlope?: number,
 * 	turnStraightMaxDeg?: number,
 * 	turnSharpDeg?: number,
 * 	turnReverseDeg?: number,
 * 	minSegmentLength?: number,
 * }} PathInstructionOptions
 */

/** 单段垂直位移超过该值直接判为楼梯段。 */
export const STAIR_Y_THRESHOLD = 12;
/** 参与“缓台阶累计判定”的单段最小垂直位移（世界单位）。 */
export const STAIR_MIN_STEP = 2;
/** 缓台阶判定：|Δy| / 水平距离 超过该斜率（rise:run 约 1:2）视为台阶步。 */
export const STAIR_MIN_SLOPE = 0.5;
/** 朝向变化小于该值（度）视为直行，并入当前直行段。 */
export const TURN_STRAIGHT_MAX_DEG = 15;
/** 朝向变化 >= 该值（度）报「左/右转」。 */
export const TURN_SHARP_DEG = 45;
/** 朝向变化 >= 该值（度）报「掉头」。 */
export const TURN_REVERSE_DEG = 150;
/** 清洗时剔除连续两点间距离小于该值的重复点。 */
export const MIN_SEGMENT_LENGTH = 1e-6;

/** @param {THREE.Vector3} a @param {THREE.Vector3} b */
function horizontalLength(a, b) {
	return Math.hypot(b.x - a.x, b.z - a.z);
}
/** @param {THREE.Vector3} a @param {THREE.Vector3} b @returns {number} 水平朝向角（度） */
function headingDegrees(a, b) {
	return Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI;
}
/**
 * 归一化到 (-180, 180] 的角度差（度）。
 * @param {number} a
 * @param {number} b
 */
function angleDeltaDegrees(a, b) {
	let delta = (a - b) % 360;
	if (delta > 180) delta -= 360;
	if (delta <= -180) delta += 360;
	return delta;
}

/**
 * @param {THREE.Vector3[]} path
 * @param {PathInstructionOptions} config
 * @returns {THREE.Vector3[]}
 */
function dedupePath(path, config) {
	const points = [];
	for (const p of path) {
		const last = points[points.length - 1];
		if (!last || p.distanceTo(last) > (config.minSegmentLength ?? MIN_SEGMENT_LENGTH)) points.push(p);
	}
	return points;
}

/**
 * @param {number} deltaDeg
 * @param {PathInstructionOptions} config
 */
function turnText(deltaDeg, config) {
	const abs = Math.abs(deltaDeg);
	if (abs >= (config.turnReverseDeg ?? TURN_REVERSE_DEG)) return "掉头";
	const left = deltaDeg < 0;
	if (abs >= (config.turnSharpDeg ?? TURN_SHARP_DEG)) return left ? "左转" : "右转";
	return left ? "左前方" : "右前方";
}

/**
 * @param {THREE.Vector3[]} path
 * @param {Partial<PathInstructionOptions>} [options]
 * @returns {PathInstruction[]}
 */
export function generatePathInstructions(path, options = {}) {
	const config = { ...options };
	const points = dedupePath(path, config);
	if (points.length < 2) {
		return points.length === 1
			? [{ type: "arrive", text: "到达终点", position: points[0].clone() }]
			: [];
	}

	/** @type {Array<{kind: "walk", points: THREE.Vector3[]} | {kind: "stairs", direction: number, points: THREE.Vector3[]}>} */
	const runs = [];
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		const dy = b.y - a.y;
		const len = horizontalLength(a, b);
		const isStair = Math.abs(dy) > (config.stairYThreshold ?? STAIR_Y_THRESHOLD)
			|| (Math.abs(dy) > (config.stairMinStep ?? STAIR_MIN_STEP) && Math.abs(dy) / len > (config.stairMinSlope ?? STAIR_MIN_SLOPE));
		const last = runs[runs.length - 1];
		if (isStair) {
			const direction = Math.sign(dy);
			if (last?.kind === "stairs" && last.direction === direction) {
				last.points.push(b);
			} else {
				runs.push({ kind: "stairs", direction, points: [a, b] });
			}
		} else if (last?.kind === "walk") {
			last.points.push(b);
		} else {
			runs.push({ kind: "walk", points: [a, b] });
		}
	}

	/** @type {PathInstruction[]} */
	const instructions = [];
	/** @type {THREE.Vector3|null} */ let straightStart = null;
	let straightDistance = 0;
	let straightHeading = 0;
	/** @type {{position: THREE.Vector3, refHeading: number}|null} */ let pendingTurnAtStairEnd = null;

	const flushStraight = () => {
		if (straightStart !== null && straightDistance > 0) {
			instructions.push({
				type: "straight",
				text: `直行 ${Math.round(straightDistance)}`,
				position: straightStart.clone(),
				distance: straightDistance
			});
		}
		straightStart = null;
		straightDistance = 0;
	};
	/**
	 * @param {THREE.Vector3} a
	 * @param {THREE.Vector3} b
	 */
	const addWalkingSegment = (a, b) => {
		const len = horizontalLength(a, b);
		const heading = headingDegrees(a, b);
		if (straightStart === null) {
			straightHeading = heading;
			straightStart = a;
		} else {
			const delta = angleDeltaDegrees(heading, straightHeading);
			if (Math.abs(delta) >= (config.turnStraightMaxDeg ?? TURN_STRAIGHT_MAX_DEG)) {
				flushStraight();
				instructions.push({ type: "turn", text: turnText(delta, config), position: a.clone(), angle: delta });
				straightHeading = heading;
				straightStart = a;
			} else {
				straightHeading = heading;
			}
		}
		straightDistance += len;
	};

	for (const run of runs) {
		if (run.kind === "walk") {
			for (let i = 0; i < run.points.length - 1; i++) {
				const a = run.points[i];
				const b = run.points[i + 1];
				if (pendingTurnAtStairEnd && i === 0) {
					const delta = angleDeltaDegrees(headingDegrees(a, b), pendingTurnAtStairEnd.refHeading);
					if (Math.abs(delta) >= (config.turnStraightMaxDeg ?? TURN_STRAIGHT_MAX_DEG)) {
						flushStraight();
						instructions.push({ type: "turn", text: turnText(delta, config), position: pendingTurnAtStairEnd.position.clone(), angle: delta });
					}
					pendingTurnAtStairEnd = null;
				}
				addWalkingSegment(a, b);
			}
			continue;
		}

		let cumulativeDy = 0;
		for (let i = 1; i < run.points.length; i++) cumulativeDy += run.points[i].y - run.points[i - 1].y;
		if (Math.abs(cumulativeDy) <= (config.stairYThreshold ?? STAIR_Y_THRESHOLD)) {
			for (let i = 0; i < run.points.length - 1; i++) addWalkingSegment(run.points[i], run.points[i + 1]);
			continue;
		}
		const hasPriorWalk = straightStart !== null;
		flushStraight();
		pendingTurnAtStairEnd = null;
		instructions.push({
			type: "stairs",
			text: cumulativeDy > 0 ? "上台阶" : "下台阶",
			position: run.points[0].clone(),
			distance: Math.abs(cumulativeDy)
		});
		if (hasPriorWalk) {
			pendingTurnAtStairEnd = { position: run.points[run.points.length - 1], refHeading: straightHeading };
		}
	}
	flushStraight();
	instructions.push({ type: "arrive", text: "到达终点", position: points[points.length - 1].clone() });
	return instructions;
}
