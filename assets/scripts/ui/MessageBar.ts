import { Graphics, Label, Node, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc'
import { createIcon, ICON } from './IconFont'
import { createButton, createLabel, createNode, drawRoundRect, THEME } from './Theme'

/** 中央结算横幅 + 破产重开弹窗（顶部阶段提示已并入右上角工具条徽标） */
export class MessageBar {
  readonly node: Node
  private readonly bannerNode: Node
  private readonly bannerG: Graphics
  private readonly bannerTitle: Label
  private readonly trophyIcon: Label
  private readonly linesHost: Node
  private readonly bannerOpacity: UIOpacity
  private modal: Node | null = null

  constructor(parent: Node) {
    this.node = createNode('messages', parent)
    // 中央结算横幅：奖杯图标 + 左对齐金色标题 + 箭头引导的明细行
    this.bannerNode = createNode('banner', this.node)
    this.bannerNode.setPosition(0, 150)
    this.bannerG = createNode('bannerBg', this.bannerNode).addComponent(Graphics)
    this.trophyIcon = createIcon(this.bannerNode, ICON.trophy, 30, THEME.goldBright)
    this.bannerTitle = createLabel(this.bannerNode, '', 34, THEME.goldBright, true)
    this.bannerTitle.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5)
    this.linesHost = createNode('lines', this.bannerNode)
    this.bannerOpacity = this.bannerNode.addComponent(UIOpacity)
    this.bannerOpacity.opacity = 0
  }

  /** 显示结算结果：奖杯 + 金色标题（谁赢了多少）+ 每行箭头图标引导的明细，缩放淡入 */
  showBanner(title: string, lines: string[]): void {
    this.bannerTitle.string = title
    this.bannerG.clear()
    const w = 680
    const lineH = 40
    const h = 104 + lines.length * lineH
    this.bannerG.fillColor = THEME.panel
    this.bannerG.roundRect(-w / 2, -h / 2, w, h, 16)
    this.bannerG.fill()
    this.bannerG.lineWidth = 2.5
    this.bannerG.strokeColor = THEME.gold
    this.bannerG.roundRect(-w / 2, -h / 2, w, h, 16)
    this.bannerG.stroke()
    // 左对齐版式：奖杯 + 标题占顶部，明细行依次向下排
    this.trophyIcon.node.setPosition(-w / 2 + 44, h / 2 - 46)
    this.bannerTitle.node.setPosition(-w / 2 + 70, h / 2 - 48)
    this.linesHost.children.slice().forEach((row) => row.destroy())
    lines.forEach((text, i) => {
      const y = h / 2 - 106 - i * lineH
      createIcon(this.linesHost, ICON.arrowRight, 18, THEME.goldBright).node.setPosition(-w / 2 + 46, y)
      const label = createLabel(this.linesHost, text, 24, THEME.textBright, true)
      label.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5)
      label.node.setPosition(-w / 2 + 68, y)
    })
    Tween.stopAllByTarget(this.bannerNode)
    Tween.stopAllByTarget(this.bannerOpacity)
    this.bannerNode.setScale(0.7, 0.7, 1)
    this.bannerOpacity.opacity = 255
    tween(this.bannerNode).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()
  }

  hideBanner(): void {
    Tween.stopAllByTarget(this.bannerOpacity)
    tween(this.bannerOpacity).to(0.3, { opacity: 0 }).start()
  }

  /** 破产弹窗：重新开始按钮 */
  showRestart(title: string, onRestart: () => void): void {
    this.hideModal()
    this.modal = createNode('modal', this.node)
    const panel = createNode('panel', this.modal, 480, 280)
    drawRoundRect(panel.addComponent(Graphics), 480, 280, 16, THEME.panel, THEME.gold, 3)
    createLabel(this.modal, title, 34, THEME.textBright, true).node.setPosition(0, 70)
    const btn = createButton(this.modal, '重新开始', 240, 66, THEME.call, 28)
    btn.node.setPosition(0, -60)
    btn.node.on(Node.EventType.TOUCH_END, onRestart)
  }

  hideModal(): void {
    if (this.modal) {
      this.modal.destroy()
      this.modal = null
    }
  }
}
