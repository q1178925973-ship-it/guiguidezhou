import {
  Graphics,
  Label,
  Node,
  resources,
  Sprite,
  SpriteFrame,
  Texture2D,
  Tween,
  tween,
  Vec3,
} from 'cc'
import { frameOfTexture } from './CardFaces'
import { createLabel, createNode, drawGlassPanel, THEME } from './Theme'

/**
 * UI 图片素材（assets/resources 下同名 PNG）：
 * 操作按钮四张、玩家卡片、聊天面板、庄家徽章。
 * 启动时统一加载；任一失败只降级对应部分（调用方回退代码绘制，不阻塞开局）。
 */
export type UiResKey =
  | 'btn-fold'
  | 'btn-call'
  | 'btn-raise'
  | 'btn-allin'
  | 'player-card'
  | 'chat-panel'
  | 'dealer-badge'
  | 'turtle'

const UI_KEYS: UiResKey[] = [
  'btn-fold',
  'btn-call',
  'btn-raise',
  'btn-allin',
  'player-card',
  'chat-panel',
  'dealer-badge',
  'turtle',
]

const frames = new Map<UiResKey, SpriteFrame>()
let pending: Promise<void> | null = null

/** 加载全部 UI 素材（重复调用返回同一个 Promise） */
export function loadUiRes(): Promise<void> {
  if (pending) {
    return pending
  }
  pending = Promise.all(
    UI_KEYS.map(
      (key) =>
        new Promise<void>((resolve) => {
          // 与 CardFaces 同一加载口径：走 texture 子资源，兼容两种导入类型
          resources.load(`${key}/texture`, Texture2D, (err, tex) => {
            if (!err && tex) {
              frames.set(key, frameOfTexture(tex))
            } else {
              console.warn(`[UiRes] resources/${key}.png 加载失败，将用代码绘制兜底`)
            }
            resolve()
          })
        }),
    ),
  ).then(() => undefined)
  return pending
}

/** 取某素材帧；未加载成功时返回 null（调用方回退代码绘制） */
export function uiFrame(key: UiResKey): SpriteFrame | null {
  return frames.get(key) ?? null
}

/** 在独立子节点上贴图（SIMPLE + CUSTOM 拉伸到指定尺寸）；无帧时返回空节点占位 */
export function attachImage(parent: Node, key: UiResKey, w: number, h: number): Node {
  const node = createNode(`img-${key}`, parent, w, h)
  const frame = uiFrame(key)
  if (frame) {
    const sp = node.addComponent(Sprite)
    sp.type = Sprite.Type.SIMPLE
    sp.sizeMode = Sprite.SizeMode.CUSTOM
    sp.spriteFrame = frame
  }
  return node
}

export interface ImageButton {
  node: Node
  label: Label
}

/**
 * 图片底操作按钮：素材图打底 + 代码叠文字（素材图无文字），
 * 按压缩放反馈与 createButton 一致；素材缺失时回退磨砂玻璃底。
 */
export function createImageButton(
  parent: Node,
  key: UiResKey,
  text: string,
  w: number,
  h: number,
  fontSize: number,
  textColor = THEME.textBright,
): ImageButton {
  const node = attachImage(parent, key, w, h)
  if (!uiFrame(key)) {
    drawGlassPanel(node.addComponent(Graphics), w, h, h / 2)
  }
  const label = createLabel(node, text, fontSize, textColor, true)
  const press = (down: boolean): void => {
    Tween.stopAllByTarget(node)
    tween(node)
      .to(0.15, { scale: new Vec3(down ? 0.94 : 1, down ? 0.94 : 1, 1) }, { easing: down ? 'quadIn' : 'backOut' })
      .start()
  }
  node.on(Node.EventType.TOUCH_START, () => press(true))
  node.on(Node.EventType.TOUCH_END, () => press(false))
  node.on(Node.EventType.TOUCH_CANCEL, () => press(false))
  return { node, label }
}
