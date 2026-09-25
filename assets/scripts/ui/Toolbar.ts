import { Color, EventTouch, Graphics, Label, Node, Tween, tween, UITransform, Vec3 } from 'cc'
import { FullscreenResult, toggleFullscreen } from './Boot'
import { createIcon, ICON, setIconChar } from './IconFont'
import { createButton, createLabel, createNode, drawGlassPanel, THEME, withOutline } from './Theme'

/** 胶囊高度与圆角（两头全圆） */
const BAR_H = 52
const BAR_R = 26
/** 胶囊左右内边距、图标列间距与总跨度（5 枚 44 宽圆钮：离开/重置/记录/全屏/音效） */
const PAD = 12
const ICON_PITCH = 50
const ICON_SPAN = 4 * ICON_PITCH + 44
/** 徽标与图标列的间隙，及徽标宽度上下限（超宽文本截断加省略号） */
const BADGE_GAP = 12
const BADGE_MIN = 92
const BADGE_MAX = 156
/** Chrome 退出全屏后约 1 秒内会拒绝再次进入：被拒后隔 1.3 秒自动重试一次（仍在手势激活窗口内） */
const RETRY_MS = 1300

export interface ToolbarHandlers {
  /** 音效钮点击：app 侧 sfx.toggleMute() 后把新状态回写 setMuted */
  onSound: () => void
  /** 打开对局记录 */
  onHistory: () => void
  /** 重置确认弹窗点「确认」后才回调（单机重开 / 联机发起投票） */
  onReset: () => void
  /** 退出房间回大厅（多房间联机用） */
  onLeave: () => void
}

/** 圆形图标钮：可换字形（音效/全屏图标随状态换面） */
interface IconButton {
  node: Node
  setGlyph: (char: string, color?: Color) => void
}

/**
 * 右上角一体化工具条（磨砂玻璃胶囊）：
 * 左端「第 N 手 · 阶段」徽标 + 右端一排圆钮（音效 / 全屏 / 记录 / 重置）。
 * 图标用 Font Awesome 字体字形（与结算奖杯 / 底池金币同一套图标语言）。
 * 全屏切换逻辑内聚于此（失败自动重试一次并文字提示）；
 * 重置点击先弹确认框，确认后才回调，防误触打断对局。
 */
export class Toolbar {
  readonly node: Node
  private readonly barG: Graphics
  private readonly badgeLabel: Label
  private readonly soundBtn: IconButton
  private readonly fullBtn: IconButton
  private readonly resetBtn: IconButton
  private readonly leaveBtn: IconButton
  private readonly handlers: ToolbarHandlers
  /** 确认弹窗挂游戏根节点（非工具条内），保证遮罩按 1280x720 居中 */
  private readonly parentNode: Node
  private badgeW = BADGE_MIN
  private muted = false
  private confirm: Node | null = null
  private hint: Label | null = null
  private hintTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(parent: Node, handlers: ToolbarHandlers) {
    this.parentNode = parent
    this.handlers = handlers
    // 根节点锚在屏幕右上（右缘 640-44=596，与旧控件边距一致），子节点负 x 向左排
    this.node = createNode('toolbar', parent)
    this.node.setPosition(596, 318)
    this.barG = createNode('bar', this.node).addComponent(Graphics)
    this.badgeLabel = withOutline(createLabel(this.node, '', 16, THEME.textBright, true))

    this.soundBtn = createCircleIconButton(this.node, 'sound', ICON.volumeOn, 19, () =>
      handlers.onSound(),
    )
    this.fullBtn = createCircleIconButton(this.node, 'fullscreen', ICON.expand, 17, () => {
      void toggleFullscreen().then((r) => this.onFullscreenOutcome(r))
    })
    const historyBtn = createCircleIconButton(this.node, 'history', ICON.history, 18, () =>
      handlers.onHistory(),
    )
    this.resetBtn = createCircleIconButton(this.node, 'reset', ICON.reset, 18, () =>
      this.showResetConfirm(),
    )
    // 退出房间：图标字体子集没有「门/退出」字形，用 Graphics 画（← 箭头出门框）
    this.leaveBtn = createCircleIconButton(this.node, 'leave', '', 0, () => handlers.onLeave())
    drawLeaveGlyph(this.leaveBtn.node)

    // 图标列右缘对齐：i=0（离开）最靠右，依次向左为 重置 / 记录 / 全屏 / 音效
    const iconX = (i: number): number => -(PAD + 22 + i * ICON_PITCH)
    this.soundBtn.node.setPosition(iconX(4), 0)
    this.fullBtn.node.setPosition(iconX(3), 0)
    historyBtn.node.setPosition(iconX(2), 0)
    this.resetBtn.node.setPosition(iconX(1), 0)
    this.leaveBtn.node.setPosition(iconX(0), 0)

    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', this.syncFullscreen)
      document.addEventListener('webkitfullscreenchange', this.syncFullscreen)
    }
    this.layout()
  }

  /** 徽标文本：自动测宽，超上限截断加省略号，胶囊随之向左伸缩（图标列不动） */
  setPhaseText(text: string): void {
    let t = text
    this.badgeLabel.string = t
    let w = this.measureBadge()
    while (w > BADGE_MAX - 24 && t.length > 3) {
      t = t.slice(0, -2) + '…'
      this.badgeLabel.string = t
      w = this.measureBadge()
    }
    this.badgeW = Math.min(BADGE_MAX, Math.max(BADGE_MIN, w + 24))
    this.layout()
  }

  /** 音效钮换面（喇叭 <-> 静音喇叭），状态由 app 侧 sfx 持有 */
  setMuted(muted: boolean): void {
    this.muted = muted
    this.soundBtn.setGlyph(
      muted ? ICON.volumeOff : ICON.volumeOn,
      muted ? THEME.textDim : THEME.goldBright,
    )
  }

  /** 重置钮可见性（联机：入座且无进行中投票才显示；单机常显） */
  setResetVisible(v: boolean): void {
    this.resetBtn.node.active = v
  }

  /** 离开房间钮可见性（联机进房后显示；单机不显示） */
  setLeaveVisible(v: boolean): void {
    this.leaveBtn.node.active = v
  }

  destroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', this.syncFullscreen)
      document.removeEventListener('webkitfullscreenchange', this.syncFullscreen)
    }
    this.node.destroy()
  }

  private syncFullscreen = (): void => {
    if (this.fullBtn.node.isValid) {
      this.fullBtn.setGlyph(isFullscreen() ? ICON.compress : ICON.expand)
    }
  }

  /** 徽标实测宽度：强制同步排版后读内容宽（拿不到时按字宽估算兜底） */
  private measureBadge(): number {
    try {
      this.badgeLabel.updateRenderData(true)
      const w = this.badgeLabel.node.getComponent(UITransform)!.width
      if (w > 0) {
        return w
      }
    } catch {
      // 走估算兜底
    }
    let w = 0
    for (const ch of this.badgeLabel.string) {
      w += ch.charCodeAt(0) > 0x2e80 ? this.badgeLabel.fontSize : this.badgeLabel.fontSize * 0.56
    }
    return w
  }

  /** 重排胶囊与徽标（图标列坐标固定，只在文本变化时执行） */
  private layout(): void {
    const totalW = PAD + ICON_SPAN + BADGE_GAP + this.badgeW + PAD
    this.barG.node.setPosition(-totalW / 2, 0)
    drawGlassPanel(this.barG, totalW, BAR_H, BAR_R)
    this.badgeLabel.node.setPosition(-(PAD + ICON_SPAN + BADGE_GAP + this.badgeW / 2), 0)
  }

  /** 全屏被拒：1.3 秒后自动重试一次，仍失败则文字提示（不让用户「点了没反应」） */
  private onFullscreenOutcome(r: FullscreenResult): void {
    if (r === 'unsupported') {
      this.showHint('此浏览器不支持网页全屏')
      return
    }
    if (r === 'rejected' && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void toggleFullscreen().then((again) => {
          if (again !== 'ok') {
            this.showHint(again === 'unsupported' ? '此浏览器不支持网页全屏' : '浏览器未允许全屏，请稍后再点')
          }
        })
      }, RETRY_MS)
    }
  }

  /** 全屏钮下方的小提示文字，2.6 秒自动隐藏 */
  private showHint(text: string): void {
    if (!this.hint) {
      this.hint = createLabel(this.fullBtn.node, '', 14, THEME.textBright, true)
      this.hint.node.setPosition(0, -40)
    }
    this.hint.string = text
    this.hint.node.active = true
    if (this.hintTimer) {
      clearTimeout(this.hintTimer)
    }
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null
      if (this.hint?.isValid) {
        this.hint.node.active = false
      }
    }, 2600)
  }

  // ---------- 重置确认弹窗 ----------

  /** 遮罩 + 玻璃面板 + 确认/取消：点确认关窗后回调 onReset（点遮罩或取消即关） */
  private showResetConfirm(): void {
    if (this.confirm) {
      return
    }
    const mask = createNode('resetConfirm', this.parentNode)
    this.confirm = mask
    const dim = createNode('dim', mask, 1280, 720)
    const dg = dim.addComponent(Graphics)
    dg.fillColor = new Color(8, 11, 18, 150)
    dg.rect(-640, -360, 1280, 720)
    dg.fill()
    const panel = createNode('panel', mask, 320, 170)
    drawGlassPanel(panel.addComponent(Graphics), 320, 170, 18)
    createLabel(panel, '确定重置本局？', 24, THEME.textBright, true).node.setPosition(0, 30)
    const ok = createButton(panel, '确认', 118, 46, THEME.call, 22)
    ok.node.setPosition(-76, -44)
    const cancel = createButton(panel, '取消', 118, 46, THEME.panel, 22)
    cancel.node.setPosition(76, -44)
    const close = (): void => {
      if (!this.confirm) {
        return
      }
      Tween.stopAllByTarget(panel)
      this.confirm.destroy()
      this.confirm = null
    }
    mask.on(Node.EventType.TOUCH_END, close)
    panel.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      ev.propagationStopped = true
    })
    ok.node.on(Node.EventType.TOUCH_END, () => {
      close()
      this.handlers.onReset()
    })
    cancel.node.on(Node.EventType.TOUCH_END, close)
    panel.setScale(0.82, 0.82, 1)
    tween(panel).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()
  }
}

/** 是否处于全屏（含 Safari 前缀） */
function isFullscreen(): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  return !!(document.fullscreenElement || doc.webkitFullscreenElement)
}

/** 「退出房间」图标：← 箭头 + 开口门框（子集字体没有对应字形，直接 Graphics 画） */
function drawLeaveGlyph(host: Node): void {
  const g = host.addComponent(Graphics)
  g.lineWidth = 2.5
  g.strokeColor = THEME.goldBright
  g.moveTo(2, 0)
  g.lineTo(-8, 0)
  g.moveTo(-4, -4)
  g.lineTo(-8, 0)
  g.lineTo(-4, 4)
  g.moveTo(4, -7)
  g.lineTo(9, -7)
  g.lineTo(9, 7)
  g.lineTo(4, 7)
  g.stroke()
}

/**
 * 圆形图标钮：深底金圈 44x44 + 隐形 48x48 触控区 + 按压缩放动效；
 * 图标为 Font Awesome 字体字形（createIcon，字体未就绪时自动排队补上），
 * 状态换面走 setGlyph（字号构造时定死，按各图标视觉大小微调）。
 */
function createCircleIconButton(
  host: Node,
  name: string,
  char: string,
  size: number,
  onTap: () => void,
): IconButton {
  const node = createNode(name, host, 44, 44)
  const g = node.addComponent(Graphics)
  g.fillColor = new Color(24, 30, 42, 170)
  g.circle(0, 0, 20)
  g.fill()
  g.lineWidth = 2
  g.strokeColor = THEME.gold
  g.circle(0, 0, 20)
  g.stroke()
  const icon = createIcon(node, char, size, THEME.goldBright)
  const setGlyph = (c: string, color?: Color): void => {
    setIconChar(icon, c, color ?? THEME.goldBright)
  }
  const hit = createNode('hit', node, 48, 48)
  hit.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
    ev.propagationStopped = true
    Tween.stopAllByTarget(node)
    tween(node)
      .to(0.15, { scale: new Vec3(0.9, 0.9, 1) })
      .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start()
    onTap()
  })
  return { node, setGlyph }
}
