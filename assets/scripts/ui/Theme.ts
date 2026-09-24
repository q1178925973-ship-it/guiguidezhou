import { Color, Graphics, Label, Layers, Node, tween, UITransform, Vec3 } from 'cc'

/** 十六进制色串转 Color */
export const hex = (s: string): Color => new Color().fromHEX(s)

/** 颜色按比例调暗（f<1）/ 调亮（f>1） */
export const shade = (c: Color, f: number): Color =>
  new Color(
    Math.min(255, Math.round(c.r * f)),
    Math.min(255, Math.round(c.g * f)),
    Math.min(255, Math.round(c.b * f)),
    c.a,
  )

/**
 * 全局视觉常量：深色房间 + 墨绿桌面 + 奶油牌面 + 金色点缀。
 * 刻意避开「白卡片 + 蓝紫渐变」的通用模板配色。
 */
export const THEME = {
  roomBg: hex('#14171e'),
  felt: hex('#3a8a63'),
  feltRim: hex('#1d5741'),
  gold: hex('#d9a441'),
  goldBright: hex('#f5c469'),
  panel: hex('#1e2330'),
  cardFace: hex('#faf6ec'),
  cardBorder: hex('#cfc6ad'),
  cardBack: hex('#8c2f39'),
  cardBackLine: hex('#d9a441'),
  inkBlack: hex('#20242b'),
  inkRed: hex('#b3382e'),
  textBright: hex('#e8e4da'),
  textDim: hex('#9aa3b2'),
  fold: hex('#a84332'),
  call: hex('#3d7a63'),
  raise: hex('#b8862d'),
}

/** 常用尺寸 */
export const SIZE = {
  cardW: 72,
  cardH: 102,
  botCardW: 50,
  botCardH: 70,
  comCardW: 64,
  comCardH: 90,
}

/** 新建节点并挂 UITransform（可选尺寸） */
export function createNode(name: string, parent: Node, w = 0, h = 0): Node {
  const node = new Node(name)
  // 代码创建的节点默认在 DEFAULT 层，Canvas 的 UI 相机只渲染 UI_2D 层，
  // 不显式归层会被 3D 相机以透视方式拍成斜面
  node.layer = Layers.Enum.UI_2D
  parent.addChild(node)
  const ut = node.addComponent(UITransform)
  if (w > 0 && h > 0) {
    ut.setContentSize(w, h)
  }
  return node
}

/** 新建文本（默认系统字体，中文可正常渲染） */
export function createLabel(parent: Node, text: string, fontSize: number, color: Color, bold = false): Label {
  const node = createNode('Label', parent)
  const label = node.addComponent(Label)
  label.string = text
  label.fontSize = fontSize
  label.lineHeight = fontSize + 6
  label.color = color
  label.isBold = bold
  return label
}

/** 给文本加深色描边（浅色 / 花色背景上保证可读，如桌面上的金额） */
export function withOutline(label: Label, width = 2): Label {
  label.enableOutline = true
  label.outlineColor = THEME.inkBlack
  label.outlineWidth = width
  return label
}

/**
 * 磨砂玻璃面板（近似 glassmorphism）：半透明深底 + 上半微白反光 + 下部渐暗
 * + 内侧半透明白描边。用于名牌 / 底池 / 聊天面板 / 操作按钮等浮在桌面上的元素。
 */
export function drawGlassPanel(g: Graphics, w: number, h: number, r: number): void {
  g.clear()
  // 磨砂基底：半透明深蓝灰
  g.fillColor = new Color(24, 30, 42, 130)
  g.roundRect(-w / 2, -h / 2, w, h, r)
  g.fill()
  // 上半反光：玻璃自上而下的亮度
  g.fillColor = new Color(255, 255, 255, 20)
  g.roundRect(-w / 2 + 2, 0, w - 4, h / 2 - 2, Math.max(2, r / 2))
  g.fill()
  // 下部渐暗：加一点厚度感
  g.fillColor = new Color(10, 14, 22, 45)
  g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h / 4, Math.max(2, r / 2))
  g.fill()
  // 内侧白描边：玻璃边缘高光
  g.lineWidth = 1.5
  g.strokeColor = new Color(255, 255, 255, 68)
  g.roundRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, Math.max(2, r - 1))
  g.stroke()
}

/** 在 Graphics 上绘制居中圆角矩形（fill 必填，stroke 可选） */
export function drawRoundRect(g: Graphics, w: number, h: number, r: number, fill: Color, stroke?: Color, lineW = 2): void {
  g.clear()
  g.fillColor = fill
  g.roundRect(-w / 2, -h / 2, w, h, r)
  g.fill()
  if (stroke) {
    g.lineWidth = lineW
    g.strokeColor = stroke
    g.roundRect(-w / 2, -h / 2, w, h, r)
    g.stroke()
  }
}

export interface SimpleButton {
  node: Node
  label: Label
  setLabel: (text: string) => void
}

/** 代码创建按钮：立体筹码感（深色底座 + 主面 + 顶部高光）+ 按压缩放动效（点击逻辑由调用方监听 TOUCH_END） */
export function createButton(
  parent: Node,
  text: string,
  w: number,
  h: number,
  bg: Color,
  fontSize = 22,
  textColor: Color = THEME.textBright,
): SimpleButton {
  const node = createNode(`btn-${text}`, parent, w, h)
  const g = node.addComponent(Graphics)
  const r = Math.min(14, h * 0.32)
  // 底座：下移的深色层，露出的部分形成厚度感
  g.fillColor = shade(bg, 0.55)
  g.roundRect(-(w - 4) / 2, -(h - 4) / 2 - 2, w - 4, h - 4, r)
  g.fill()
  // 主面：略短，让底座在底部露出一条边
  g.fillColor = bg
  g.roundRect(-(w - 4) / 2, -(h - 8) / 2 + 1, w - 4, h - 8, r)
  g.fill()
  // 顶部高光细线
  g.lineWidth = 1.5
  g.strokeColor = new Color(255, 255, 255, 42)
  g.roundRect(-(w - 12) / 2, -(h - 8) / 2 + 4, w - 12, h - 18, Math.max(4, r - 4))
  g.stroke()
  const label = createLabel(node, text, fontSize, textColor, true)
  label.node.setPosition(0, -1)
  const press = (): void => {
    tween(node).to(0.1, { scale: new Vec3(0.94, 0.94, 1) }).start()
  }
  const release = (): void => {
    tween(node).to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()
  }
  node.on(Node.EventType.TOUCH_START, press)
  node.on(Node.EventType.TOUCH_END, release)
  node.on(Node.EventType.TOUCH_CANCEL, release)
  return { node, label, setLabel: (t: string) => (label.string = t) }
}

/** 磨砂玻璃按钮：玻璃面 + accent 色文字（弃牌红 / 跟注绿 / 加注金），带按压缩放动效 */
export function createGlassButton(
  parent: Node,
  text: string,
  w: number,
  h: number,
  fontSize = 22,
  accent: Color = THEME.textBright,
): SimpleButton {
  const node = createNode(`btn-${text}`, parent, w, h)
  drawGlassPanel(node.addComponent(Graphics), w, h, Math.min(14, h * 0.32))
  const label = createLabel(node, text, fontSize, accent, true)
  label.node.setPosition(0, -1)
  const press = (): void => {
    tween(node).to(0.1, { scale: new Vec3(0.94, 0.94, 1) }).start()
  }
  const release = (): void => {
    tween(node).to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()
  }
  node.on(Node.EventType.TOUCH_START, press)
  node.on(Node.EventType.TOUCH_END, release)
  node.on(Node.EventType.TOUCH_CANCEL, release)
  return { node, label, setLabel: (t: string) => (label.string = t) }
}
