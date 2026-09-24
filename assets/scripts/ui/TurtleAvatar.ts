import { Graphics, Label, Node } from 'cc'
import { createLabel, createNode, hex, shade, THEME } from './Theme'

/** 8 人桌乌龟壳色盘（水墨调，每座一色） */
const SHELL_COLORS = [
  '#4e7d51',
  '#7a6a4f',
  '#3f7d72',
  '#a8793a',
  '#5a7a99',
  '#8a5f6e',
  '#7d9464',
  '#5b6570',
]

/**
 * 俯视可爱乌龟头像：四鳍 + 小尾 + 头（带双眼）+ 带六向纹路的壳，
 * 全部 Graphics 画进直径 d 的圆框内（玩家卡片左侧的头像位）。
 */
export function createTurtle(parent: Node, d: number, colorIndex: number): Node {
  const node = createNode('turtle', parent, d, d)
  const g = node.addComponent(Graphics)
  const shell = hex(SHELL_COLORS[((colorIndex % SHELL_COLORS.length) + SHELL_COLORS.length) % SHELL_COLORS.length])
  const rim = shade(shell, 0.62)
  const light = shade(shell, 1.3)
  // 四鳍（对角小圆）
  g.fillColor = rim
  const fins: [number, number][] = [
    [0.3, 0.19],
    [-0.3, 0.19],
    [0.3, -0.19],
    [-0.3, -0.19],
  ]
  fins.forEach(([fx, fy]) => g.circle(fx * d, fy * d, 0.08 * d))
  g.fill()
  // 小尾巴
  g.moveTo(-0.045 * d, -0.26 * d)
  g.lineTo(0.045 * d, -0.26 * d)
  g.lineTo(0, -0.38 * d)
  g.close()
  g.fill()
  // 头 + 双眼
  g.fillColor = light
  g.circle(0, 0.3 * d, 0.105 * d)
  g.fill()
  g.fillColor = THEME.inkBlack
  g.circle(-0.038 * d, 0.335 * d, 0.02 * d)
  g.circle(0.038 * d, 0.335 * d, 0.02 * d)
  g.fill()
  // 壳主体 + 描边
  g.fillColor = shell
  g.ellipse(0, 0, 0.335 * d, 0.27 * d)
  g.fill()
  g.lineWidth = Math.max(1.5, 0.03 * d)
  g.strokeColor = rim
  g.ellipse(0, 0, 0.335 * d, 0.27 * d)
  g.stroke()
  // 壳纹：中心小圆 + 六向放射短线
  g.lineWidth = Math.max(1, 0.018 * d)
  g.circle(0, 0, 0.075 * d)
  g.stroke()
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k
    g.moveTo(Math.cos(a) * 0.09 * d, Math.sin(a) * 0.09 * d)
    g.lineTo(Math.cos(a) * 0.24 * d, Math.sin(a) * 0.24 * d)
  }
  g.stroke()
  return node
}

/** 盲注小徽章：翻牌前贴头像旁（SB 红 / BB 蓝，金圈白字） */
export function createBlindTag(parent: Node, kind: 'sb' | 'bb'): Node {
  const node = createNode(`blind-${kind}`, parent, 22, 22)
  const g = node.addComponent(Graphics)
  g.fillColor = kind === 'sb' ? hex('#a93b30') : hex('#3a6ea5')
  g.circle(0, 0, 10)
  g.fill()
  g.lineWidth = 2
  g.strokeColor = THEME.gold
  g.circle(0, 0, 10)
  g.stroke()
  createLabel(node, kind.toUpperCase(), 9, THEME.textBright, true)
  return node
}
