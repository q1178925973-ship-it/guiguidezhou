import { Color, EditBox, Graphics, Label, Node, Tween, tween, Vec3 } from 'cc'
import { createButton, createGlassButton, createLabel, createNode, drawGlassPanel, drawLockGlyph, shade, THEME } from './Theme'

/** 创建结果：房名（已清洗）+ 总人数 + 盲注档位索引 + 密码（'' = 不设密码） */
export interface CreateRoomResult {
  name: string
  seats: number
  blind: number
  password: string
}

const PANEL_W = 480
const PANEL_H = 500
const BLIND_TIERS = [
  { smallBlind: 10, bigBlind: 20 },
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 100, bigBlind: 200 },
]

/**
 * 创建房间弹窗：房名输入（限 12 字）+ 人数步进（3~8，机器人数 = 总人数 − 真家）
 * + 底注档位四选一。点「创建房间」回调 onConfirm 后自关。
 * 无论确认 / 取消 / 点遮罩关闭，都会先回调 onClose（持有方靠它清引用，
 * 否则取消后再也打不开第二次）。
 * 视觉与 AccountDialog 同族（磨砂玻璃面板 + 玻璃输入框）。
 */
export class CreateRoomDialog {
  readonly node: Node
  private readonly panel: Node
  private readonly nameBox: EditBox
  private readonly passBox: EditBox
  private readonly seatLabel: Label
  private readonly onClose: () => void
  private seats = 6
  private tier = 0

  constructor(parent: Node, onConfirm: (r: CreateRoomResult) => void, onClose: () => void = () => undefined) {
    this.onClose = onClose
    this.node = createNode('createRoomDialog', parent)
    const mask = createNode('mask', this.node, 1280, 720)
    const mg = mask.addComponent(Graphics)
    mg.fillColor = new Color(10, 13, 20, 150)
    mg.rect(-640, -360, 1280, 720)
    mg.fill()
    const closeByMask = (): void => this.hide()
    mask.on(Node.EventType.TOUCH_END, closeByMask)

    this.panel = createNode('panel', this.node, PANEL_W, PANEL_H)
    drawGlassPanel(this.panel.addComponent(Graphics), PANEL_W, PANEL_H, 26)
    this.panel.on(Node.EventType.TOUCH_END, (ev) => {
      ev.propagationStopped = true
    })
    this.panel.setScale(0.7, 0.7, 1)
    tween(this.panel).to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()

    const title = createLabel(this.panel, '创建房间', 28, THEME.goldBright, true)
    title.node.setPosition(0, 212)

    // 房名
    const nameTitle = createLabel(this.panel, '房间名称', 15, THEME.textDim)
    nameTitle.node.setPosition(-PANEL_W / 2 + 34, 160)
    nameTitle.node.anchorX = 0
    this.nameBox = this.buildBox('我的房间', 134)

    // 人数步进
    const seatTitle = createLabel(this.panel, '桌子总人数（空位由机器人补齐）', 15, THEME.textDim)
    seatTitle.node.setPosition(-PANEL_W / 2 + 34, 84)
    seatTitle.node.anchorX = 0
    const minus = createGlassButton(this.panel, '−', 44, 44, 26, THEME.textBright)
    minus.node.setPosition(-40, 44)
    minus.node.on(Node.EventType.TOUCH_END, () => this.stepSeats(-1))
    this.seatLabel = createLabel(this.panel, '6 人', 26, THEME.goldBright, true)
    this.seatLabel.node.setPosition(26, 44)
    const plus = createGlassButton(this.panel, '+', 44, 44, 26, THEME.goldBright)
    plus.node.setPosition(92, 44)
    plus.node.on(Node.EventType.TOUCH_END, () => this.stepSeats(1))

    // 底注档位
    const tierTitle = createLabel(this.panel, '底注档位', 15, THEME.textDim)
    tierTitle.node.setPosition(-PANEL_W / 2 + 34, -10)
    tierTitle.node.anchorX = 0
    const tierRedraws: Array<() => void> = []
    BLIND_TIERS.forEach((t, i) => {
      const chip = createNode(`tier${i}`, this.panel, 100, 40)
      chip.setPosition(-168 + i * 112, -50)
      const g = chip.addComponent(Graphics)
      const label = createLabel(chip, `${t.smallBlind}/${t.bigBlind}`, 15, THEME.textBright, true)
      label.node.setPosition(0, 0)
      const redraw = (): void => {
        const on = this.tier === i
        g.clear()
        g.fillColor = on ? new Color(217, 164, 65, 60) : new Color(24, 30, 42, 130)
        g.roundRect(-50, -20, 100, 40, 12)
        g.fill()
        g.lineWidth = on ? 2 : 1
        g.strokeColor = on ? THEME.gold : new Color(255, 255, 255, 40)
        g.roundRect(-50, -20, 100, 40, 12)
        g.stroke()
        label.color = on ? THEME.goldBright : THEME.textDim
      }
      redraw()
      tierRedraws.push(redraw)
      chip.on(Node.EventType.TOUCH_END, () => {
        this.tier = i
        tierRedraws.forEach((r) => r())
      })
    })

    // 房间密码：留空 = 不设密码（开放加入），填了加入时需输入密码
    const passTitle = createLabel(this.panel, '房间密码（可选）', 15, THEME.textDim)
    passTitle.node.setPosition(-PANEL_W / 2 + 34, -106)
    passTitle.node.anchorX = 0
    const passLock = createNode('passLock', this.panel, 24, 24)
    passLock.setPosition(PANEL_W / 2 - 46, -106)
    const pg = passLock.addComponent(Graphics)
    pg.fillColor = THEME.goldBright
    pg.strokeColor = THEME.goldBright
    drawLockGlyph(pg, 0.8)
    this.passBox = this.buildBox('留空不设密码，设密码后加入需验证', -140)

    const cancel = createButton(this.panel, '取消', 150, 52, THEME.panel, 20)
    cancel.node.setPosition(-88, -210)
    cancel.node.on(Node.EventType.TOUCH_END, () => this.hide())
    const ok = createButton(this.panel, '创建房间', 190, 52, shade(THEME.call, 1.35), 20)
    ok.node.setPosition(88, -210)
    ok.node.on(Node.EventType.TOUCH_END, () => {
      this.hide()
      const name = this.nameBox.string.trim().slice(0, 12) || '我的房间'
      const password = this.passBox.string.replace(/\s+/g, '').slice(0, 12)
      onConfirm({ name, seats: this.seats, blind: this.tier, password })
    })
  }

  private stepSeats(d: number): void {
    this.seats = Math.max(3, Math.min(8, this.seats + d))
    this.seatLabel.string = `${this.seats} 人`
  }

  /** 输入框：玻璃底 + 透明 EditBox（AccountDialog.buildBox 同款） */
  private buildBox(placeholder: string, y: number): EditBox {
    const host = createNode('boxHost', this.panel, 400, 48)
    host.setPosition(0, y)
    drawGlassPanel(host.addComponent(Graphics), 400, 48, 12)
    const editNode = createNode('edit', host, 384, 40)
    const eb = editNode.addComponent(EditBox)
    eb.maxLength = 12
    const ph = createLabel(editNode, placeholder, 17, THEME.textDim)
    ph.node.setPosition(-184, 0)
    ph.node.anchorX = 0
    const tl = createLabel(editNode, '', 17, THEME.textBright)
    tl.node.setPosition(-184, 0)
    tl.node.anchorX = 0
    eb.placeholderLabel = ph
    eb.textLabel = tl
    for (const name of ['PLACEHOLDER_LABEL', 'TEXT_LABEL']) {
      const orphan = editNode.getChildByName(name)
      if (orphan && orphan !== ph.node && orphan !== tl.node) {
        orphan.destroy()
        orphan.removeFromParent()
      }
    }
    return eb
  }

  hide(): void {
    Tween.stopAllByTarget(this.panel)
    this.onClose()
    this.node.destroy()
  }
}
