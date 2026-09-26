import { Color, Graphics, Node, Tween, tween, Vec3 } from 'cc'
import { createButton, createLabel, createNode, drawGlassPanel, THEME } from './Theme'

/**
 * 通用确认弹窗：遮罩 + 玻璃面板 + 标题 / 正文 / 确认 / 取消。
 * 点确认回调 onOk 后自毁；取消或点遮罩直接自毁（都先回调 onClose 清引用）。
 * 用途：退出账号确认、最后一名玩家退房关房确认。
 */
export class ConfirmBox {
  readonly node: Node
  private readonly panel: Node
  private readonly onClose: () => void

  constructor(
    parent: Node,
    title: string,
    text: string,
    okText: string,
    onOk: () => void,
    onClose: () => void = () => undefined,
  ) {
    this.onClose = onClose
    this.node = createNode('confirmBox', parent)
    const mask = createNode('mask', this.node, 1280, 720)
    const mg = mask.addComponent(Graphics)
    mg.fillColor = new Color(10, 13, 20, 150)
    mg.rect(-640, -360, 1280, 720)
    mg.fill()
    mask.on(Node.EventType.TOUCH_END, () => this.hide())

    this.panel = createNode('panel', this.node, 440, 230)
    drawGlassPanel(this.panel.addComponent(Graphics), 440, 230, 20)
    this.panel.on(Node.EventType.TOUCH_END, (ev) => {
      ev.propagationStopped = true
    })
    this.panel.setScale(0.8, 0.8, 1)
    tween(this.panel).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()

    const titleLabel = createLabel(this.panel, title, 24, THEME.goldBright, true)
    titleLabel.node.setPosition(0, 68)
    const textLabel = createLabel(this.panel, text, 16, THEME.textBright)
    textLabel.node.setPosition(0, 12)
    textLabel.maxLineWidth = 380

    const cancel = createButton(this.panel, '取消', 130, 48, THEME.panel, 19)
    cancel.node.setPosition(-82, -72)
    cancel.node.on(Node.EventType.TOUCH_END, () => this.hide())
    const ok = createButton(this.panel, okText, 150, 48, THEME.call, 19)
    ok.node.setPosition(82, -72)
    ok.node.on(Node.EventType.TOUCH_END, () => {
      this.hide()
      onOk()
    })
  }

  hide(): void {
    Tween.stopAllByTarget(this.panel)
    this.onClose()
    this.node.destroy()
  }
}
