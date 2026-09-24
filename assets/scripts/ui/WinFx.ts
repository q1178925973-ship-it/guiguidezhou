import { Color, Graphics, Node, Tween, tween, UIOpacity, Vec3 } from 'cc'
import { createNode, shade, THEME } from './Theme'

/**
 * 胜利庆祝特效：金币从底池飞向赢家座位，到达后爆金币（抛物线飞散 + 淡出）。
 * 坐标均为挂载父节点（Game 根节点）的局部坐标系。
 */
export class WinFx {
  readonly node: Node

  constructor(parent: Node) {
    this.node = createNode('winFx', parent)
  }

  /** n 枚金币从 from 飞向 to（错峰出发），最后一枚落地时在 to 爆开 */
  fly(from: Vec3, to: Vec3, n = 6): void {
    for (let i = 0; i < n; i++) {
      const coin = this.spawnCoin()
      coin.setPosition(from.x + (Math.random() - 0.5) * 34, from.y + (Math.random() - 0.5) * 22, 0)
      const last = i === n - 1
      tween(coin)
        .delay(i * 0.07)
        .to(
          0.4,
          { position: new Vec3(to.x + (Math.random() - 0.5) * 26, to.y + (Math.random() - 0.5) * 20, 0) },
          { easing: 'quadIn' },
        )
        .call(() => {
          coin.destroy()
          if (last) {
            this.burst(to, 16)
          }
        })
        .start()
    }
  }

  /** 金币爆开：随机方向抛物线（先升后落）并旋转缩小、末端淡出 */
  burst(at: Vec3, n = 16): void {
    for (let i = 0; i < n; i++) {
      const coin = this.spawnCoin()
      coin.setPosition(at.x, at.y, 0)
      const a = Math.random() * Math.PI * 2
      const d = 50 + Math.random() * 110
      const peak = new Vec3(at.x + Math.cos(a) * d * 0.7, at.y + 60 + Math.random() * 90, 0)
      const land = new Vec3(at.x + Math.cos(a) * d, at.y - 40 - Math.random() * 70, 0)
      const op = coin.addComponent(UIOpacity)
      tween(coin)
        .to(0.3, { position: peak, scale: new Vec3(1.2, 1.2, 1) }, { easing: 'quadOut' })
        .to(0.45, { position: land, scale: new Vec3(0.6, 0.6, 1) }, { easing: 'quadIn' })
        .call(() => coin.destroy())
        .start()
      tween(op).delay(0.42).to(0.3, { opacity: 0 }).start()
    }
  }

  /** 收池：n 枚小筹码从各座位下注点飞向底池（错峰出发，落地即隐） */
  flyChips(from: Vec3, to: Vec3, n = 4): void {
    for (let i = 0; i < n; i++) {
      const chip = this.spawnChip()
      chip.setPosition(from.x + (Math.random() - 0.5) * 30, from.y + (Math.random() - 0.5) * 16, 0)
      tween(chip)
        .delay(i * 0.05)
        .to(
          0.32,
          { position: new Vec3(to.x + (Math.random() - 0.5) * 40, to.y + (Math.random() - 0.5) * 14, 0) },
          { easing: 'quadIn' },
        )
        .call(() => chip.destroy())
        .start()
    }
  }

  /** 清空尚未结束的金币（新一手开始时调用） */
  clear(): void {
    this.node.children.slice().forEach((c) => {
      Tween.stopAllByTarget(c)
      c.destroy()
    })
  }

  /** 一枚金币：深金外圈 + 金面 + 内圈线 */
  private spawnCoin(): Node {
    const coin = createNode('coin', this.node)
    const g = coin.addComponent(Graphics)
    g.fillColor = shade(THEME.gold, 0.55)
    g.circle(0, 0, 10)
    g.fill()
    g.fillColor = THEME.gold
    g.circle(0, 0, 8.5)
    g.fill()
    g.lineWidth = 1.5
    g.strokeColor = shade(THEME.gold, 0.62)
    g.circle(0, 0, 5.5)
    g.stroke()
    return coin
  }

  /** 一枚飞行筹码：小号金面 + 白色内圈 */
  private spawnChip(): Node {
    const chip = createNode('flyChip', this.node)
    const g = chip.addComponent(Graphics)
    g.fillColor = shade(THEME.gold, 0.55)
    g.circle(0, 0, 9)
    g.fill()
    g.fillColor = THEME.gold
    g.circle(0, 0, 7.5)
    g.fill()
    g.lineWidth = 1.5
    g.strokeColor = new Color(232, 228, 218, 200)
    g.circle(0, 0, 4.5)
    g.stroke()
    return chip
  }
}
