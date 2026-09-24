import { Rect, Size, SpriteFrame, Texture2D, resources } from 'cc'
import { Card, Suit } from '../core/Card'

/**
 * 牌面雪碧图（assets/resources/cards.png，1440×1320 = 9 列 × 6 行，每格 160×220）。
 * 行优先排列：♠A~K → ♥A~K → ♣A~K → ♦A~K → 大王 → 小王。
 * 同时加载牌背（assets/resources/card-back.png）。
 * 启动时加载并切片，CardView 优先用它们显示牌面 / 牌背。
 */
const GRID_COLS = 9
const CELL_W = 160
const CELL_H = 220
const CELL_COUNT = 54

/** 各花色在雪碧图中的起始下标 */
const SHEET_SUIT_BASE: Record<Suit, number> = { s: 0, h: 13, c: 26, d: 39 }

let frames: SpriteFrame[] | null = null
let backFrame: SpriteFrame | null = null

/** 异步加载牌面雪碧图与牌背；任一失败只降级对应部分（CardView 回退代码绘制） */
export function loadCardFaces(): Promise<void> {
  return Promise.all([
    loadTexture('cards').then((tex) => {
      if (!tex) {
        return
      }
      frames = sliceSheet(tex)
      console.log(`[CardFaces] 牌面已加载：${tex.width}×${tex.height}，切 ${frames.length} 帧`)
    }),
    loadTexture('card-back').then((tex) => {
      if (!tex) {
        return
      }
      backFrame = frameOfTexture(tex)
      console.log(`[CardFaces] 牌背已加载：${tex.width}×${tex.height}`)
    }),
  ]).then(() => undefined)
}

/** 加载 resources 下某 PNG 的 texture 子资源（sprite-frame / texture 两种导入类型下都存在） */
function loadTexture(name: string): Promise<Texture2D | null> {
  return new Promise((resolve) => {
    resources.load(`${name}/texture`, Texture2D, (err, tex) => {
      if (err || !tex) {
        console.warn(`[CardFaces] resources/${name}.png 加载失败，将用代码绘制`, err)
        resolve(null)
        return
      }
      resolve(tex)
    })
  })
}

/** 把整张雪碧图切成 54 个 SpriteFrame（rect 原点在图片左上角） */
function sliceSheet(tex: Texture2D): SpriteFrame[] {
  const list: SpriteFrame[] = []
  for (let i = 0; i < CELL_COUNT; i++) {
    const frame = new SpriteFrame()
    frame.texture = tex
    frame.rect = new Rect(
      (i % GRID_COLS) * CELL_W,
      Math.floor(i / GRID_COLS) * CELL_H,
      CELL_W,
      CELL_H,
    )
    frame.originalSize = new Size(CELL_W, CELL_H)
    frame.packable = false
    list.push(frame)
  }
  return list
}

/** 整张纹理作为一帧（牌背、桌面等整图用途） */
export function frameOfTexture(tex: Texture2D): SpriteFrame {
  const frame = new SpriteFrame()
  frame.texture = tex
  frame.rect = new Rect(0, 0, tex.width, tex.height)
  frame.originalSize = new Size(tex.width, tex.height)
  frame.packable = false
  return frame
}

/** 取某张牌的牌面帧；未加载成功时返回 null（调用方回退代码绘制） */
export function frameOfCard(card: Card): SpriteFrame | null {
  if (!frames) {
    return null
  }
  // 雪碧图内 A 在花色首位，其余点数 2~13 对应下标 1~12
  const posInSuit = card.rank === 14 ? 0 : card.rank - 1
  return frames[SHEET_SUIT_BASE[card.suit] + posInSuit] ?? null
}

/** 取牌背帧；未加载成功时返回 null（调用方回退代码绘制） */
export function frameOfBack(): SpriteFrame | null {
  return backFrame
}
