# Photos × Afilmory：两档资源、CSS 瀑布流与按需原图计划

**日期：** 2026-08-04
**状态：** 实现基本完成，待真实环境/Vercel 手测（Phase 1–2 与两档 schema 已落地；Rev5 部署 = encode-on-deploy 产出站点内 thumb；Phase 0 正式浏览器矩阵 / Phase 3 条件升级 / Phase 4 窗口化仍开放；§6 部分量化项本地可证、网络项待手测）
**范围：** `/photos/`、首页 Photos 区块、照片清单/构建脚本、灯箱和其缩略栏。静态 Jekyll + 原生 JavaScript/CSS；仅借鉴 Afilmory 的资源职责与加载原则，不复制其产品组件或架构。

## Revision 2 / 2026-08-04

本修订取代此前尚未执行的四档变体、全量 gallery 虚拟化、三档上传流水线及“可见数 + 10”缩略栏窗口化设想。原因是 Afilmory 的实际契约是 `thumbnailUrl + originalUrl + thumbHash`（可选 `ogImageUrl`），不存在真实独立的 `preview/large`；本站首期应先以最少的两种真实文件验证性能，避免为单次用途引入框架、图标库、状态层或过早抽象。新版 schema 直接切换，不兼容旧字段：writer、reader 与模板只使用 canonical `thumbnail` 和 `original`，停止 `preview/large`。

原计划仍可由本文件 Git 历史追溯；本轮仅更新计划，所有复选框均保持未执行状态。


## Revision 5 / 2026-08-04 — 对齐 Afilmory 部署模型

用户纠正：Afilmory **默认不把缩略图写回 R2**；thumb 进站点静态目录（`public/thumbnails`），随 SPA 部署。本站对应：

| Afilmory | 本站 |
| --- | --- |
| `public/thumbnails/*.jpg` | `images/photos/variants/*-thumb.webp` |
| manifest 相对路径 `/thumbnails/…` | `variants.thumbnail.src` = `/images/photos/variants/…` |
| original 在对象存储 | original 仍在 `img.bazinga.ink`（只读） |
| builder 在构建时产出 thumb | **`build:site` / Vercel 跑 `photos:build-variants`（缺则编码）** |

已改回：

- `package.json` `build:site` 与 `vercel.json`：**encode missing**（非 prebuilt-only）
- R2 upload **仅** `--upload` 显式开启；默认不写 R2
- CI 默认 concurrency 8、webp effort 2（加速）；本机缺图增量复用磁盘缓存
- `photos:build-variants:prebuilt` 保留给本机已有全量 thumb 时的快速 hydrate

Afilmory 全量构建约 ~10 分钟量级；本站 1504 张冷启动更长，**增量**（磁盘已有 thumb 时）接近 hydrate-only。干净 Vercel 仍会全量下载+编码，可用更高并发；不依赖 R2 Write。


## Revision 4 / 2026-08-04

用户确认按 §8 九条推荐实施。核心拍板：
1. Schema：`variants.thumbnail` + `variants.original`，停用 preview/large
2. Thumbs 预生成；部署 prebuilt-only，干净 Vercel 不默认全量 encode
3. 保留相册分组；搜索为相册/文件名跳转；CSS 瀑布流首发

## Revision 3 / 2026-08-04

对照本地 Afilmory 源码（`/Users/zhangyouxiu/Downloads/Code/afilmory`）后补充：①「对照 Afilmory 源码」事实表；②「待确认决策 → 明确推荐」决议草案。正文精神与 Phase 复选框不变；仅对 schema 路径等不准确处加短更正注。实施前仍等用户拍板。

## 1. 成功定义与非目标

- 每项只有一张派生的 **720px WebP** `thumbnail` 和既有 `original`。`original` 是现有源资产，不是本期生成档。
- 首页、`/photos/` CSS 瀑布流、灯箱底栏和灯箱的初始占位只用 thumbnail；只有当前灯箱主图按需请求 original。不开灯箱时原图请求数为 0，不预取无关原图。
- 先保留 1504 个静态照片节点，利用 CSS 瀑布流、现有 `content-visibility` 和图片 `loading="lazy"`；仅当 1504 DOM 基线失败，才分批渲染（建议首批 60、每批 40）。只有缩略栏基线失败，才窗口化当前项附近的缩略图。
- 不引入 React、框架、图标库、slider、popover 或 React panel；不建搜索索引/store/API；不承诺未经同网络、同浏览器实测的 Afilmory 同等性能。
- 不本期生成第三种 viewer 档、独立 placeholder 阶段、三种派生图上传流水线或完整 gallery 虚拟化。只有“当前灯箱 original 首次可见”基线明确失败，才另立决策评估 viewer。

## 2. 现状与新版 schema 契约

| 项目 | 已核对事实 | 本期决策 |
| --- | --- | --- |
| 清单 | `_data/photos.json` 有 1504 项；URL 在 **`variants.*` 嵌套下**（非顶层）：`variants.thumbnail` / `preview` / `large` / `original`。抽样约 1503/1504 四档同源 R2 JPG；`assetPolicy` 多为 `r2-original`。 | 一次性改为新版 schema：只保留 canonical **`variants.thumbnail` + `variants.original`**，可选 `thumbHash`/`ogImageUrl`；停止 `preview`/`large` 的写与读。字段路径保持嵌套，不 flatten 成 Afilmory 顶层命名。 |
| 现有模板 | 首页使用 `preview → thumbnail → original`；`photos.html` 以 `preview → thumbnail → original` 输出列表，并把同一 list image 传给缩略/placeholder。 | 展示图、缩略栏和初始占位只读取 `thumbnail`；灯箱主图只读取 `original`。不读取任何旧字段。 |
| 现有脚本 | `build-variants-for-deploy.js` 已能生成本地 **720 WebP** 缩略图，但仍将 `preview` 别名到 thumb、`large` 别名到 original。`photo-overlay.js` 已有渐进加载与请求 token。 | 收敛 writer 为真实两档；去掉 preview/large 别名职责；灯箱沿用 progressive + token，仅当前项拉 original。 |
| 现有 UI | `_layouts/default.html` 有 `grid2fr` 固定两列 radio；`assets/new.scss` 已为 `figure` 设置 `content-visibility: auto`；`photo-overlay.js` 当前全量创建活动相册缩略图。 | 控件与图标同时移除固定两列含义；缩略栏先保留全量实现并测量，再决定窗口化。 |
| Afilmory 参考 | 源码契约为 `thumbnailUrl + originalUrl + thumbHash`（可选 `ogImageUrl`）+ 列表用 thumb、当前 viewer 用 original。详见 §2.1。 | 复用**资源职责**，不照搬字段名、字体、颜色、间距、边框、hover/focus、dark mode 或组件外观。 |

**更正注（Rev3）：** 前文若写“顶层 `thumbnail`/`original`”，均指 **职责上的 canonical 两档**；本站 JSON 路径为 `variants.thumbnail` / `variants.original`，不要求改成 Afilmory 的顶层 `thumbnailUrl`/`originalUrl`。

### 数据职责

```text
writer: variants.thumbnail + variants.original (+ optional thumbHash / ogImageUrl)
reader display: variants.thumbnail
reader viewer:  variants.original
```

`thumbHash` 是可选元数据，不能单独触发新构建阶段或成为首次交付阻塞；若存在，仅可改善 thumbnail 到 original 前的占位体验。`ogImageUrl` 也是可选，不改变页面加载职责。

### 2.1 对照 Afilmory 源码

基于本地仓库 `/Users/zhangyouxiu/Downloads/Code/afilmory` 的已读代码，非二手描述。

#### Schema（`packages/typing/src/photo.ts` · `PhotoManifestItem`）

| 字段/能力 | Afilmory | 本站本期 |
| --- | --- | --- |
| 列表/占位图 | `thumbnailUrl` | `variants.thumbnail`（职责对齐） |
| 主图/原图 | `originalUrl` | `variants.original` |
| 模糊占位 | `thumbHash`（一等公民） | 可选，v1 非阻塞 |
| 社交图 | 可选 `ogImageUrl` | 可选 |
| 独立 preview/large 产品档 | **无** | **停止**写读 |
| 尺寸元数据 | width/height/aspectRatio | 沿用本站已有字段即可 |
| 富元数据 | 完整 EXIF、tags、title、cameras/lenses 聚合 | 本站清单 largely 无；不承诺对等筛选 |

#### Builder（`packages/builder/src/image/thumbnail.ts`）

| 项 | Afilmory 事实 |
| --- | --- |
| 缩略规格 | `THUMBNAIL_WIDTH = 600`，JPEG quality **100** |
| 落盘 | `apps/web/public/thumbnails/{id}.jpg`，URL `/thumbnails/...` |
| thumbHash | 由 thumbnail 生成（thumbhash 库） |
| 对象存储 | 可选 `thumbnailStoragePlugin`：上传 thumbs 并改写为远程 URL |
| Git 同步 | 可选 `githubRepoSyncPlugin`：thumbs + manifest |
| 增量 | 增量构建；thumbs **预生成** 后随 SPA 部署 — **不是**每次页面部署对全量原图 encode |

#### 前端加载

| 场景 | Afilmory | 对本站的含义 |
| --- | --- | --- |
| 列表/瀑布流 | masonic 虚拟化；只用 `thumbnailUrl`（+ thumbHash）；不碰 original | 职责可学；虚拟化不默认照搬 |
| Viewer `ProgressiveImage` | 先 thumbnail，再 **仅当前** 图拉 original（`shouldRenderHighRes` 仅 current） | 与本站 progressive + 当前项原图一致 |
| GalleryThumbnail 条 | TanStack virtualizer；仅 thumbnail | 本站先全量测，失败再窗口化 |
| 搜索/筛选 | tags/cameras/lenses/rating/date + cmdk | 需富 EXIF；本站数据不足，不可承诺对等 |

#### Demo manifest 抽样

约 19 项：thumbnail 为本地 path；original 在 R2；均有 `thumbHash`；tags/description 常为空。对照性能时必须标注 **样本量、虚拟化、thumb 缓存、原图体积分布**。

#### 学什么 / 不学什么

| 学（职责与加载） | 不学（产品/架构） |
| --- | --- |
| 两档资源职责；列表=thumb；viewer 当前=original | 默认上 React / masonic / 虚拟 thumb |
| thumbs 预生成、部署消费已有 URL | WebGL、完整 EXIF 产品面 |
| 不预取无关 original | cmdk 多维筛选对等 |

#### 性能对等声明的含义

- Afilmory 默认是 **虚拟化 DOM**；本计划首期是 **1504 静态节点 + CSS**。在架构不同前，**不能声称同等手感**。
- Phase 0 对照 Afilmory 时必须注明：demo 样本量、虚拟化、thumb 缓存、original 体积分布；结论作软对照，**不阻塞 merge**。

## 3. 最小实现设计

### 图像与加载

- 构建器只增量生成/上传 **720px WebP** thumbnail，不放大源图；original 保持当前 R2 URL。720px 的依据是：首页卡片约 232 CSS px，移动端两列、iPad 三至四列以及常见 2× DPR 均有余量；Afilmory 使用 600px，首期优先体积和速度。只有真实浏览器发现清晰度不足，才以新的计划决策提高宽度，首期不设范围值。
- 首页仅输出其现有数量上限的展示图；`/photos/` 瀑布流和底栏只读取 `thumbnail`；打开/切换灯箱先设置 `thumbnail`，再对当前一张请求 `original`。快速导航必须用请求 token 防止旧图覆盖新图；original 失败时保留 thumbnail。
- writer、reader 与模板只使用 canonical `thumbnail` 和 `original`。`preview/large` 停止生成、写入和读取；不做迁移兼容、双读或旧字段回退。

### 画廊、搜索和控件

- 使用 CSS masonry/layout-grid 方案实现瀑布流，继续使用 `content-visibility` 与 lazy loading。不得仅凭“1504”假定 CSS 方案失败；以 Phase 0 DOM、滚动、内存、交互和网络基线为准。
- 搜索是在内存中将 1504 条已有公开元数据规范化为短字符串并 `filter`，最多渲染 10 条。不建索引、不建 store、不调 API。按现有数据定位为**相册名/文件名跳转**（实质字段多为 `meta.alt` / `album` / `location`）；实施前统计缺失率，文案与验收写明元数据限制，绝不补造 tags/camera 等字段，不承诺 Afilmory 级 EXIF 筛选。
- 以 **View options / Columns / 画廊密度** 取代 `grid2fr` 语义。桌面用符合本站现有 15×15、`currentColor`、单色描边风格的 masonry/layout-grid inline SVG，加原生 `<select>`（`Auto`、3–8）；不使用 slider、popover 或图标库。
- Afilmory 只提供交互方向。实现前后按本站既有字体、色彩 token、间距、1px 边框、hover、`:focus-visible` 和暗色模式做视觉一致性自审，不复制 Afilmory 外观。

### 响应式与灯箱

| 视口/条件 | 画廊与搜索 | 列数与缩略栏 |
| --- | --- | --- |
| Desktop ≥1024 | 搜索常显；select 显示。 | Auto 约 4–8，手选 3–8；缩略栏默认显示。 |
| iPad 768–1023 | 搜索图标展开为行内输入。 | 隐藏列数控件；竖屏 3、横屏 4。缩略栏横屏显示，竖屏默认折叠且可展开。 |
| Mobile <768 | 搜索图标展开为全宽输入。 | 隐藏列数控件；竖屏 2、较宽横屏 3。缩略栏默认折叠。 |
| 短视口 | 搜索和查看核心仍可达。 | 可依据 available height 完全隐藏缩略栏，但必须保留上一张、下一张、关闭。 |

禁止 UA 判断；使用 viewport/container、`orientation` 和可用高度媒体条件。复杂度压力下优先隐藏次要列数控件/缩略栏，不能牺牲搜索或看图核心。

## 4. 受影响文件

| 文件 | 计划改动 |
| --- | --- |
| `_data/photos.json` | 构建器写入 canonical `variants.thumbnail` 并保留 `variants.original`，可选 `thumbHash`/`ogImageUrl`；不手工批量编辑，停止 preview/large。 |
| `scripts/photos/build-variants-for-deploy.js` | 收敛为一个派生 thumbnail 的增量、小样本优先、prebuilt 复用流程；去掉 preview/large 别名写入。 |
| `package.json`、`vercel.json` | Phase 1 定义 skip/limit/prebuilt-only，避免干净构建默认全量 download+encode；必要时最小分离「生成 thumbs」与「站点构建」；不创建三档处理流程。 |
| `photos.html`、`index.html`、`index-zh-CN.html` | 只读取 `variants.thumbnail`/`variants.original`；**保留相册分段分组**；补充轻量搜索（相册/文件名跳转）与 gallery 标记；移除固定两列入口语义（以现有国际化结构为准）。 |
| `_layouts/default.html` | 把 radio/`grid2fr` 控件整体替为语义正确的 View options、inline SVG 和原生 select；保持 overlay 骨架最小改动。 |
| `assets/photo-overlay.js`、`assets/new.scss` | 按需 original、响应式缩略栏、active 边框修复、CSS 瀑布流/控件/搜索样式，并遵循现有视觉系统。 |
| `_data/i18n_copy.yml`（若需要） | 仅添加现有语言结构所需的搜索、清除、列数、缩略栏开关文案。 |

## 5. 实施顺序与逐步验证

### Phase 0 — 基线、契约和小样本

- [ ] 记录同一浏览器、网络限速、缓存规则、设备/viewport 下：首页、`/photos/`、未开灯箱及开灯箱的请求 URL/类型/字节、LCP、灯箱首次可见、DOM、滚动与 `scrollWidth/clientWidth`；覆盖 320、375、768、1024、1440。（正式浏览器矩阵未完成）
- [ ] 记录 Afilmory 在**相同**浏览器、网络、缓存及可比照片样本下的观察值，并注明不可直接比较因素；只作对照，不推断相同速度。
- [x] 以固定 720px WebP 进行小样本验证：不放大源图；本机 encode 已验证 720w WebP 与 original 区分。R2 写权限/生产缓存头与真实浏览器清晰度矩阵仍属开放验收（见 §10）。
- [ ] 测量 1504 个静态节点下 CSS 瀑布流 + content-visibility + lazy 的 DOM、内存、滚动、搜索和灯箱表现。仅在基线失败时批准 Phase 3/4 的升级。（代码已上 1504 静态 + CSS 瀑布流；正式基线记录未落盘）

**通过条件：** 有可复跑记录（方法、机器、浏览器、网络、缓存、样本、时间、失败请求），没有全量变体生成。

### Phase 1 — 两档文件与新版 reader

- [x] 实现 thumbnail 单档增量生成/上传，带限量、低并发、dry-run、失败明细和可重跑；original 不生成、不改写为派生档。
- [x] writer 停止写 preview/large；清单、模板和灯箱只使用 canonical thumbnail/original；小样本确认 thumbnail 与 original URL 不同、MIME/尺寸正确。（全量 1504 本地两档 distinct 已通过）
- [x] **Rev5 部署模型**：`build:site` / Vercel 默认 **encode-on-deploy**（缺则下载+编码，增量复用磁盘）；`photos:build-variants:prebuilt` 仅本机已有全量 thumb 时快速 hydrate。**不是** prebuilt-only 为默认部署路径。
- [x] 不另做 thumbHash/placeholder 阶段；如 thumbnail 初始占位仍不满足实际视觉/网络基线，再单独比较 thumbHash 收益。

**通过条件：** 小样本首页/列表/底栏请求 thumbnail；灯箱先 thumbnail、仅当前项请求 original；无关 original 不预取。（实现与本地 1504 清单已过；生产/CDN 手测见 §10）

### Phase 2 — CSS gallery、搜索、控件与响应式

- [x] 用 CSS 瀑布流替换 `grid2fr` 固定两列路径；保留/验证 `content-visibility` 和 lazy loading，消除文档级横溢出而不做猜测式负边距修复。
- [x] 实现最多 10 条的规范化短字符串搜索；记录 `performance.now()` 输入到渲染的时长、设备和方法，明确元数据缺失会限制命中。（实现已落地；正式 `<100ms` 计时记录仍属验收项）
- [x] 一起替换旧 radio、`grid2fr` 和图标：桌面 View options/Columns select（Auto/3–8）与 15×15 inline masonry/layout-grid icon；应用上表的断点、方向与高度规则。
- [x] 做视觉一致性自审：浅/深色、hover、focus-visible、键盘、字体、颜色、间距、边框和 320/375/768/1024/1440 几何。（代码与 i18n 已接；真实设备全 viewport 回归仍属用户验收）

**通过条件：** 桌面控件可访问；iPad/手机正确隐藏列数控件并自动列数；搜索/看图核心在所有条件下可达。

### Phase 3 — 仅在 gallery 基线失败时的升级

- [ ] 若 Phase 0 的 1504 DOM 明确失败，采用分批渲染：首批 60、后续每批 40；保留稳定顺序、搜索、锚点/返回和灯箱集合语义。
- [ ] 不做完整虚拟化，除非分批渲染仍以证据表明无法满足已记录的基线；届时另行决策、再写计划和验收。

**通过条件：** 只在已记录失败的机器/条件下比较升级前后；无滚动跳动、焦点丢失或导航集合错位。

### Phase 4 — 仅在缩略栏基线失败时的升级

- [x] 先修复 active 缩略图边框：`outline` + `outline-offset: -1px`（避免 overflow-x 裁切 box-shadow），并略增 thumbs 条垂直 padding；不以强制“可见数 + 10”为验收。
- [ ] 若全量缩略栏的 DOM/内存/切换基线失败，窗口化当前项附近；窗口大小由真实可见量和测量决定，并保持 `aria-current`、键盘、自动居中、滑动和焦点行为。（仍条件项，未做）
- [x] 短视口 / 窄视口默认折叠缩略栏：`openOverlay` 在 `max-width: 820px`（对齐现有 CSS 断点）或 `max-height: 540px` 时 `is-thumbs-collapsed`；仍保留上一张/下一张/关闭与手动展开。

**通过条件：** active 边框完整；缩略栏策略与视口/高度一致；无错误图片竞态。

### Phase 5 — 复测、回归和交付

- [ ] 以 Phase 0 同条件复测网络、字节、LCP、灯箱首次可见、DOM、搜索和横溢出，并与 Afilmory 记录并排标示前提/差异。
- [ ] 完成清单审计、静态构建和浏览器回归；检查新版 schema、键盘、dark mode、响应式、请求链路及部署不触发未经批准的全量处理。

## 6. 量化验收

- [x] 清单审计为 **1504/1504 仅有 canonical `thumbnail` 和 `original`，且 `thumbnail.src != original.src`**；不将 original 误报为生成档。（本地脚本审计已过）
- [ ] 首页和 `/photos/` 未打开灯箱的原图请求为 **0**；灯箱先显示 thumbnail，随后仅请求当前 original，且不预取无关 original。（浏览器 Network 手测仍开放）
- [ ] 1504 条搜索最多显示 **10** 条，记录设备/浏览器/测法后输入到结果更新 **<100ms**；结果字段受现有元数据缺失限制。
- [ ] **320 / 375 / 768 / 1024 / 1440** 下 `document.documentElement.scrollWidth <= clientWidth`；无文档级横溢出。
- [ ] 桌面 View options/Columns 控件可键盘访问且 Auto/3–8 正确；iPad/手机隐藏该控件并遵循自动列数；手机和短视口缩略栏折叠/隐藏策略正确，核心导航仍可达。
- [x] active 缩略图 1px 边框四边完整可见。（CSS：outline 内描边 + thumbs 条垂直 padding；真机再确认）
- [ ] 性能结论有与 Afilmory 同网络、同浏览器、同缓存/限速和可比样本的基线及复测；只陈述实测差异，不承诺相同性能。

## 7. 风险、回滚与最小化原则

| 风险 | 缓解 | 回滚 |
| --- | --- | --- |
| thumbnail 批处理或 R2 写入失败 | 小样本、限量、低并发、dry-run、可重跑及审计后再全量。 | 保持旧清单/模板，不删除 original 或已上传对象。 |
| thumbnail 清晰度不足或 original 首屏过慢 | 首期固定 720px WebP；只在真实浏览器确认清晰度不足时另立提高宽度的计划决策，只在灯箱主图基线失败时评估 viewer。 | 回退本次发布版本或重新生成 canonical thumbnail；不恢复旧字段。 |
| CSS 1504 DOM 性能不足 | 先测现有 content-visibility/lazy；失败才首批60/每批40。 | 回退批次逻辑至静态 CSS 方案，或在新证据下再立计划。 |
| 缩略栏全量节点不足 | 先测、先修边框；失败才局部窗口化。 | 独立回退缩略栏窗口化，不影响图片契约。 |
| 响应式/暗色回归 | viewport、orientation、available-height 和视觉一致性自审；无 UA 分支。 | 分离回退 CSS/控件变更，不回退图片数据。 |

每次实现遵循最小代码：不为单次用途抽象；先测量、再升级；任何超过本计划的第三档、虚拟化、Hash 阶段或服务端能力均需新的证据与确认。

## 8. 待确认决策 → 明确推荐（决议草案）

以下将此前开放歧义收成**推荐默认**；用户拍板后即可按此实施。非开放问题列表。

| # | 议题 | 明确推荐 |
| --- | --- | --- |
| 1 | Schema 路径 | 保持嵌套 **`variants.thumbnail` + `variants.original`**。停止 `preview`/`large` 的写与读。**不** flatten 为 Afilmory 顶层 `thumbnailUrl`/`originalUrl`。“Canonical”指**职责**，不是字段路径改名。 |
| 2 | Thumbnail 存储 | **Rev5 决议（已实施）：encode-on-deploy + 站点静态 thumbs**。对齐 Afilmory：builder 在构建时产出 `images/photos/variants/*-thumb.webp`，manifest 指向站点路径；original 仍在 R2 只读。`package.json` `build:site` 与 `vercel.json` 跑 `photos:build-variants`（缺则编码，磁盘已有则增量复用）。`--prebuilt-only` / `photos:build-variants:prebuilt` **仅**本机快速 hydrate，**不是**默认部署。R2 upload **仅** `--upload` 显式；默认不写 R2。干净 Vercel 冷构建会全量 download+encode（耗时需接受或提高并发）；可选后期像 `thumbnailStoragePlugin` 上传 R2 CDN。 |
| 3 | 格式与宽度 | 首期保持 **720px WebP**（站内脚本已用 720）。Afilmory 为 600 JPEG q100 — 记为对照，非硬性要求。仅当真实浏览器显示缩略偏软时再提高宽度。 |
| 4 | thumbHash | **可选、v1 非阻塞**。Afilmory 一等公民；本站等真实 thumbs 上线后有证据再评估。 |
| 5 | Gallery | 首发 **CSS masonry/grid + content-visibility + lazy**（相对 Afilmory 虚拟化的明确简化）。仅在测量失败时升级：分批 60/40，**不上** masonic。 |
| 6 | 搜索 | 定位为 **相册名/文件名跳转**（现有 meta 基本只有 alt/album/location）。非 Afilmory 级 EXIF 筛选。最多 **10** 条结果。除非 EXIF 进入列表数据，否则不承诺 tags/camera 搜索。 |
| 7 | 相册导航 | **保留相册分段分组**；搜索是补充，默认不整页取代相册结构（除非产品另定）。灯箱集合 = **当前相册**（现有行为）；除非搜索结果显式定义临时集合。 |
| 8 | 列数控件 | 学交互意图（Auto + 手选，桌面上限约 8）；实现为 **原生 select + 本站风格 inline SVG**；无 panel/slider/图标库。 |
| 9 | 与 Afilmory 性能对等 | **软化**为非阻塞观察，并标注前提差异（虚拟化、样本量、缓存、原图体积）。**不**以匹配 Afilmory 数字作为 merge 门槛。 |

### 与正文的一致性提示

- §2 表与 §3 中的 “canonical thumbnail/original” 均按上表 #1 理解为 **`variants.*` 职责**。
- §5 Phase 1 的 Vercel/部署边界与上表 #2（**Rev5**）对齐：默认 **encode-on-deploy** 产出站点内 thumb；`prebuilt` 仅本地捷径。干净构建冷启动耗时见 §10 / 收尾 notes。
- §6 搜索验收字段范围与上表 #6 对齐：按实际元数据写验收文案，不虚构 tags/camera 能力。
- Phase 0 Afilmory 对照须带 §2.1 所列 caveats（#9）。

## 9. 本轮要求与变更理由记录

| 本轮要求 | 纳入方式 | 理由 |
| --- | --- | --- |
| 对齐 Afilmory 真实字段与新版 schema | 两档 canonical `variants.thumbnail`/`variants.original`，optional thumbHash/ogImageUrl；writer、reader 与模板停止 preview/large，不兼容旧字段；路径不 flatten。 | 消除不存在的 preview/large 产品假设，避免双读、迁移兼容与无意义的字段改名。 |
| 固定首期 thumbnail 宽度 | 720px WebP；首页约 232 CSS px、移动两列/iPad 三至四列和常见 2× DPR 有余量；Afilmory 为 600px JPEG q100（对照）。 | 首期优先体积和速度；真实浏览器清晰度不足时再以新计划决策提高，不预设范围。 |
| Thumbnail 预生成与部署 | **Rev5**：站点静态 thumbs + encode-on-deploy（缺则编码、增量复用）；prebuilt-only 仅本地；R2 写为可选。 | 对齐 Afilmory public/thumbnails 随站部署；不依赖 R2 Write。 |
| 收敛性能方案 | CSS + content-visibility + lazy 为首期；两项按失败门槛升级；不对等 Afilmory 虚拟化性能声明。 | 避免过度设计；架构不同则性能对等不阻塞。 |
| 替换固定两列交互 | 语义改为 View options/Columns/画廊密度，原生 select 与本站风格 inline SVG。 | 控件表达真实能力并保持视觉一致。 |
| 搜索与相册 | 相册分组保留；搜索为元数据受限的跳转（max 10）；灯箱集合默认当前相册。 | 数据能力决定产品承诺，不虚构 EXIF 筛选。 |
| 响应式与核心可达 | 以宽度、方向、可用高度分层，优先隐藏次要控件。 | 小屏/短屏不牺牲搜索、关闭和前后导航。 |
| 验收改为可证据化 | 明确 1504、原图请求、搜索、五组 viewport、可访问性与同环境对照（带 caveats）。 | 只对已测结果作性能结论。 |

## 10. 保留给用户的真实环境验收

- [ ] 在真实 R2/Vercel、真实浏览器缓存和网络下复核 1504 张 thumbnail、original 灯箱升级、CDN 缓存及失败表现。
- [ ] 在真实 320/375 手机、iPad 竖横、桌面上复核密度、输入展开、折叠缩略栏、短视口核心按钮、焦点与暗色视觉。
- [ ] 确认基线与 Afilmory 的样本可比性后，再接受或拒绝任何 viewer、分批渲染或缩略栏窗口化升级。

---

## Implementation notes

> 追加于实施过程。部署模型以 **Revision 5 / §8 #2 Rev5** 为准：**encode-on-deploy + 站点静态 thumbs**（非 prebuilt-only 默认）。

### Done

| 项 | 说明 |
| --- | --- |
| Schema | 仅 `variants.thumbnail` + `variants.original`；normalize 写路径剥离 preview/large |
| Writer | `build-variants-for-deploy.js`：默认缺则 encode；`--prebuilt-only`、`--dry-run`、`--upload`；720 WebP 增量 |
| Deploy | `package.json` `build:site` + `vercel.json`：**encode missing**（Afilmory 模型）；`photos:build-variants:prebuilt` 仅本机快速 hydrate |
| Readers | `photos.html`、`index.html`、`index-zh-CN.html`、`feeds/photos.xml`、`photo-overlay.js` 只读两档 |
| Phase 2 UI | Columns select Auto/3–8；CSS `column-count` 画廊；相册导航保留；搜索跳转 max 10；en/zh i18n；`localStorage` 键 `photos-columns` |
| 小样本 / 全量 encode | 本机 **1504/1504** 720w WebP thumbs；清单两档 distinct |
| Phase 4 边框 | active thumb 用 `outline` + 内偏移，避免 overflow-x 裁切 |
| 响应式 thumbs | 打开灯箱时 `max-width: 820px` 或 `max-height: 540px` 默认折叠 |

### 全量 encode 结果（本机已完成）

| 项 | 结果 |
| --- | --- |
| 磁盘 thumbs | **1504/1504** `*-thumb.webp`（约 63MB，gitignored） |
| 清单 | 1504/1504 仅 `thumbnail+original`；`thumbnail.src != original.src` 全通过 |
| thumbnail | 本地 `/images/photos/variants/…-thumb.webp`，720 WebP |
| original | 仍为 `https://img.bazinga.ink/...` |
| R2 upload | **可选**；当前 token 无写权限时不阻塞上线（站点路径 thumbs 由构建产出） |
| 本机 jekyll | 可用（磁盘有 variants；`prebuilt` 快速 hydrate） |
| Vercel | **encode-on-deploy**：干净构建会下载+编码缺图 thumbs 进 `_site`；有缓存/磁盘复用则增量。冷构建耗时需手测 |

**上线路径（默认）：** 推送后 Vercel 跑 `photos:build-variants`（encode missing）→ Jekyll 把 `images/photos/variants` 打进 `_site`。不必提交 variants 到 git，也不依赖 R2 Write。

**可选加速 / CDN：** 授予 R2 Object Write 后 `npm run photos:build-variants:upload`，manifest 改 CDN URL；或提高 `PHOTOS_BUILD_CONCURRENCY`。

### In progress / blockers

| 项 | 状态 |
| --- | --- |
| 全量 1504 thumb encode | **本机已完成**；磁盘缓存 gitignore：`images/photos/variants/` |
| Vercel 冷构建时长 | 待真实部署观察；增量应接近 hydrate |
| R2 上传 | 可选；token 无 Write 时不影响默认 encode-on-deploy 路径 |
| Phase 0 / §6 浏览器项 | 正式矩阵与 Network 手测仍开放 |
| Phase 3 / Phase 4 窗口化 | 仍条件项，未触发 |

### Deviations

| 偏离 | 说明 |
| --- | --- |
| Thumbnail 存储 | **站点静态优先**（Afilmory 默认）；R2 上传可选，非上线门槛 |
| CSS 瀑布流 | `column-count` 多列，非 true masonry packing — 计划内可接受简化 |
| Phase 0 | 正式 Afilmory 并排指标尚未落盘记录 |
| Compact 断点 | 灯箱折叠用 **820px**（对齐现有 overlay CSS），非计划表字面 768 |

### Next for user

1. 部署到 Vercel，观察**冷构建**时长与 thumbs 是否进 `_site`
2. 真机/浏览器验收：Network（未开灯箱 original=0）、五组 viewport、active 边框、短视口折叠
3. （可选）R2 Write + upload 把 thumbs 推 CDN，缩短构建与 git 无关
4. 仅当 1504 DOM / 缩略栏基线失败时再开 Phase 3/4 窗口化

---

## 收尾 notes（2026-08-04）

- **Cleanup：** `.playwright-cli/` 已加入 `.gitignore` 并删除会话垃圾；`images/photos/variants/.gitkeep` 保留空目录。
- **Active 边框：** `assets/new.scss` 去掉易被 `overflow-x` 裁切的外扩 `box-shadow`，改用 `outline: 1px solid` + `outline-offset: -1px`，并略增 thumbs 条垂直 padding。
- **响应式 thumbs：** `openOverlay` 在窄（≤820px）或短（≤540px）视口默认 `is-thumbs-collapsed`；prev/next/close 与手动展开保留。
- **计划同步：** 状态改为实现基本完成待手测；§8 #2 / Implementation notes 纠正为 **encode-on-deploy + 站点静态 thumbs**（非 prebuilt-only 默认）。
- **用户仍需：** Vercel 冷构建时长与生产 thumbs；真实设备 QA（Network / viewport / 边框）；Phase 0 正式矩阵；条件性 Phase 3/4 窗口化仅在基线失败时。

### 本机浏览器验收（2026-08-04 收尾）

环境：`http://127.0.0.1:4000`，Chrome DevTools MCP。

| 检查 | 结果 |
| --- | --- |
| 清单 1504 仅 thumbnail+original 且 URL 不同 | 通过（构建审计） |
| 桌面 `/photos/` 列表 image 请求 | thumb 有、**original 0** |
| 桌面无文档横溢出 | scrollW=clientW |
| 搜索「槟城」 | ≤10 条结果，约 150ms debounce 后渲染 |
| 列数控件 | 桌面可见；375 宽 **display:none**，column-count=2 |
| 375 宽无横溢出 | 通过 |
| 打开灯箱 | 出现 **1** 次 original；主图 src 为 CDN original |
| 375 宽灯箱缩略栏默认折叠 | `is-thumbs-collapsed` true |
| jekyll build / prebuilt hydrate | 通过 |

仍待用户：Vercel 冷构建时长与线上 thumbs；真机暗色/短视口细测；commit。

