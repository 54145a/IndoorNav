/** 单次扫描中观测到的单个 Wi-Fi 接入点（AP）。 */
export type WifiApReading = {
	/** AP 的 BSSID（MAC），接入点的唯一标识；指纹采集与定位时二者必须同源。 */
	bssid: string,
	/** SSID；隐藏 SSID 或未知时可为空字符串。 */
	ssid?: string,
	/** 信号强度，单位 dBm（-100～0）。 */
	rssi: number
};

/** 一帧 Wi-Fi 扫描结果：视野内所有 AP 的读数列表。 */
export type WifiScanResult = WifiApReading[];

/**
 * 指纹参考点：在已知地图坐标处观测到的「BSSID → RSSI」表。
 * 坐标为地图中的绝对坐标（x/y/z），与地图（map.obj / map.mapMeta）处于同一（可能失真但自洽）坐标系。
 * 使用绝对坐标后，楼梯等跨越楼层的区域也能连续表示，不再依赖离散的楼层编号。
 */
export type FingerprintCell = {
	/** 地图 X 坐标。 */
	x: number,
	/** 地图 Y 坐标（绝对高程，取值与地图模型表面/点位坐标一致）。 */
	y: number,
	/** 地图 Z 坐标。 */
	z: number,
	/** BSSID → RSSI（dBm）。 */
	macs: { [bssid: string]: number }
};

/** 指纹库文件（public/fingerprints.json）的整体结构。 */
export type fingerprintDefinition = {
	/** 指纹库版本号，供以后迁移/升级。 */
	version: string,
	/** 采集到的全部指纹参考点。 */
	cells: FingerprintCell[]
};