//@ts-check
/**
 * Wi-Fi 扫描数据源。项目自身不编写任何原生模块：
 * Android 上经 @codext/capacitor-wifi 插件扫描（scanWifi 原生返回 bssid + level）；
 * PC 调试用 Mock。
 * @typedef {import("./fingerprint.d.ts").WifiApReading} WifiApReading
 * @typedef {import("./fingerprint.d.ts").WifiScanResult} WifiScanResult
 */

/**
 * 抽象 Wi-Fi 扫描源：提供「带 RSSI（尽力含 BSSID）的一帧扫描结果」。
 * 一切实现（原生插件、调试 mock）都应继承本类。
 */
export class WifiScanner {
	/**
	 * 扫描一次并返回视野内的 AP 列表。
	 * @returns {Promise<WifiScanResult|null>} 扫描不可用或权限被拒时为 null
	 */
	async scan() {
		throw new TypeError("WifiScanner.scan not implemented");
	}
}

/**
 * 基于 @codext/capacitor-wifi 的 Android 原生扫描源。
 * scanWifi() 内部完成权限申请 → 触发系统扫描 → 等待结果，BSSID 与信号强度开箱即用；
 * 系统节流导致 startScan 失败时自动回退到最近一次扫描缓存。
 */
export class CodextWifiScanner extends WifiScanner {
	async scan() {
		const { Wifi } = await import("@codext/capacitor-wifi");
		const result = await Wifi.scanWifi();
		/** @type {WifiApReading[]} */
		const readings = [];
		for (const wifi of result?.wifis ?? []) {
			if (typeof wifi.level !== "number") continue;
			const bssid = typeof wifi.bssid === "string" ? wifi.bssid : null;
			if (!bssid) continue;
			readings.push({
				bssid,
				ssid: typeof wifi.ssid === "string" ? wifi.ssid : "",
				rssi: wifi.level
			});
		}
		return readings;
	}
}

/**
 * 供 PC 调试的固定扫描数据源：返回预设的一帧扫描结果。
 */
export class MockWifiScanner extends WifiScanner {
	/**
	 * @param {WifiScanResult|null} [scan] 固定返回的扫描结果
	 */
	constructor(scan = null) {
		super();
		/** 固定的扫描结果。 */
		this.fixedScan = scan;
	}
	async scan() {
		return this.fixedScan;
	}
}

/**
 * 根据运行环境选择可用的扫描源：
 * - Android（Capacitor 原生）→ @codext 插件扫描；
 * - 其余环境 → 若调试者注入了 window.mockWifiScanner 则使用之，否则不可用。
 * scanWifi() 仅 Android 可用，故 iOS 上不返回插件扫描源。
 * @returns {WifiScanner|null}
 */
export function resolveDefaultScanner() {
	const capacitor = /** @type {any} */ (globalThis).Capacitor;
	if (capacitor?.getPlatform?.() === "android") {
		return new CodextWifiScanner();
	}
	const mock = /** @type {any} */ (globalThis).mockWifiScanner;
	if (mock && typeof mock.scan === "function") return mock;
	return null;
}
