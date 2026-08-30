# legacy — GPU 扫描寻路（已冻结）

这是被 nav mesh 方案取代之前的寻路实现快照，**此后不再维护**。

它基于 Three.js 离屏渲染逐点扫描（`ScanHelper.hasGround` / `hasObstacle`）做可走性判断，再用双向 A* 找路径。

## 运行

```bash
pnpm install
pnpm dev
```

本目录**不含模型文件**（`map.obj` / `map.mtl` 在上一级 `public/`）。运行时请把模型放到本目录的 `public/` 下，并确认 `src/map.mapMeta.js` 中的楼层数据与之匹配。

## 与当前主分支的关系

- `src/main.js` — 寻路仍内联在 `//#region 寻路 Pathfinding` 中，调用点散布在 UI 流程里（`toggleNavPanel` 等）。
- `src/scanBasedAStar.js` — 扫描式可走性判断 + A* 本体，可独立发布供社区改进。
