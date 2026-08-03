# Photos UX：触控误开、相册导航、移动端两列

**日期：** 2026-08-03  
**状态：** 已实现（待真机确认触控手感）  
**范围：** `/photos/` 列表页导航与布局、列表触控打开 overlay  
**相关：** `docs/plans/2026-08-03-photos-r2-perf-and-layout.md`（性能/变体，本期不重做）

---

## 1. 背景与问题

| # | 现象 | 根因（已核对代码） |
|---|------|-------------------|
| 1 | 手机滑列表时，手指碰到图就打开大图，无法正常滚动 | `photo-overlay.js` 对 `.image-link` 的 `touchend` **无位移判断**，一律 `openOverlay` |
| 2 | 顶栏相册名筛选/跳转排版难看 | 32 个相册、名称多为长文件夹名（如 `20260620-20260622马来西亚槟城`），`flex-wrap` pill 堆叠占高、难扫 |
| 3 | 两列布局在移动端不正常 | `grid2fr` 固定 `repeat(2, 1fr)`，无窄屏回退；半宽 + 元数据挤爆 |

**数据现状（实现时以 `_data/photos.json` 为准）：** 约 1504 张 / 32 相册。

---

## 2. 目标与非目标

### 目标

1. **移动端可正常纵向滚动**；只有明确的 tap 才打开 overlay。
2. **相册导航可读、可点、少占高**：按年分组 + 年内横滑；展示短标签，完整名放 `title`。
3. **窄屏强制单列**；桌面仍可切换单列 / 两列。

### 非目标（本期不做）

- 真·过滤（只渲染某一相册的 DOM）
- 去掉桌面布局开关（仅移动端隐藏）
- 改 overlay 内手势（左右滑切图逻辑保持）
- R2 / 变体 / 分页 / 虚拟列表
- 重命名 R2 文件夹或改 `photos.json` 源数据

---

## 3. 决策（默认采用，实现按此执行）

| 议题 | 决策 |
|------|------|
| 相册导航 | **方案 A**：按年分组 + 年内 chips 横向滚动；短标签 + `title` 全名 |
| 短标签格式 | `MM/DD · 地点` 或区间 `MM/DD–MM/DD · 地点`（见 §5.2 解析规则） |
| 布局开关 | **桌面保留**；`≤720px` **隐藏开关并强制单列**（CSS 覆盖 `data-layout`） |
| 触控阈值 | 移动距离 **> 10px** 视为滚动，不打开；仅近似 tap 打开 |

---

## 4. 影响文件

| 文件 | 改动 |
|------|------|
| `assets/photo-overlay.js` | P0 触控阈值；可选：导航短标签增强（若 Liquid 不够） |
| `photos.html` | 相册 nav 按年结构；section 标题可用短名或保留全名 |
| `assets/new.scss` | nav 样式；窄屏单列；移动端隐藏 layout controls |
| `_layouts/default.html` | 仅当需要时微调 layout controls 的 class/aria（尽量 CSS 隐藏） |
| `_data/i18n_copy.yml` | 如需「年份 / 相册」文案键则补 en-US + zh-CN |

**不改：** `_data/photos.json`、R2 脚本、overlay 大图加载策略。

---

## 5. 分步实现计划

### Step 0 — 基线确认

- [x] 记下当前 `photos.html` nav / album section 结构
- [x] 记下 `photo-overlay.js` 中 `touchend` / `click` 绑定段
- [x] 记下 `.photos-wrapper[data-layout="grid2fr"]` 与 `.photo-album-nav` 相关 SCSS 行号

**验证：** 本地能打开 `/photos/`（已有 `./start` 或 build 即可）。

---

### Step 1 — P0：列表触控误开（必须先做）

**文件：** `assets/photo-overlay.js`

**做法：**

1. 在 link 绑定处增加：
   - `touchstart`：记录 `clientX/clientY`（`changedTouches[0]` 或 `touches[0]`）
   - `touchmove`（可选）：标记 `moved` 若位移超阈值
   - `touchend`：计算相对 `touchstart` 的 `Δx`、`Δy`；若 `Math.hypot(Δx, Δy) > TAP_MOVE_THRESHOLD`（**10**）则 **return**，不 `openOverlay`
2. 仅当未判定为滚动时：
   - `justHandledTouch = true`
   - `preventDefault` + `openFromLinkEvent`
3. 保留现有 `click` 逻辑：`justHandledTouch` 时吞掉合成 click，避免双开
4. 桌面鼠标路径不变（仅 `click`）

**注意：**

- 不要用 `passive: false` 去 `preventDefault` 整个页面滚动；只在判定为 **tap 且要打开** 时 `preventDefault`
- 阈值 10px 为默认；若仍误触可调到 12–15，写入本文件 implementation-notes

**验证：**

- [x] 代码审查：位移阈值 + 滚动后不卡死 `justHandledTouch`（见 Implementation notes）
- [ ] 手机/模拟器：手指在图上滑动列表 → **不**开 overlay（真机待确认）
- [ ] 轻点图 → 打开 overlay（真机待确认）
- [x] 桌面点击路径保留（逻辑未删）
- [x] 打开后左右滑切图逻辑未改（stage 绑定独立）

---

### Step 2 — P1a：窄屏强制单列 + 隐藏布局开关

**文件：** `assets/new.scss`（主）；必要时 `_layouts/default.html` 加 class

**做法：**

1. 在 `@media (max-width: 720px)`（与站点现有窄屏断点习惯一致）：
   ```scss
   [data-page-type="photos"] .photo-layout-controls {
     display: none;
   }

   .photos-wrapper[data-layout="grid2fr"] .photo-album-grid {
     grid-template-columns: 1fr;
     // gap 可略收：row-gap / column-gap
   }
   ```
2. 确保单列时 `img` / `.image-link` 仍 `width: 100%` 合理，不与现有 `max-height: calc(100vh * …)` 媒体查询打架；若冲突，在同断点内把 `grid2fr` 的图样式对齐 `y-scroll` 全宽行为
3. 桌面（`>720px`）行为不变：单列 / 两列切换仍可用

**验证：**

- [x] `@media (max-width: 720px)` 强制 `1fr` 并隐藏 `.photo-layout-controls`
- [x] 桌面 `grid2fr` 规则仍为 `repeat(2, 1fr)`（断点外不变）
- [ ] 真机/DevTools 目视单列与元数据（建议本地 `./start` 扫一眼）

---

### Step 3 — P1b：相册导航按年 + 横滑 + 短标签

**文件：** `photos.html`、`assets/new.scss`；短标签若 Liquid 难解析则 `photo-overlay.js` 轻量增强

#### 3.1 结构（Liquid）

目标 DOM 示意：

```html
<nav class="photo-album-nav" aria-label="…">
  <div class="photo-album-year" data-year="2026">
    <span class="photo-album-year-label">2026</span>
    <div class="photo-album-year-scroller" role="list">
      <a class="photo-album-nav-link" role="listitem" href="#album-N"
         title="完整相册名" data-album-raw="完整相册名">短标签 <span class="photo-album-nav-count">N</span></a>
      …
    </div>
  </div>
  <!-- 按年重复；年顺序：与当前 group 遍历顺序一致（已是 uploaded reverse 的 first-seen） -->
</nav>
```

实现要点：

1. 仍用现有 `photo_groups = photos_sorted | group_by_exp: "photo", "photo.meta.album"`
2. 遍历 `photo_groups` 时用 `group.name | slice: 0, 4` 作为 year（相册名约定 `YYYY…`；非数字 year 归入 `Other` 或原样）
3. year 变化时关闭上一 scroller、开启新 year block
4. `href="#album-{{ forloop.index }}"` 与下方 section `id` **保持同一 index**（勿因分组破坏 index）
5. Section 标题：可显示 **短标签** 为主标题，`title`/副文保留全名；或标题仍全名、仅 nav 短标签。**推荐：nav 短标签 + section 标题全名**（避免列表里看不懂），全名过长时 section 允许 wrap

#### 3.2 短标签解析规则

相册名约定（与 R2 文件夹一致）：

| 原始 | 展示 |
|------|------|
| `20240728西湖` | `07/28 · 西湖` |
| `20260419-黄山` | `04/19 · 黄山` |
| `20260620-20260622马来西亚槟城` | `06/20–06/22 · 马来西亚槟城` |
| `20250822-20251207德泽家园` | `08/22–12/07 · 德泽家园` |
| 无法匹配 | 原名（可 CSS 截断） |

**正则（JS 或构建时思维模型）：**

```text
^(\d{4})(\d{2})(\d{2})(?:-(\d{4})(\d{2})(\d{2}))?-?(.*)$
```

- 有第二段日期 → `MM/DD–MM/DD · place`
- 仅第一段 → `MM/DD · place`
- `place` 为空 → 仅日期部分

**实现选择（按简单优先）：**

1. **优先**：在 `photo-overlay.js` 初始化时，对 `.photo-album-nav-link[data-album-raw]` 重写可见文本（保留 count span），`title` 设为 raw。Liquid 只输出 raw + count。
2. **备选**：纯 Liquid `slice` 拼短标签（脆弱，仅在 JS 不可用时考虑）。

采用 **1**，保证无 JS 时仍有可用全名链接。

#### 3.3 样式

```scss
.photo-album-nav { /* 取消或弱化大面积 wrap 堆叠 */ }
.photo-album-year {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: …;
  align-items: center;
  margin-bottom: …;
}
.photo-album-year-label {
  font-family: var(--monospace);
  font-size: …;
  color: var(--mutedTextColor);
}
.photo-album-year-scroller {
  display: flex;
  flex-wrap: nowrap;
  gap: …;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  // 可选：两侧轻微 mask 提示可滑
}
.photo-album-nav-link {
  flex: 0 0 auto;
  max-width: min(14rem, 70vw); // 防极长地名
  // 内部文本 ellipsis 如需要
}
```

**验证：**

- [x] 构建产物：32 个 `photo-album-nav-link`，8 个 `photo-album-year` 块
- [x] `href="#album-N"` 与 section `id` 同源 index
- [x] JS 短标签重写；无 JS 时仍为全名 + 正确锚点
- [x] 未新增 i18n key；`check:i18n` 随 `check:all` 通过

---

### Step 4 — 收尾与自检

- [x] `JEKYLL_ENV=production bundle exec jekyll build` 通过
- [x] `npm run check:all` 通过
- [ ] 桌面：两列切换、打开 overlay 目视（建议 `./start`）
- [ ] 移动宽度：单列、可滚、tap 打开、nav 横滑（真机）
- [x] 本文件勾选 Step 0–3，并追加 **Implementation notes**

---

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 阈值过大导致难点开 | 10px 起步；真机微调 |
| 相册名不满足 `YYYYMMDD` 约定 | 回退显示原名 |
| year `slice: 0,4` 非年份 | 归入 `Other` 或单独一行 |
| CSS 强制单列与 JS `data-layout` 不一致 | 仅视觉强制；不改 JS 存储，避免复杂度 |
| 横滑与页面竖滑手势竞争 | scroller 仅横向；不 `preventDefault` 竖滑 |

**回滚：** 按文件 git revert；P0 可单独 cherry-pick 保留。

---

## 7. 验收清单（Definition of Done）

1. 移动端在照片列表上滑动 **不会** 误开大图；轻点会打开。  
2. 相册导航按年分组、年内可横滑，长名不再整页刷屏。  
3. ≤720px 始终单列，布局开关隐藏；>720px 两列模式可用。  
4. 生产 build + 既有 check 通过。  
5. 本 plan 的 Step 勾选 + Implementation notes 已写。

---

## 8. Implementation notes

**实现日期：** 2026-08-03  

**改动文件：**

- `assets/photo-overlay.js` — 列表 tap 阈值；相册 nav 短标签
- `assets/new.scss` — 年份横滑 nav；≤720px 单列 + 隐藏布局开关
- `photos.html` — 按年分组的 nav DOM

**偏差 / 细节：**

1. **触控：** 使用 per-link 的 `linkTouchStartX/Y`，避免与 overlay stage 滑动状态共用。阈值 **10px**。滚动手势也会短暂置 `justHandledTouch`，但 **400ms 后自动清零**，避免挡住下一次真点击（实现时相对计划的补强）。
2. **短标签：** 计划中的 JS 方案（Liquid 输出全名 + `data-album-raw`，运行时改写）。正则与计划一致。
3. **年份：** 直接用名称前 4 字符；当前数据均为 `YYYY…`，构建结果 **8 个 year 块 / 32 相册**。未做 `Other` 桶。
4. **Section 标题：** 仍显示全名（按计划推荐）。

**验证：**

- `JEKYLL_ENV=production bundle exec jekyll build` PASS  
- `npm run check:all` PASS  
- `_site/photos/index.html`：`photo-album-year` ×8，`data-album-raw` ×32  

**待真机：** 滑动不误开、轻点打开、横滑 chips 手感。
