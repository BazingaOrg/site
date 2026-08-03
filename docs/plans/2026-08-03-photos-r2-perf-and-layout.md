# Photos × R2：性能与布局升级方案

**日期：** 2026-08-03  
**状态：** P0 已实施（进行中）；P1/P2 待做  
**范围：** `/photos/` 列表、首页 Photos 区块、大图 overlay、R2 构建流水线  
**对标：** afilmory 的**构建分层与列表性能**（小图 / 真尺寸 / 渐进加载）；**不**对标其详情信息侧栏 UI  

---

## 1. 目标

| 目标 | 衡量 |
|------|------|
| 列表不再直接吃原图 | 网格/首页用 ≤ ~960px 衍生图 |
| 弹窗先小后大 | 打开瞬间有垫图，再换 large/original |
| 两列更像画廊 | 保留真实比例密铺，取消 4:3 强制裁切 |
| 元数据可信 | 有则写真宽高/ratio；无则不强行 1.5 装懂 |
| 仓库保持瘦 | 原图与衍生图都在 R2（`img.bazinga.ink`），git 只留 `photos.json` |

**非目标（本期不做）：**

- **afilmory 式详情信息侧栏**（左大图 + 右 Inspector 常驻/默认展开）
- 改动现有 overlay EXIF 的交互默认（**保持**：点按钮再看 EXIF；site 已具备该能力）
- WebGL 查看器、Live Photo、afilmory monorepo builder
- Stories 恢复
- 把 1500 张缩略图塞进 Vercel/git
- 首页一次渲染全部相册图

**Overlay EXIF（明确保留现状）：**

- 已有 `#photo-overlay-exif` + 工具栏切换按钮
- 打开弹窗默认**不**展开 EXIF
- 本期**不**做「宽屏默认双栏 / 默认打开信息侧栏」

---

## 2. 可取消 / 放宽的 site 旧规则

为效果服务，下列规则**允许改掉或降级**（实施时在 commit 里写明）：

| 旧规则 | 处置 | 原因 |
|--------|------|------|
| 两列 `aspect-ratio: 4/3` + `object-fit: cover` | **取消** | 裁切破坏构图 |
| 默认 `meta.ratio: 1.5` | **取消** | 假数据误导 landscape/portrait |
| 列表四档 URL 都指向原图 | **取消** | 慢的主因 |
| 弹窗只靠 `link.href` 一次加载 | **改为** progressive | 先小后大 |
| 必须本地有原图才能维护相册 | **已取消**；强化 R2 源 | 本机无原图 |
| 竖图/横图 class 依赖假 ratio | **可改为** 有尺寸才加 class，或 JS 读 `naturalWidth` | 减少假分类 |
| 一次渲染全部 1500 figure | **可改为** 分页/按相册 | HTML 与网络压力 |
| 首页强制 carousel 自动轮播 | **可改为** 横向滚动条（仍限 N 张） | 交互偏好 |
| 旧 `generate-variants` 只写本地 `/images/photos/` | **扩展或替换** 为 R2 上下游 | 与 CDN 一致 |

**明确不取消：**

- 现有 overlay EXIF 面板与「按钮切换」行为
- Jekyll + `_data/photos.json` 静态清单
- `photo-overlay` 骨架（全屏、thumbs、键盘、幻灯片）
- 自定义域 `https://img.bazinga.ink` + 桶 `bazinga-gallery`
- 相册路径约定 `photos/{album}/{file}`

---

## 3. 目标架构（构建 → 展示）

```text
R2 bazinga-gallery
  photos/{album}/DSCF.JPG                    ← 原图（已有）
  photos/{album}/variants/
    dscf-thumbnail.webp  (~360w)
    dscf-preview.webp    (~960w)
    dscf-large.webp      (~2160w)
    （可选 .avif，二期）

构建脚本（本机 / CI 可选）
  list → (增量) 下载原图 → sharp → put variants → 写 photos.json

站点
  列表 / 首页：preview（无则 thumbnail，再无则 original）
  Overlay：先 thumbnail/preview → 再 large/original
           EXIF 仍按需点开（不引入常驻侧栏）
  两列：自然比例 + dense grid（或轻量瀑布）
  首页：最近 N 张横向滚动（可选替换 carousel），绝不塞 1500 张
```

`photos.json` 单条目标形态：

```json
{
  "id": "…",
  "uploaded": "…",
  "source": { "bucketKey": "photos/相册/DSCF.JPG", "album": "…", "filename": "…" },
  "variants": {
    "original":  { "src": "https://img.bazinga.ink/…", "width": 4896, "height": 2760, "type": "image/jpeg" },
    "thumbnail": { "src": "https://img.bazinga.ink/…/variants/…-thumbnail.webp", "width": 360, "height": 203, "type": "image/webp" },
    "preview":   { "src": "…-preview.webp", "width": 960, "height": 541, "type": "image/webp" },
    "large":     { "src": "…-large.webp", "width": 2160, "height": 1218, "type": "image/webp" }
  },
  "meta": {
    "ratio": 1.77,
    "alt": "…",
    "location": "相册名",
    "album": "相册名"
  }
}
```

无衍生图时：允许缺字段；模板 **fallback 链** 保证不挂，但性能差（过渡期）。

---

## 4. 分步实施（按优先级）

### P0 — 立刻有效果（不依赖批量出图）

#### Step 1. 两列布局：取消 4:3 裁切，保真实比例

**改：** `assets/new.scss` 中 `.photos-wrapper[data-layout="grid2fr"]`

- 去掉 `img { aspect-ratio: 4/3; object-fit: cover; }`
- 改为 `width: 100%; height: auto; display: block;`
- 保留 `grid-template-columns: repeat(2, 1fr)` + `grid-auto-flow: dense`
- 可选：gap / figure 间距微调

**验证：** `/photos/` 切到两列，竖图不被砍头，横竖混排更自然。

#### Step 2. 去掉假 `ratio: 1.5`，模板容错

**改：**

- `scripts/photos/sync-from-r2.js`：不再写入默认 `1.5`；仅保留已有真实 `previous.ratio`
- `photos.html`：无 ratio 时用中性 class（如 `figure-unknown`）或不加横竖 class；有 ratio 再 `landscape|portrait`
- 可选极短 JS：图片 `load` 后按 `naturalWidth/Height` 打 class

**验证：** 不再出现「全站 landscape」；布局不依赖假数据。

#### Step 3. Overlay 渐进加载（先小后大）

**改：** `assets/photo-overlay.js` + 模板 data 属性

- 列表 `<a>` 补充 `data-photo-preview-src`（与已有 thumbnail / original 并列）
- `setOverlayImage`：
  1. 立刻显示 thumbnail 或 preview（垫图）
  2. 后台加载 large/original，`onload` 后替换
  3. 保留现有 spinner；**不改动** EXIF 开关逻辑与默认折叠

**验证：** 点开弹窗先有垫图再变清晰；EXIF 仍需手动点开（与现在一致）。

#### Step 4. 列表/首页优先 preview 字段

**改：** `photos.html`、`index.html`、`index-zh-CN.html`

- 展示链：`preview → thumbnail → original`
- 点击/弹窗 large 链：`large → original`
- 有 width 才写 srcset

**验证：** 仅有原图时与现在相同；有 preview 后列表主要请求 preview。

#### Step 4b.（可选，同属 P0/P2 均可）首页 carousel → 横向滚动

**动机：** 去掉自动轮播，改为横向滑看最近照片。

**约束（必须）：**

- 仍 `slice` **最近 N 张**（建议 10–16，上限约 24）
- **禁止**把 1500 张写入首页 DOM
- `loading="lazy"`（首张可 eager）；滑到附近再请求，但 DOM 数量由 N 决定
- 完整相册继续走 `/photos/`

**改：** 替换 `data-photo-carousel` 为横向 scroller（可保留 snap）；可弱化或移除 `home-photo-carousel.js` 自动播放逻辑。

**验证：** 首页 Network 图请求数 ≈ 可见区 + 少量预取，远小于相册总量。

---

### P1 — 性能质变（R2 衍生图流水线）

#### Step 5. 凭证与脚本：`photos:build-variants-from-r2`

**前置：** R2 **S3 兼容 API Token**（Access Key + Secret），写入 `.env`（勿提交）：

```bash
# 已有 list 用
CLOUDFLARE_ACCOUNT_ID=…
CLOUDFLARE_API_TOKEN=…

# 下载/上传对象用（R2 API token）
R2_ACCOUNT_ID=…          # 可与上相同
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_BUCKET=bazinga-gallery
PHOTOS_CDN=https://img.bazinga.ink
PHOTOS_PREFIX=photos/
```

**脚本行为：**

1. 读现有 `photos.json` 或 list 原图 key  
2. 对每张：若 `variants/…-preview.webp` 已存在则 skip（增量）  
3. Get 原图 → sharp：  
   - thumbnail 360w webp  
   - preview 960w webp  
   - large 2160w webp  
4. Put 到 `photos/{album}/variants/{basename-lower}-{size}.webp`  
5. 回写 json：各档 `src/width/height/type`，`meta.ratio = w/h`  
6. 支持 `--limit=N`、`--album=`、`--dry-run`、低并发  

**npm：** `photos:build-variants-from-r2`  
**验证：** 小样本相册后列表明显变快；ratio 为真值。

#### Step 6. 同步脚本与构建脚本职责拆分

| 命令 | 职责 | 频率 |
|------|------|------|
| `photos:sync-from-r2` | 只同步清单（新文件、CDN URL、保留手写 caption） | 常跑 |
| `photos:build-variants-from-r2` | 出图 + 尺寸 | 新增图后 / 全量一次 |
| （可选）`photos:sync-exif` | 写 EXIF 进 json（供现有 overlay 展示） | 可选 |

**验证：** 文档写清：先 sync，再 build-variants。

#### Step 7. Cache-Control 与路径约定固定

- 上传 variants：`Cache-Control: public, max-age=31536000, immutable`  
- 衍生文件名统一 lower；文档写死 key 规则  

---

### P2 — 画廊体验（布局与体量）

#### Step 8. 两列「轻瀑布」强化（仍可不用重库）

在 Step 1 基础上可选：

- 方案 A：`column-count: 2` + `break-inside: avoid`  
- 方案 B：CSS grid dense + 真 aspect-ratio 占位（**推荐**）  
- 方案 C：真正 masonry 库（更后）  

#### Step 9. 体量：分页或按相册

1500 张单页 HTML 仍重：

- **优先按相册：** 索引 + 张数 → 过滤/子页  
- 或「加载更多」每页 24–48 张  

**可取消：** 单页吐出全部 figure 的默认。

#### Step 10.（可选）thumbHash / 主色占位

构建时写入极短占位；收益次于小图，排 P2 末。

---

## 5. 推荐实施顺序（汇总）

| 顺序 | 步骤 | 优先级 | 预估工作量 | 依赖 |
|------|------|--------|------------|------|
| 1 | 两列去 4:3 | P0 | 小 | 无 |
| 2 | 去假 ratio + 模板容错 | P0 | 小 | 无 |
| 3 | Overlay 先小后大（EXIF 交互不动） | P0 | 中 | 模板 data |
| 4 | 列表/首页 fallback 链 | P0 | 小 | 与 3 一起 |
| 4b | 首页横向滚动（限 N 张，可选） | P0/P2 | 中 | 与 4 相关 |
| 5 | R2 S3 + build-variants 脚本 | P1 | 大 | 用户建 token |
| 6 | 分相册/全量跑衍生图 | P1 | 时间长 | Step 5 |
| 7 | Cache-Control + 文档 | P1 | 小 | Step 5 |
| 8 | 两列轻瀑布微调 | P2 | 小 | Step 1、6 更佳 |
| 9 | 分页/按相册 | P2 | 中 | 产品确认 |
| 10 | thumbHash（可选） | P2 | 中 | Step 5 |

**已删除：** 原「Overlay 桌面双栏 / afilmory 信息侧栏」步骤。

**第一段交付：** Step 1–4（+ 可选 4b）  
**第二段交付：** Step 5–7（列表真正变快）  
**第三段交付：** Step 8–9  

---

## 6. 风险与注意

| 风险 | 缓解 |
|------|------|
| 1500 张全量 sharp 耗时长/内存 | 增量、`--limit`、低并发、按 album |
| R2 费用 | 只处理缺 variant；长缓存 |
| 中文路径编码 | URL encode；key 用 R2 原始 key |
| 首页误塞全量图 | 强制 `slice` N；验收看 DOM 数量 |
| 误改 EXIF UX | Step 3 验收：默认仍折叠，按钮仍可用 |

---

## 7. 验收清单

- [ ] 两列：竖图完整可见，非统一 4:3 裁切  
- [ ] json 无新的假 `ratio: 1.5`  
- [ ] 有 preview 后列表主请求为 preview  
- [ ] 弹窗先垫图再 large  
- [ ] **弹窗 EXIF 默认仍关闭**；按钮可正常打开（与现网一致）  
- [ ] 首页若改横向滚动：仅 N 张 DOM，非 1500  
- [ ] sync / build-variants 可文档化复现  
- [ ] `JEKYLL_ENV=production bundle exec jekyll build` 通过  

---

## 8. 确认项（实施前）

1. **顺序：** 是否按 P0 → P1 → P2？  
2. **衍生图：** 默认 webp only（avif 二期）？  
3. **全量 1500：** 先一个相册试跑，还是接受本机长批处理？  
4. **列表体量（P2）：** 按相册 还是 加载更多？  
5. **首页：** 保留 carousel / 改为横向滚动（限 N）/ 以后再说？  
6. ~~桌面默认信息侧栏~~ → **已否决，不再做**

确认后从 **Step 1** 开始改代码；完成后在 §9 补实现笔记。

---

## 9. 实现笔记

### 2026-08-03 — 方案修订

- **否决** afilmory 式信息侧栏及「宽屏默认展开 EXIF」。  
- 保留 site 现有 overlay EXIF（按钮切换、默认折叠）。  
- 补充首页横向滚动可选规格：限 N 张，避免一次加载全库。  
- 步骤重编号：原 Step 9 侧栏删除；体量/thumbHash 顺延为 9/10。  

### 2026-08-03 — P0 实施

已完成：

| Step | 内容 | 说明 |
|------|------|------|
| 1 | 两列去 4:3 | `grid2fr` 改为自然高度 `object-fit: contain` |
| 2 | 假 ratio | sync 不再写 1.5；清理 json 中 r2-original 的 1.5；模板 `figure-unknown` |
| 3 | Overlay 渐进 | `setOverlayImage` 先 preview/thumbnail 再 full |
| 4 | 列表 fallback | preview → thumbnail → original；`data-photo-preview-src` |
| 4b | 首页横滑 | 最近 **12** 张 `.photo-strip`；移除 carousel JS |

未做（P1+）：全量上传衍生图、分页/相册。

验证：`JEKYLL_ENV=production bundle exec jekyll build` 通过；首页 12×`photo-strip-item`；photos 1504×`figure-unknown`。

### 2026-08-03 — P1 脚本

- 曾新增 `photos:build-variants-from-r2`（回写 R2，需写权限）
- **改对齐 afilmory：** `photos:build-variants`（`build-variants-for-deploy.js`）
  - 只读 CDN/R2 原图 → 本机 WebP → `images/photos/variants/`（gitignore）
  - 更新 `_data/photos.json` 本地路径；`original` 仍指向 CDN
  - 接入 `vercel.json` buildCommand；`installCommand` 含 `npm install`
- 单相册实测：原图 → preview 960×540 本地文件，**无需 R2 写权限**
- `/photos/` 按相册分组 + 顶部相册导航；两列布局作用于每个相册 grid
- git 中 `photos.json` 保持 CDN 原图路径；本地/CI 跑 `photos:build-variants` 后写本地 preview 路径
- 小样相册已生成 gitignored webp，复用跳过下载  
