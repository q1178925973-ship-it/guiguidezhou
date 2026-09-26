import { Color, EditBox, Graphics, Node, Tween, tween, Vec3 } from 'cc'
import { createButton, createLabel, createNode, drawGlassPanel, drawLockGlyph, shade, THEME } from './Theme'

/**
 * 加入加密房间时的密码弹窗：金色挂锁 + 密码输入（回车或点「加入」提交）。
 * 密码错误时由持有方调 showError 在弹窗内红字提示，可反复重试；
 * 提交后不关窗，等 roomJoined（成功，持有方关窗）或 err（留窗提示）。
 */
export class PasswordDialog {
  readonly node: Node
  private readonly panel: Node
  private readonly box: EditBox
  private readonly errLabel: ReturnType<typeof createLabel>
  private readonly onClose: () => void

  constructor(parent: Node, roomId: string, onJoin: (password: string) => void, onClose: () => void = () => undefined) {
    this.onClose = onClose
    this.node = createNode('passwordDialog', parent)
    const mask = createNode('mask', this.node, 1280, 720)
    const mg = mask.addComponent(Graphics)
    mg.fillColor = new Color(10, 13, 20, 150)
    mg.rect(-640, -360, 1280, 720)
    mg.fill()
    mask.on(Node.EventType.TOUCH_END, () => this.hide())

    this.panel = createNode('panel', this.node, 420, 320)
    drawGlassPanel(this.panel.addComponent(Graphics), 420, 320, 24)
    this.panel.on(Node.EventType.TOUCH_END, (ev) => {
      ev.propagationStopped = true
    })
    this.panel.setScale(0.75, 0.75, 1)
    tween(this.panel).to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()

    const lock = createNode('lockIcon', this.panel, 34, 34)
    lock.setPosition(0, 110)
    const lg = lock.addComponent(Graphics)
    lg.fillColor = THEME.goldBright
    lg.strokeColor = THEME.goldBright
    drawLockGlyph(lg, 1.15)
    const title = createLabel(this.panel, `房间 ${roomId} 已上锁`, 24, THEME.goldBright, true)
    title.node.setPosition(0, 78)
    const hint = createLabel(this.panel, '输入房间密码加入', 14, THEME.textDim)
    hint.node.setPosition(0, 50)

    const host = createNode('boxHost', this.panel, 340, 48)
    host.setPosition(0, 14)
    drawGlassPanel(host.addComponent(Graphics), 340, 48, 12)
    const editNode = createNode('edit', host, 324, 40)
    this.box = editNode.addComponent(EditBox)
    this.box.maxLength = 12
    this.box.inputFlag = EditBox.InputFlag.PASSWORD
    const ph = createLabel(editNode, '房间密码', 17, THEME.textDim)
    ph.node.setPosition(-154, 0)
    ph.node.anchorX = 0
    const tl = createLabel(editNode, '', 17, THEME.textBright)
    tl.node.setPosition(-154, 0)
    tl.node.anchorX = 0
    this.box.placeholderLabel = ph
    this.box.textLabel = tl
    for (const name of ['PLACEHOLDER_LABEL', 'TEXT_LABEL']) {
      const orphan = editNode.getChildByName(name)
      if (orphan && orphan !== ph.node && orphan !== tl.node) {
        orphan.destroy()
        orphan.removeFromParent()
      }
    }
    editNode.on('editing-did-ended', () => this.submit(onJoin))

    this.errLabel = createLabel(this.panel, '', 14, shade(THEME.fold, 1.5))
    this.errLabel.node.setPosition(0, -22)
    this.errLabel.node.active = false

    const cancel = createButton(this.panel, '取消', 130, 48, THEME.panel, 19)
    cancel.node.setPosition(-78, -80)
    cancel.node.on(Node.EventType.TOUCH_END, () => this.hide())
    const ok = createButton(this.panel, '加入', 150, 48, shade(THEME.call, 1.35), 19)
    ok.node.setPosition(78, -80)
    ok.node.on(Node.EventType.TOUCH_END, () => this.submit(onJoin))
  }

  /** 密码被拒：弹窗内提示并清空重输 */
  showError(msg: string): void {
    this.errLabel.string = msg
    this.errLabel.node.active = true
    this.box.string = ''
  }

  hide(): void {
    Tween.stopAllByTarget(this.panel)
    this.onClose()
    this.node.destroy()
  }

  private submit(onJoin: (password: string) => void): void {
    const pwd = this.box.string.replace(/\s+/g, '').slice(0, 12)
    if (!pwd) {
      this.showError('请输入密码')
      return
    }
    this.errLabel.node.active = false
    onJoin(pwd)
  }
}
