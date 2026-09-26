import { Node, Rect, Size, Sprite, SpriteFrame, Texture2D, resources } from 'cc'
import { createNode } from './Theme'

/**
 * 大厅雪碧图（assets/resources/home-ui.png，1672×941）。
 * 元素坐标由 tools/optimize 连通域标定 + 联络表目测复核（atlas-sheet.mjs）。
 * 存【图源左上像素坐标】；SpriteFrame.rect 原点即图像左上，直接使用无需翻转。
 * 任一帧缺失都返回 null，调用方回退 Theme 代码绘制，不阻塞大厅可用。
 */
export type HomeUiKey =
  | 'bg' // 池塘夜景插画（812×431，铺底拉伸）
  | 'panel' // 房间列表面板框（596×396，三段拉伸到效果图的大面板）
  | 'playerBar' // 顶栏玩家信息条（427×146，左端烧死金环乌龟头像，三段拉伸）
  | 'roomRow' // 房间行底条（787×74，左端锁形 + 右端空白金胶囊，三段拉伸）
  | 'searchStrip' // 搜索条（409×97，左端放大镜，三段拉伸）
  | 'headStrip' // 表头条（471×77 深色金边条，三段拉伸）
  | 'btnGreen' // 创建房间大按钮（396×105，绿 + 树苗图标，文案另叠）
  | 'btnGold' // 快速加入大按钮（310×105，金 + 骰子，文案另叠）
  | 'btnJoin' // 加入小胶囊（195×63，金，文案另叠）
  | 'btnFull' // 已满小胶囊（195×63，文案另叠）
  | 'roundSound' // 右上圆钮·声音（喇叭）
  | 'roundExpand' // 右上圆钮·全屏（四向箭头）
  | 'roundTrophy' // 右上圆钮·战绩（奖杯）
  | 'roundExit' // 右上圆钮·退出
  | 'mascotTurtle' // 右下角挥手乌龟吉祥物（130×132）
  | 'turtleAvatar' // 大号乌龟头像（177×168，备用）
  | 'avatarRing' // 头像金圈（154×154，备用）
  | 'lockTile' // 小锁贴片（80×76，行回退模式用）

/** 图源左上坐标 [x, y, w, h]（1672×941 图源像素） */
const HOME_RECTS: Record<HomeUiKey, [number, number, number, number]> = {
  bg: [15, 15, 812, 431],
  panel: [1058, 32, 596, 396],
  playerBar: [40, 464, 427, 146],
  roomRow: [639, 697, 787, 74],
  searchStrip: [572, 571, 409, 97],
  headStrip: [1064, 464, 471, 77],
  btnGreen: [988, 804, 396, 105],
  btnGold: [648, 804, 310, 105],
  btnJoin: [1453, 571, 195, 63],
  btnFull: [1453, 646, 195, 63],
  roundSound: [332, 682, 84, 84],
  roundExpand: [427, 682, 84, 84],
  roundTrophy: [237, 682, 83, 84],
  roundExit: [522, 683, 84, 83],
  mascotTurtle: [488, 786, 130, 132],
  turtleAvatar: [26, 633, 177, 168],
  avatarRing: [304, 775, 154, 154],
  lockTile: [50, 820, 80, 76],
}

/**
 * 效果图直裁元素（assets/resources/lobby-elems.png，640×720，tools/optimize/make-elems.mjs
 * 从 image.png 原像素裁拼；坐标与 lobby-elems.rects.json 同步）。
 * 这些帧与效果图逐像素同源——凡效果图里有、雪碧图里没有或形状不符的元素用它。
 */
export type ElemKey =
  | 'title' // 「德州扑克♠」金色标题（500×44）
  | 'search' // 搜索胶囊（282×59，占位文字已擦除，左侧金放大镜保留）
  | 'refresh' // 刷新大圆钮（134×130）
  | 'join' // 加入胶囊（136×44，行右端）
  | 'scroll' // 面板右缘竹卷轴装饰（184×708）
  | 'mBtnSound' // 顶栏圆钮·声音（60×60）
  | 'mBtnFull' // 顶栏圆钮·全屏
  | 'mBtnRecord' // 顶栏圆钮·战绩
  | 'mBtnExit' // 顶栏圆钮·设置/退出
  | 'playerBar2' // 玩家信息牌整牌（345×112，静态名字/金币数字已擦成动态位）
  | 'nav' // 左导航整列（255×385：金选中页签 + 深色连排页签，压在面板左缘上）
  | 'btnCreate' // 底部「创建房间」绿钮整钮（322×82，自带文字）
  | 'btnQuick' // 底部「快速加入」金钮整钮（328×80，自带文字）
  | 'mascot' // 右下乌龟吉祥物带暗底余量（185×155）
  | 'lock' // 行首金锁贴片（30×36，房间号左侧）

const ELEM_RECTS: Record<ElemKey, [number, number, number, number]> = {
  title: [0, 0, 500, 44],
  search: [0, 46, 282, 59],
  refresh: [290, 46, 134, 130],
  join: [290, 180, 136, 44],
  scroll: [430, 0, 184, 708],
  mBtnSound: [0, 200, 60, 60],
  mBtnFull: [62, 200, 60, 60],
  mBtnRecord: [124, 200, 60, 60],
  mBtnExit: [186, 200, 60, 60],
  playerBar2: [0, 262, 345, 112],
  nav: [346, 0, 255, 385],
  btnCreate: [0, 376, 322, 82],
  btnQuick: [0, 460, 328, 80],
  mascot: [346, 386, 185, 155],
  lock: [346, 546, 30, 36],
}

let tex: Texture2D | null = null
let bgTex: Texture2D | null = null
let elemTex: Texture2D | null = null
const frameCache = new Map<string, SpriteFrame>()
let pending: Promise<void> | null = null

/** 懒加载大厅雪碧图 + 效果图整图背景（重复调用返回同一 Promise；失败只告警不阻塞） */
export function loadHomeUi(): Promise<void> {
  if (pending) {
    return pending
  }
  const load = (path: string, ok: (t: Texture2D) => void) =>
    new Promise<void>((resolve) => {
      resources.load(path, Texture2D, (err, t) => {
        if (!err && t) {
          ok(t)
        } else {
          console.warn(`[HomeUi] resources/${path} 加载失败，回退代码绘制`, err)
        }
        resolve()
      })
    })
  pending = Promise.all([
    load('home-ui/texture', (t) => {
      tex = t
      console.log(`[HomeUi] 大厅雪碧图已加载：${t.width}×${t.height}`)
    }),
    // 效果图整图（1672×941 调色板 PNG）——大厅铺底，UI 元素按测定坐标叠上面，
    // 背景与效果图逐像素同源，免再手绘还原
    load('lobby-bg/texture', (t) => {
      bgTex = t
    }),
    // 效果图直裁元素图纸（搜索/刷新/标题/加入胶囊/卷轴/顶栏圆钮）
    load('lobby-elems/texture', (t) => {
      elemTex = t
    }),
  ]).then(() => undefined)
  return pending
}

/** 效果图整图背景帧；未加载成功返回 null（调用方回退雪碧图 bg / 渐变） */
export function lobbyBgFrame(): SpriteFrame | null {
  if (!bgTex) {
    return null
  }
  const frame = new SpriteFrame()
  frame.texture = bgTex
  frame.rect = new Rect(0, 0, bgTex.width, bgTex.height)
  frame.originalSize = new Size(bgTex.width, bgTex.height)
  frame.packable = false
  return frame
}

/** 全屏铺效果图整图（SIMPLE + CUSTOM 拉伸到指定尺寸）；无帧时返回空节点占位 */
export function attachLobbyBg(parent: Node, w: number, h: number): Node {
  const node = createNode('lobby-bg', parent, w, h)
  const frame = lobbyBgFrame()
  if (frame) {
    spriteChild(node, 'full', frame, w, h, 0)
  }
  return node
}

/** 效果图直裁元素帧；未加载成功返回 null（调用方回退雪碧图/代码绘制） */
export function elemFrame(key: ElemKey): SpriteFrame | null {
  if (!elemTex) {
    return null
  }
  const cacheKey = `elem:${key}`
  const hit = frameCache.get(cacheKey)
  if (hit) {
    return hit
  }
  const [x, y, w, h] = ELEM_RECTS[key]
  if (x + w > elemTex.width || y + h > elemTex.height) {
    return null
  }
  const frame = new SpriteFrame()
  frame.texture = elemTex
  frame.rect = new Rect(x, y, w, h)
  frame.originalSize = new Size(w, h)
  frame.packable = false
  frameCache.set(cacheKey, frame)
  return frame
}

/** 贴一个效果图直裁元素（SIMPLE + CUSTOM 拉伸）；无帧时返回空节点占位 */
export function attachElem(parent: Node, key: ElemKey, w: number, h: number): Node {
  const node = createNode(`elem-${key}`, parent, w, h)
  const frame = elemFrame(key)
  if (frame) {
    spriteChild(node, 'full', frame, w, h, 0)
  }
  return node
}

/** 元素内取纵向子条帧（x0..x1 为元素内像素列）；未加载成功返回 null */
function sliceFrame(key: HomeUiKey, x0: number, x1: number): SpriteFrame | null {
  if (!tex) {
    return null
  }
  const cacheKey = `${key}:${x0}-${x1}`
  const hit = frameCache.get(cacheKey)
  if (hit) {
    return hit
  }
  const [ex, ey, ew, eh] = HOME_RECTS[key]
  const w = x1 - x0
  if (ew <= 0 || eh <= 0 || x0 < 0 || x1 > ew || w <= 0 || ex + ew > tex.width || ey + eh > tex.height) {
    return null
  }
  const frame = new SpriteFrame()
  frame.texture = tex
  frame.rect = new Rect(ex + x0, ey, w, eh)
  frame.originalSize = new Size(w, eh)
  frame.packable = false
  frameCache.set(cacheKey, frame)
  return frame
}

/** 取某元素整帧；未加载成功或标定为空时返回 null（调用方回退代码绘制） */
export function homeFrame(key: HomeUiKey): SpriteFrame | null {
  const [x, y, w, h] = HOME_RECTS[key]
  if (w <= 0 || h <= 0) {
    return null
  }
  return sliceFrame(key, 0, w)
}

function spriteChild(parent: Node, name: string, frame: SpriteFrame, w: number, h: number, x: number): void {
  const n = createNode(name, parent, w, h)
  n.setPosition(x, 0)
  const sp = n.addComponent(Sprite)
  sp.type = Sprite.Type.SIMPLE
  sp.sizeMode = Sprite.SizeMode.CUSTOM
  sp.spriteFrame = frame
}

/**
 * 三段拉伸贴图：左帽 capL 像素、右帽 capR 像素按高度等比保形（图标/锁/胶囊
 * 不变形），中间段横向拉伸补齐 w——效果图里的超宽行/按钮/搜索条比例与素材
 * 原生比例不符（如效果图行 21:1 vs 素材 10.6:1），靠这个拉开还不糊图标。
 */
export function attachHomeUiSliced(parent: Node, key: HomeUiKey, capL: number, capR: number, w: number, h: number): Node {
  const node = createNode(`home-${key}`, parent, w, h)
  const [, , ew, eh] = HOME_RECTS[key]
  const full = homeFrame(key)
  if (!full || eh <= 0) {
    return node
  }
  const k = h / eh
  const lw = Math.min(capL * k, w / 2)
  const rw = Math.min(capR * k, w / 2)
  const left = sliceFrame(key, 0, capL)
  const mid = sliceFrame(key, capL, ew - capR)
  const right = sliceFrame(key, ew - capR, ew)
  if (left && mid && right) {
    spriteChild(node, 'capL', left, lw, h, -w / 2 + lw / 2)
    spriteChild(node, 'mid', mid, Math.max(w - lw - rw, 0), h, -w / 2 + lw + Math.max(w - lw - rw, 0) / 2)
    spriteChild(node, 'capR', right, rw, h, w / 2 - rw / 2)
  } else {
    // 子条切不出来时退整帧拉伸（好过空白）
    spriteChild(node, 'full', full, w, h, 0)
  }
  return node
}

/** 在独立子节点上贴某元素（SIMPLE + CUSTOM 拉伸到指定尺寸）；无帧时返回空节点占位 */
export function attachHomeUi(parent: Node, key: HomeUiKey, w: number, h: number): Node {
  const node = createNode(`home-${key}`, parent, w, h)
  const frame = homeFrame(key)
  if (frame) {
    spriteChild(node, 'full', frame, w, h, 0)
  }
  return node
}
