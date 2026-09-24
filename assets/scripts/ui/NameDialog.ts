import { Color, EditBox, Graphics, Node, tween, Vec3 } from 'cc'
import { createGlassButton, createLabel, createNode, drawGlassPanel, THEME } from './Theme'

const PANEL_W = 480
const PANEL_H = 300

/**
 * 联机入口弹窗：输入昵称后进入牌桌。
 * 玻璃面板 + EditBox（点击聚焦，web 上拉起输入），回车或按钮提交。
 */
export class NameDialog {
  readonly node: Node
  private readonly editBox: EditBox
  private confirmed = false
  private readonly submit: () => void

  constructor(parent: Node, onConfirm: (name: string) => void) {
    this.node = createNode('nameDialog', parent)
    // 半透明遮罩：聚焦注意力（点空白不关闭，必须输名字）
    const mask = createNode('mask', this.node, 1280, 720)
    const mg = mask.addComponent(Graphics)
    mg.fillColor = new Color(10, 13, 20, 150)
    mg.rect(-640, -360, 1280, 720)
    mg.fill()

    const panel = createNode('panel', this.node, PANEL_W, PANEL_H)
    drawGlassPanel(panel.addComponent(Graphics), PANEL_W, PANEL_H, 26)
    panel.setScale(0.7, 0.7, 1)
    tween(panel).to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()

    const title = createLabel(panel, '德州扑克 · 联机对局', 30, THEME.goldBright, true)
    title.node.setPosition(0, 92)
    const desc = createLabel(panel, '输入昵称直接进牌桌，空位由 AI 补齐，满员可观战', 17, THEME.textDim)
    desc.node.setPosition(0, 54)

    // 输入框：玻璃底节点 + 透明 EditBox 子节点（避免同节点渲染组件互相顶掉）
    const boxW = 360
    const boxHost = createNode('editHost', panel, boxW, 52)
    boxHost.setPosition(0, -6)
    drawGlassPanel(boxHost.addComponent(Graphics), boxW, 52, 12)
    const editNode = createNode('edit', boxHost, boxW - 16, 44)
    this.editBox = editNode.addComponent(EditBox)
    this.editBox.maxLength = 8
    const ph = createLabel(editNode, '你的名字', 20, THEME.textDim)
    ph.node.setPosition(-(boxW - 16) / 2 + 16, 0)
    ph.node.anchorX = 0
    const tl = createLabel(editNode, '', 20, THEME.textBright)
    tl.node.setPosition(-(boxW - 16) / 2 + 16, 0)
    tl.node.anchorX = 0
    this.editBox.placeholderLabel = ph
    this.editBox.textLabel = tl
    // addComponent(EditBox) 时组件已自建默认 PLACEHOLDER_LABEL / TEXT_LABEL 子节点
    // （内容是引擎默认的 "label" 字样），赋自己的 label 后要清掉，否则叠显
    for (const name of ['PLACEHOLDER_LABEL', 'TEXT_LABEL']) {
      const orphan = editNode.getChildByName(name)
      if (orphan && orphan !== ph.node && orphan !== tl.node) {
        orphan.destroy()
        orphan.removeFromParent()
      }
    }

    this.submit = (): void => {
      if (this.confirmed) {
        return
      }
      const name = this.editBox.string.trim()
      this.confirmed = true
      tween(panel)
        .to(0.2, { scale: new Vec3(0.85, 0.85, 1) })
        .call(() => onConfirm(name || `玩家${Math.floor(1000 + Math.random() * 9000)}`))
        .start()
    }
    // 回车（输入确认）与按钮都触发提交，confirmed 防重
    editNode.on(EditBox.EDITING_DID_ENDED, this.submit)
    const btn = createGlassButton(panel, '进入牌桌', 220, 50, 22, THEME.goldBright)
    btn.node.setPosition(0, -100)
    btn.node.on(Node.EventType.TOUCH_END, this.submit)
  }

  hide(): void {
    this.node.removeFromParent()
    this.node.destroy()
  }
}
