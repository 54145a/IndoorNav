//@ts-check
import * as THREE from "three";
import { WifiScanner } from "./wifiScanner.js";
/**
 * @typedef {import("./fingerprint.d.ts").FingerprintCell} FingerprintCell
 * @typedef {import("./fingerprint.d.ts").fingerprintDefinition} fingerprintDefinition
 * @typedef {import("./fingerprint.d.ts").WifiScanResult} WifiScanResult
 */

/** 指纹库静态资源路径（随 SPA 打包分发）。 */
const FINGERPRINT_URL = "/fingerprints.json";
/** KNN 取最近邻数量。 */
const KNN_K = 5;
/** 未观测到的 AP 在信号空间中的占位 RSSI（dBm）。 */
const MISSING_RSSI = -100;

/**
 * 加权 KNN 指纹定位：把实时扫描与指纹库比对，估计所在位置与楼层。
 * 位置坐标与指纹库、地图处于同一（自洽）坐标系，因此对地图比例失真免疫。
 * 通过 dispatchEvent 派发 "estimate" 与 "error" 事件。
 */
export class WifiLocator extends THREE.EventDispatcher {
	/**
	 * @param {WifiScanner|null} scanner 扫描源；null 表示当前环境不可用
	 */
	constructor(scanner) {
		super();
		/** 扫描源。 */
		this.scanner = scanner;
		/** 已加载的指纹参考点；未加载为 null。 */
		this.cells = null;
	}

	/**
	 * 拉取并缓存指纹库。
	 * @returns {Promise<fingerprintDefinition|null>} 加载失败或为空时为 null
	 */
	async loadFingerprints() {
		const response = await fetch(FINGERPRINT_URL);
		if (!response.ok) {
			console.warn(`指纹库加载失败：${FINGERPRINT_URL}（HTTP ${response.status}）`);
			this.cells = null;
			return null;
		}
		const data = /** @type {fingerprintDefinition} */ (await response.json());
		this.cells = data.cells ?? null;
		return data;
	}

	/**
	 * 执行一次完整定位：确保指纹库已加载 → 扫描 → 匹配。
	 * @returns {Promise<{position: THREE.Vector3, score: number}|null>}
	 * 	返回 null 表示指纹库缺失、扫描失败或无可匹配的指纹。
	 */
	async locate() {
		if (this.scanner == null) {
			this.dispatchEvent(new Event("error"));
			return null;
		}
		if (this.cells == null) await this.loadFingerprints();
		if (this.cells == null || this.cells.length === 0) {
			this.dispatchEvent(new Event("error"));
			return null;
		}
		const scan = await this.scanner.scan();
		if (scan == null || scan.length === 0) {
			this.dispatchEvent(new Event("error"));
			return null;
		}
		const result = this.estimateFromScan(scan);
		if (result) {
			this.dispatchEvent(new CustomEvent("estimate", { detail: result }));
		} else {
			this.dispatchEvent(new Event("error"));
		}
		return result;
	}

	/**
	 * 将一帧扫描结果匹配到指纹库（加权 KNN）。
	 * @param {WifiScanResult} scan
	 * @returns {{position: THREE.Vector3, score: number}|null}
	 * 	position 为地图绝对坐标（x/y/z 均为指纹库 cell 的加权平均，Y 随跨楼层区域连续变化）。
	 */
	estimateFromScan(scan) {
		if (this.cells == null || this.cells.length === 0) return null;
		const ranked = this.cells
			.map(cell => ({ cell, distance: fingerprintDistance(scan, cell) }))
			.filter(x => Number.isFinite(x.distance))
			.sort((a, b) => a.distance - b.distance);
		if (ranked.length === 0) return null;
		const neighbors = ranked.slice(0, KNN_K);
		const weighted = neighbors.map(({ cell, distance }) => ({
			cell,
			weight: 1 / (distance * distance + 1)
		}));
		const totalWeight = weighted.reduce((sum, x) => sum + x.weight, 0);
		if (totalWeight === 0) return null;
		let x = 0;
		let y = 0;
		let z = 0;
		for (const { cell, weight } of weighted) {
			x += cell.x * weight;
			y += cell.y * weight;
			z += cell.z * weight;
		}
		return {
			position: new THREE.Vector3(x / totalWeight, y / totalWeight, z / totalWeight),
			score: ranked[0].distance
		};
	}
}

/**
 * 信号空间距离：对「实时扫描 ∪ 指纹」的全部 BSSID 求 RSSI 均方根误差。
 * 仅出现在一方的 AP 以 MISSING_RSSI 占位，缺失越多距离越大。
 * @param {WifiScanResult} scan
 * @param {FingerprintCell} cell
 * @returns {number} 完全无公共 BSSID 时为 Infinity
 */
function fingerprintDistance(scan, cell) {
	const scanByMac = new Map(scan.map(ap => [ap.bssid, ap.rssi]));
	const bssids = new Set([...scanByMac.keys(), ...Object.keys(cell.macs)]);
	if (bssids.size === 0) return Infinity;
	let sumSquares = 0;
	for (const bssid of bssids) {
		const scanRssi = scanByMac.get(bssid) ?? MISSING_RSSI;
		const cellRssi = cell.macs[bssid] ?? MISSING_RSSI;
		sumSquares += (scanRssi - cellRssi) ** 2;
	}
	return Math.sqrt(sumSquares / bssids.size);
}