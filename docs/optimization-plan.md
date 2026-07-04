# 站点整体优化规划

> 2026-07-03 · 覆盖范围：首页照片轮播重设计、背景效果系统（樱花 / 星空银河 / 天气）逻辑梳理、全局统一与代码质量。

## 0. 现状盘点（问题清单）

### 背景效果系统
1. **两套判断标准混用**：氛围层（樱花 vs 星空）由 Open-Meteo 的 `is_day`（杭州当地昼夜）决定，但页面底色由用户设备的 `prefers-color-scheme` 决定。错位场景：
   - 深色模式用户在白天访问 → 粉色樱花飘在近黑背景上，突兀；
   - 浅色模式用户在夜里访问 → 白色星星落在 `#FDFEFB` 近白背景上，几乎不可见。
2. **闪电的判断标准又是另一套**：雷暴时闪电只看 `prefers-color-scheme: dark`，与氛围层的 `is_day` 标准不一致。
3. **职责耦合**：`weather.js` 既负责数据获取/缓存，又直接操作 `window.__sakuraFallMounted` / `window.__starFieldMounted` 全局句柄；`site.js` 里还有一份同样的挂载/销毁逻辑。同一件事两处代码，改动容易漏。
4. **死代码**：`new.scss` 中 `--sakuraEnabled` / `--starFieldEnabled` 两个 CSS 变量无任何消费方。
5. 用户切换系统深浅色时，除闪电外的效果不会即时重算（樱花会留在深色背景上直到下一次 15 分钟轮询）。

### 首页照片轮播（.photo-carousel-stage）
1. **空间模型模糊**：当前是「堆叠渐隐」——prev/next 以 ±6px 偏移半透明叠在 active 后面，看不出前后顺序，切换时只是透明度交换，没有方向感。
2. **无进度指示**：不知道一共几张、当前第几张、什么时候切换。
3. **桌面端不可控**：没有任何切换控件，鼠标用户只能等 4.5s 自动播放；hover 还会暂停，等于永远停在当前张。
4. **拖拽反馈弱**：触摸拖动只有 0.35 阻尼的「橡皮筋」，画面不跟手，松手后也不是朝拖动方向滑出，而是原地渐隐换图。
5. 整个组件是一个 `<a>`，无法在内部放合法的按钮控件。

### 全局统一 / 代码
1. 首页出现内联样式：CV 占位链接 `style="pointer-events:none; color:#999"`（硬编码颜色，深色模式下对比错误）、空状态 `<em style="opacity:0.65">`，中英文两份首页重复。
2. 动效参数（缓动、时长）散落各处，无统一 token。
3. 加载策略整体已经不错（自托管字体 + 按需 import + 生产环境 idle 注入追踪脚本），无需大动。

## 1. 背景效果系统：目标决策矩阵

**原则：画布决定氛围层，天气决定叠加层。**
氛围效果（樱花/星空）对底色敏感，必须跟随实际渲染的画布（`prefers-color-scheme`）；天气效果是「正在发生的事」，跟随真实天气。手机普遍日落后自动切深色模式，所以「深色 ≈ 夜晚」在多数情况下依然成立，浪漫感不丢。

| 条件 | 浅色模式 | 深色模式 | 叠加关系 |
|---|---|---|---|
| 晴 / 多云（clear） | 樱花 | 星空 + 银河 + 流星 + 狮子座 | 单独（氛围层） |
| 雾（fog） | 樱花 + 雾霭 | 星空 + 雾霭 | **叠加**：雾是半透明纱层，盖在氛围层上方 |
| 雨（rain） | 仅雨 | 仅雨 | **替换**：降水时氛围层卸载（雨天没有飘樱花/满天星） |
| 雪（snow） | 仅雪 | 仅雪 | **替换**：同上 |
| 雷暴（thunderstorm） | 仅雨 | 雨 + 闪电 | **替换**：闪电白闪只在深色画布上可读，浅色模式省略 |

其它规则：
- 用户切换深浅色 → 立即以当前天气重算整套效果（不等轮询）。
- `is_day` 保留在数据层（未来可用于文案/密度调节），不再决定氛围层选择。
- `prefers-reduced-motion` 语义不变：各效果模块内部自行降级/禁用。
- 层级约定（保持现状并写成注释）：天气画布 z=0（内容之后）、内容 z=1、樱花 z=2（花瓣飘在内容前是有意为之）、闪电闪光 z=2 且 DOM 靠后。

**实现方式**：新增 `assets/background-effects.js` 作为唯一的「效果编排器」，持有所有挂载句柄；`weather.js` 退化为纯数据模块（fetch + 缓存 + code→condition 映射）；`site.js` 只做 `getWeather() → syncBackgroundEffects(condition) + 文案更新`。删除 SCSS 死变量。

## 2. 轮播重设计：方向明确的滑动画廊

**设计目标**：空间关系清晰（横向滑动、有方向）、状态可见（圆点进度 + 自动播放进度条）、全端可控（桌面箭头 / 触摸跟手滑动 / 键盘方向键）、失败安全（无 JS 时仍显示第一张，整体仍可点击进入 /photos）。

### 结构
```html
<div class="photo-carousel" data-photo-carousel>
  <a class="photo-carousel-link" href="/photos" ...>   <!-- 语义：整体仍是入口链接 -->
    <div class="photo-carousel-stage"> <img ×10 /> </div>
  </a>
  <!-- 以下由 JS 注入，无 JS 时不存在 -->
  <button class="photo-carousel-arrow --prev"/> <button class="--next"/>
  <div class="photo-carousel-dots"> <button ×N /> </div>
</div>
```
外层从 `<a>` 改为 `<div>`，箭头/圆点是链接的兄弟节点 → HTML 合法（不再有交互元素嵌套在 `<a>` 里）。

### 交互
- **滑动模型**：active 居中，prev/next 分别停在舞台外左右两侧（`--carousel-w` 由 ResizeObserver 维护），切换时 transform 平移，方向与操作一致。
- **触摸**：1:1 跟手拖拽（非阻尼），松手按位移阈值（40px）或速度（>0.5px/ms）判定翻页，否则弹回；拖拽期间取消 transition；拖拽后抑制一次 click 防误导航。
- **桌面**：hover 显示左右箭头；hover 暂停自动播放（进度条同步冻结）；方向键翻页。
- **进度**：底部圆点，active 圆点拉长为胶囊并有随自动播放计时的填充动画；点击圆点直达。
- **自动播放**：4.5s，交互后延迟恢复，页面隐藏时暂停（沿用现有逻辑）。
- **降级**：`prefers-reduced-motion` → 无自动播放、切换退化为淡入淡出；无 JS → 显示 Liquid 输出的第一张（`is-active`），无控件。

### 涉及文件
`assets/home-photo-carousel.js`（重写）、`assets/new.scss`（轮播段重写）、`index.html` / `index-zh-CN.html`（外层结构调整、`sizes` 更新为新的最大展示宽度）。

## 3. 全局统一（小步、安全）

1. 内联样式收敛为类：`.disabled-link`（用主题变量替代硬编码 `#999`）、`.empty-hint`（替代 `style="opacity:0.65"`），两份首页同步。
2. 在 `:root` 增加动效 token：`--ease-out-spring`、`--duration-slide` 等，新轮播率先使用，后续动效逐步迁移。
3. 删除 `--sakuraEnabled` / `--starFieldEnabled` 死变量；给背景各层加 z-index 注释说明层级契约。

## 4. 实施步骤与状态

> 2026-07-03 全部完成并推送 `main`，对应提交见「提交」列。

| 步骤 | 内容 | 状态 | 提交 |
|---|---|---|---|
| 1 | 输出本规划文档 | ✅ 完成 | `cf61d3c` docs(plan) |
| 2 | 轮播重写（JS + SCSS + 两份首页结构） | ✅ 完成 | `98a9ac0` feat(home-photo-carousel) |
| 3 | 背景编排器 `background-effects.js`；`weather.js` 瘦身；`site.js` 接线 | ✅ 完成 | `c0d2e89` refactor(background-effects) |
| 4 | 全局统一小修（内联样式、死变量、token） | ✅ 完成 | 并入 `98a9ac0` |
| 5 | 本地 Jekyll 构建 + 浏览器验证（浅/深色、模拟各天气、触摸/键盘） | ✅ 完成 | 结果见第 5 节 |

**尚未完成 / 待办：**

1. **线上部署后回归**（唯一剩余项）：本轮所有验证均在本地 Jekyll 环境完成，Vercel 部署后建议快速过一遍第 5 节清单里的轮播交互、天气文案，以及 AVIF `<picture>` 在线上 CDN 下的实际命中情况。

（第 6 节的三个可选项已于 2026-07-03 在 `273632f` 中补充完成，见第 6 节。）

## 5. 验证清单

- [x] `JEKYLL_ENV=production bundle exec jekyll build` 无错误（2026-07-03）
- [x] 轮播：箭头/圆点切换、圆点跳转走最短方向、键盘方向键、`--carousel-w` 随 ResizeObserver 更新、控件带中英文 aria-label（自动播放在隐藏标签页正确挂起，符合预期）
- [x] 深色模式 = 星空，浅色模式 = 樱花，与 `is_day` 解耦
- [x] 伪造天气缓存验证：rain → 仅雨 + 文案「正下着雨」；fog → 星空 + 雾纱叠加；thunderstorm + 深色 → 雨 + 闪电；clear + 浅色 → 樱花
- [x] 深浅色切换即时重算：通过直接调用 `syncBackgroundEffects` 验证矩阵；真实浏览器走 matchMedia change 事件 + 页面重新可见时的兜底检查（预览工具的 CDP 模拟不派发 change 事件，无法端到端复现，属工具限制）
- [x] `prefers-reduced-motion`：轮播无自动播放且切换退化为淡入淡出；樱花/雨雪/闪电停止动画；星空停止闪烁并取消/恢复流星计时（2026-07-03 补充自动化验证）
- [x] zh-CN 首页与英文首页行为一致（375px 移动视口下亦验证）

## 6. 后续可选（2026-07-03 补充完成）

- [x] 追踪脚本体积审计：新增 `npm run perf:audit-tracking`，报告写入 `docs/perf/tracking-scripts.json`；当前 tracking 脚本合计 132,124 B raw / 36,759 B gzip，除 `page-tracking.js` 外均为 production idle-deferred 或页面条件加载。
- [x] 轮播 / 照片页图片改用 `<picture>` + AVIF：生成器为 thumbnail / preview / large 同步输出 WebP fallback 与 AVIF source，首页轮播和 `/photos/` 页面优先提供 AVIF。
- [x] 星空按月份切换当季星座：春 Leo、夏 Cygnus、秋 Pegasus、冬 Orion，沿用现有星座 SVG 样式和 reduced-motion 降级。

## 7. Code review 与修复（2026-07-04）

对 `0f1f899..HEAD` 做了 8 角度多 Agent 审查：26 个候选 → 20 项验证存活（19 CONFIRMED / 1 PLAUSIBLE / 0 误报）。前 10 项（按严重度）已全部修复：

1. 背景编排器改为「先并行 import、成功后再拆旧层」，失败不再留空白背景；页面重新可见时无条件重放幂等矩阵（顺带修复模块串行加载）。
2. 轮播悬停/焦点暂停改为显式状态并在计时器触发时复查，交互不再覆盖暂停；focusout 增加 `document.hasFocus()` 守卫。
3. perf 报告新增 `image_src_basis` 字段，compare 在 webp/avif 口径不一致时显式警告（此前 23KB「优化」实为口径切换）。
4. 甩动检测改用手势末段 120ms 窗口速度 + 16px 最小位移；reduce-motion 开启时回到第一张；恰好 2 张照片时邻居按行进方向停靠；点击抑制回归「click 消费 + 1500ms 兜底」；4500ms 常量收敛为单一来源（JS 写入 `--carousel-interval`）；首页 `sizes` 回调至 320px。

同批完成轮播布局调整：照片与章节标题左对齐，箭头从图面浮层移到照片下方的 `‹ 圆点 ›` 控制行（解决左对齐后箭头超出栏宽的问题，触屏端也获得可见控件）。

**遗留（已确认、低严重度，未修）**：两份首页轮播块抽取为 `_includes` partial；AVIF 编码管线与 WebP 去重并改为对称 schema + 增量跳过；audit 脚本与 measure 脚本共享报告脚手架；全站 6 份手写 reduced-motion 监听收敛为公共 helper；touchmove 写 `--drag` 可加 rAF 节流；氛围层 window 全局与 overlays map 统一注册表；`weather.js` 的 `isDay` 死数据管线（保留系有意，见第 1 节）。
