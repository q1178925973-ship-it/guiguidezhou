import { Graphics, Label, Node, tween, UITransform, Vec3 } from 'cc'
import { createLabel, createNode, hex, shade, THEME, withOutline } from './Theme'

/** 筹码面额与配色（近似真实赌场：500 紫 / 100 黑 / 25 绿 / 5 红 / 1 白） */
interface Denom {
  value: number
  face: string
  edge: string
}

const DENOMS: Denom[] = [
  { value: 500, face: '#7b4ea3', edge: '#e8e4da' },
  { value: 100, face: '#333b47', edge: '#e8e4da' },
  { value: 25, face: '#2e7d4f', edge: '#e8e4da' },
  { value: 5, face: '#b3382e', edge: '#faf6ec' },
  { value: 1, face: '#d9d4c5', edge: '#8a8577' },
]

/** 金额 → 各面额数量（贪心拆分，如 60 = 25×2 + 5×2） */
export function splitChips(amount: number): { d: Denom; n: number }[] {
  const out: { d: Denom; n: number }[] = []
  let rest = Math.max(0, Math.round(amount))
  DENOMS.forEach((d) => {
    const n = Math.floor(rest / d.value)
    if (n > 0) {
      out.push({ d, n })
      rest -= n * d.value
    }
  })
  return out
}

/** 在 (x, y) 画一枚俯视筹码：深色包边 + 主体 + 边纹色块 + 内圈线 */
export function drawChip(g: Graphics, x: number, y: number, r: number, value: number): void {
  const d = DENOMS.find((k) => k.value === value) ?? DENOMS[DENOMS.length - 1]
  const face = hex(d.face)
  // 外圈深色包边：浅色桌面（米黄台呢）上也看得清轮廓
  g.fillColor = shade(face, 0.5)
  g.circle(x, y, r)
  g.fill()
  g.fillColor = face
  g.circle(x, y, r * 0.9)
  g.fill()
  g.fillColor = hex(d.edge)
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i
    g.circle(x + Math.cos(a) * r * 0.74, y + Math.sin(a) * r * 0.74, r * 0.13)
    g.fill()
  }
  g.lineWidth = Math.max(1, r * 0.06)
  g.strokeColor = hex(d.edge)
  g.circle(x, y, r * 0.55)
  g.stroke()
}

/** 单摞最多画几枚（金额看旁边药丸标签，塔不用高） */
const MAX_CHIPS = 4

/**
 * 一摞筹码 + 金额药丸标签：所有面额累成单列一摞（大面额沉底），
 * 金额画在深底金边药丸里（浅色 / 花哨桌面上也一眼可读），
 * 药丸在 labelSide 侧（+1 右 / -1 左，由调用方指向背离所属横幅的方向）；
 * setAmount 传 fromLocal 时筹码从该位置错峰飞入。
 */
export class ChipStackView {
  readonly node: Node
  private readonly chipR: number
  private readonly label: Label | null
  private readonly pill: Graphics | null
  private readonly labelSide: number
  private chips: Node[] = []
  private lastAmount = -1

  constructor(parent: Node, chipR = 11, withLabel = true, labelSide = 1) {
    this.node = createNode('chipStack', parent)
    this.chipR = chipR
    this.labelSide = labelSide
    if (withLabel) {
      this.pill = createNode('pill', this.node).addComponent(Graphics)
      this.label = withOutline(createLabel(this.node, '', 18, THEME.goldBright, true), 2.5)
      this.label.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5)
    } else {
      this.pill = null
      this.label = null
    }
  }

  /** 重建筹码堆；金额不变时跳过。fromLocal 为父节点局部坐标的抛出起点 */
  setAmount(amount: number, fromLocal?: Vec3): void {
    if (amount === this.lastAmount) {
      return
    }
    this.lastAmount = amount
    this.chips.forEach((n) => n.destroy())
    this.chips = []
    if (this.label) {
      this.label.string = amount > 0 ? `${amount}` : ''
    }
    // 展开成单列序列：大面额沉底，最多 MAX_CHIPS 枚
    const seq: number[] = []
    splitChips(amount).forEach((c) => {
      for (let i = 0; i < c.n; i++) {
        seq.push(c.d.value)
      }
    })
    const shown = seq.slice(0, MAX_CHIPS)
    const rowH = this.chipR * 0.45
    const baseY = -((shown.length - 1) * rowH) / 2
    shown.forEach((value, i) => {
      const chip = createNode('chip', this.node)
      chip.setPosition(0, baseY + i * rowH, 0)
      drawChip(chip.addComponent(Graphics), 0, 0, this.chipR, value)
      this.chips.push(chip)
      if (fromLocal) {
        this.throw(chip, fromLocal, i * 0.05)
      }
    })
    if (this.label) {
      this.drawPill(amount)
    }
  }

  /** 金额药丸：深底金边，中心在筹码摞的 labelSide 侧（宽度按位数自适应） */
  private drawPill(amount: number): void {
    const g = this.pill!
    const label = this.label!
    g.clear()
    if (amount <= 0) {
      return
    }
    const w = Math.max(38, 26 + `${amount}`.length * 11)
    const cx = this.labelSide * (this.chipR + 6 + w / 2)
    g.fillColor = hex('#141821')
    g.roundRect(cx - w / 2, -12, w, 24, 12)
    g.fill()
    g.lineWidth = 1.5
    g.strokeColor = THEME.gold
    g.roundRect(cx - w / 2, -12, w, 24, 12)
    g.stroke()
    label.node.setPosition(cx, 0, 0)
  }

  /** 筹码从 from 起飞、错峰落位，落地带轻微回弹 */
  private throw(chip: Node, from: Vec3, delay: number): void {
    const to = chip.position.clone()
    chip.setPosition(from.x + (Math.random() - 0.5) * 12, from.y + (Math.random() - 0.5) * 12)
    chip.setScale(0.7, 0.7, 1)
    tween(chip)
      .delay(delay)
      .to(0.3, { position: to, scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start()
  }
}
