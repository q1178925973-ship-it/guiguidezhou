import { Node, Tween, tween, UIOpacity, Vec3 } from 'cc'
import { createGlassButton, createNode, shade, THEME } from './Theme'

const BASE_X = 470
const BASE_Y = -300
const HIDDEN_Y = -348

/**
 * 局末右下角控制条：「重开」「下一局」。
 * 仅在一局结算后显示（与操作条不同时出现），滑入/淡出带过渡。
 */
export class EndBar {
  readonly node: Node
  private readonly opacity: UIOpacity
  private nextHandler: (() => void) | null = null
  private restartHandler: (() => void) | null = null

  constructor(parent: Node) {
    this.node = createNode('endBar', parent)
    this.node.setPosition(BASE_X, BASE_Y)
    this.opacity = this.node.addComponent(UIOpacity)
    this.opacity.opacity = 0
    this.node.active = false
    const restart = createGlassButton(this.node, '重开', 110, 62, 26, shade(THEME.fold, 1.35))
    restart.node.setPosition(-140, 0)
    restart.node.on(Node.EventType.TOUCH_END, () => this.restartHandler?.())
    const next = createGlassButton(this.node, '下一局', 150, 62, 26, shade(THEME.call, 1.55))
    next.node.setPosition(0, 0)
    next.node.on(Node.EventType.TOUCH_END, () => this.nextHandler?.())
  }

  show(onNext: () => void, onRestart: () => void): void {
    this.nextHandler = onNext
    this.restartHandler = onRestart
    this.node.active = true
    Tween.stopAllByTarget(this.node)
    Tween.stopAllByTarget(this.opacity)
    this.node.setPosition(BASE_X, HIDDEN_Y)
    this.opacity.opacity = 0
    tween(this.opacity).to(0.22, { opacity: 255 }).start()
    tween(this.node)
      .to(0.22, { position: new Vec3(BASE_X, BASE_Y, 0) }, { easing: 'quadOut' })
      .start()
  }

  hide(): void {
    this.nextHandler = null
    this.restartHandler = null
    Tween.stopAllByTarget(this.opacity)
    tween(this.opacity)
      .to(0.18, { opacity: 0 })
      .call(() => {
        if (this.opacity.opacity === 0) {
          this.node.active = false
        }
      })
      .start()
  }
}
