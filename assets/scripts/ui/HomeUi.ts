import { Node, Rect, Size, Sprite, SpriteFrame, Texture2D, resources } from 'cc'
import { createNode } from './Theme'

/**
 * 大厅雪碧图（assets/resources/home-ui.webp，1672×941 原图压成的 webp）。
 * 元素坐标由 tools/optimize/convert-home.mjs 连通域分析标定（见该脚本输出对照表），
 * 存的是【图源左上像素坐标】；SpriteFrame.rect 原点即图像左上，直接使用无需翻转。
 * 任一帧缺失都返回 null，调用方回退 Theme 代码绘制，不阻塞大厅可用。
 */
export type HomeUiKey =
  | 'bg' // 池塘夜景插画（#0 812×431）
  | 'panel' // 房间列表面板框（#1 596×396）
  | 'nav' // 左侧导航条（#2 199×444，含 4 图标；暂未用，导航用代码画保证选中态对齐）
  | 'playerBar' // 顶栏玩家信息条（#3 427×146）
  | 'roomRow' // 房间行底条（#4 787×74，左端带锁形装饰）
  | 'bannerGreen' // 空绿横幅（#5 396×105，备用）
  | 'btnCreate' // 创建房间大按钮（#6 409×97，绿 + 加号 + 文案已烧在图上）
  | 'btnQuick' // 快速加入大按钮（#7 382×97，金 + 骰子 + 文案已烧在图上）
  | 'searchBox' // 搜索框（#8 471×77，左端放大镜）
  | 'bannerSmall' // 空小横幅（#9 310×105，备用）
  | 'mascot' // 乌龟吉祥物（#10 177×168）
  | 'avatarRing' // 头像金圈（#11 154×154）
  | 'cardFrame' // 小方框（#12 130×132，备用）
  | 'btnJoin' // 加入小按钮（#13 195×63，金，文案已烧在图上）
  | 'btnFull' // 已满小按钮（#14 195×63，灰，文案已烧在图上）
  | 'btnRefresh' // 刷新圆钮（#15 85×86）
  | 'iconSound' // 声音圆钮（#18，备用：工具条已有代码画法）
  | 'iconFullscreen' // 全屏圆钮（#16，备用）
  | 'iconFeedback' // 反馈圆钮（#17，备用）
  | 'iconSettings' // 设置圆钮（#19，备用）
  | 'lockClosed' // 闭锁图标（#20）
  | 'lockOpen' // 开锁图标（#21）
  | 'lockClosed2' // 闭锁图标另一态（#22，备用）

/** 图源左上坐标 [x, y, w, h]（1672×941 原图像素；元素 #i 的标定值） */
const HOME_RECTS: Record<HomeUiKey, [number, number, number, number]> = {
  bg: [15, 15, 812, 431],
  panel: [1058, 32, 596, 396],
  nav: [843, 55, 199, 444],
  playerBar: [40, 464, 427, 146],
  roomRow: [639, 697, 787, 74],
  bannerGreen: [988, 804, 396, 105],
  btnCreate: [572, 571, 409, 97],
  btnQuick: [1032, 571, 382, 97],
  searchBox: [1064, 464, 471, 77],
  bannerSmall: [648, 804, 310, 105],
  mascot: [26, 633, 177, 168],
  avatarRing: [304, 775, 154, 154],
  cardFrame: [488, 786, 130, 132],
  btnJoin: [1453, 571, 195, 63],
  btnFull: [1453, 646, 195, 63],
  btnRefresh: [1558, 461, 85, 86],
  iconSound: [237, 682, 83, 84],
  iconFullscreen: [332, 682, 84, 84],
  iconFeedback: [427, 682, 84, 84],
  iconSettings: [522, 683, 84, 83],
  lockClosed: [50, 820, 80, 76],
  lockOpen: [131, 820, 80, 75],
  lockClosed2: [213, 819, 78, 76],
}

let tex: Texture2D | null = null
const frameCache = new Map<HomeUiKey, SpriteFrame>()
let pending: Promise<void> | null = null

/** 懒加载大厅雪碧图（重复调用返回同一 Promise；失败只告警不阻塞） */
export function loadHomeUi(): Promise<void> {
  if (pending) {
    return pending
  }
  pending = new Promise<void>((resolve) => {
    resources.load('home-ui/texture', Texture2D, (err, t) => {
      if (!err && t) {
        tex = t
        console.log(`[HomeUi] 大厅雪碧图已加载：${t.width}×${t.height}`)
      } else {
        console.warn('[HomeUi] resources/home-ui.webp 加载失败，大厅回退代码绘制', err)
      }
      resolve()
    })
  })
  return pending
}

/** 取某元素帧；未加载成功或标定为空时返回 null（调用方回退代码绘制） */
export function homeFrame(key: HomeUiKey): SpriteFrame | null {
  if (!tex) {
    return null
  }
  const hit = frameCache.get(key)
  if (hit) {
    return hit
  }
  const [x, y, w, h] = HOME_RECTS[key]
  if (w <= 0 || h <= 0 || x + w > tex.width || y + h > tex.height) {
    return null
  }
  // SpriteFrame.rect 原点即图像左上（与 CardFaces 切帧同口径），直接用图源坐标，不做 y 翻转
  const frame = new SpriteFrame()
  frame.texture = tex
  frame.rect = new Rect(x, y, w, h)
  frame.originalSize = new Size(w, h)
  frame.packable = false
  frameCache.set(key, frame)
  return frame
}

/** 在独立子节点上贴某元素（SIMPLE + CUSTOM 拉伸到指定尺寸）；无帧时返回空节点占位 */
export function attachHomeUi(parent: Node, key: HomeUiKey, w: number, h: number): Node {
  const node = createNode(`home-${key}`, parent, w, h)
  const frame = homeFrame(key)
  if (frame) {
    const sp = node.addComponent(Sprite)
    sp.type = Sprite.Type.SIMPLE
    sp.sizeMode = Sprite.SizeMode.CUSTOM
    sp.spriteFrame = frame
  }
  return node
}
