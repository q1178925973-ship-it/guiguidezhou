import { Color, Graphics, Node, Tween, tween, Vec3 } from 'cc'
import { createNode, THEME } from './Theme'

/**
 * 纯代码合成音效：浏览器 Web Audio 振荡器生成短促提示音（无需任何音频资源）。
 * 仅适配浏览器预览环境；AudioContext 不可用时静默降级为无声。
 */
export class SoundFx {
  private ctx: AudioContext | null = null
  private muted = false

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) {
          return null
        }
        this.ctx = new AC()
      } catch {
        return null
      }
    }
    // 浏览器自动播放策略：首次用户交互前是 suspended，尝试恢复（失败静默）
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  /** 一个短音：freq 起始频率，slide 滑向目标频率，dur 秒 */
  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number } = {},
  ): void {
    if (this.muted) {
      return
    }
    const ctx = this.ensure()
    if (!ctx) {
      return
    }
    const t0 = ctx.currentTime + (opts.delay ?? 0)
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    if (opts.slide) {
      osc.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur)
    }
    g.gain.setValueAtTime(opts.gain ?? 0.07, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  /** 发牌：轻快双音 */
  deal(): void {
    this.tone(880, 0.06, { type: 'triangle', gain: 0.05 })
    this.tone(1320, 0.05, { type: 'triangle', gain: 0.04, delay: 0.05 })
  }

  /** 翻公共牌：上滑短音 */
  flip(): void {
    this.tone(520, 0.09, { type: 'triangle', slide: 980, gain: 0.06 })
  }

  /** 下注 / 收池：两声清脆高频 */
  chip(): void {
    this.tone(1560, 0.04, { type: 'square', gain: 0.028 })
    this.tone(2080, 0.05, { type: 'square', gain: 0.028, delay: 0.045 })
  }

  /** 胜利：上行四连音 */
  win(): void {
    ;[523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.16, { type: 'triangle', gain: 0.07, delay: i * 0.09 }),
    )
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    return this.muted
  }
}

/** 右上角圆形音效开关：深底金圈 + 喇叭图形（静音画红色斜杠），点击切换 */
export function createSoundToggle(parent: Node, sfx: SoundFx): Node {
  const node = createNode('soundToggle', parent, 44, 44)
  node.setPosition(564, 280)
  const g = node.addComponent(Graphics)
  let muted = false
  const draw = (): void => {
    g.clear()
    // 深色圆底 + 金圈
    g.fillColor = new Color(24, 30, 42, 170)
    g.circle(0, 0, 20)
    g.fill()
    g.lineWidth = 2
    g.strokeColor = THEME.gold
    g.circle(0, 0, 20)
    g.stroke()
    // 喇叭主体（梯形 + 方形音腔）
    g.fillColor = THEME.goldBright
    g.moveTo(-9, -3)
    g.lineTo(-4, -3)
    g.lineTo(2, -9)
    g.lineTo(2, 9)
    g.lineTo(-4, 3)
    g.lineTo(-9, 3)
    g.close()
    g.fill()
    if (muted) {
      g.lineWidth = 2.5
      g.strokeColor = THEME.inkRed
      g.moveTo(-11, 11)
      g.lineTo(11, -11)
      g.stroke()
    } else {
      // 声波：两道右向弧线
      g.lineWidth = 1.8
      g.strokeColor = THEME.goldBright
      g.arc(2, 0, 6, -0.9, 0.9, false)
      g.stroke()
      g.arc(2, 0, 10, -0.75, 0.75, false)
      g.stroke()
    }
  }
  draw()
  node.on(Node.EventType.TOUCH_END, () => {
    muted = sfx.toggleMute()
    draw()
    Tween.stopAllByTarget(node)
    tween(node)
      .to(0.15, { scale: new Vec3(0.9, 0.9, 1) })
      .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start()
  })
  return node
}
