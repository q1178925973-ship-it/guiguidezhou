import { Color, EditBox, Graphics, Node, Sprite, Tween, tween, Vec3 } from 'cc'
import { RoomInfo } from '../net/Protocol'
import { attachHomeUi, homeFrame } from './HomeUi'
import { createIcon, ICON, setIconChar } from './IconFont'
import {
  createButton,
  createGlassButton,
  createLabel,
  createNode,
  drawGlassPanel,
  shade,
  THEME,
} from './Theme'
import { attachImage, uiFrame } from './UiRes'

export type LobbyTab = 'rooms' | 'mine' | 'record'

export interface LobbyHandlers {
  /** 点某行的加入（或行本身） */
  onJoinRoom: (roomId: string) => void
  /** 创建房间（底部大按钮 / 左导航第二项 / 快速加入无房可进时的兜底） */
  onCreateRoom: () => void
  /** 手动刷新 */
  onRefresh: () => void
  /** 退出账号：回登录弹窗 */
  onExitAccount: () => void
  /** 切静音，返回切换后的静音态（音效 + BGM 由 app 统一持有） */
  onSound: () => boolean
  /** 全屏切换（app 侧走 Boot.toggleFullscreen） */
  onFullscreen: () => void
}

/** 表格六列的列心横坐标（面板局部坐标，面板宽 722） */
const COLS = {
  id: -300,
  name: -180,
  blind: -52,
  humans: 66,
  state: 152,
  act: 282,
}
const ROW_TOP = 74
const ROW_STEP = 56
const ROW_COUNT = 8

/**
 * 登录后的大厅（1280×720，按用户首页效果图布局）：
 * 池塘夜景背景 + 顶栏（头像/昵称/战绩 + 右上 4 圆钮）+ 左导航 4 项 +
 * 中央房间表格（搜索 / 刷新 / 6 列 8 行缓存行）+ 底部 创建房间 / 快速加入。
 * 素材取 home-ui.webp 雪碧图，任一帧缺失回退 Theme 代码绘制。
 * 快速加入不发协议：客户端挑第一个没满的房加入，空则建房。
 */
export class Lobby {
  readonly node: Node
  private readonly handlers: LobbyHandlers
  private readonly contentRooms: Node
  private readonly contentRecord: Node
  private readonly rows: RowView[] = []
  private readonly navItems: Array<{ node: Node; redraw: () => void }> = []
  private navSel: boolean[] = [true, false, false, false]
  private readonly searchBox: EditBox
  private readonly countLabel: { string: (s: string) => void }
  private readonly nameLabels: Array<(s: string) => void> = []
  private soundIcon!: ReturnType<typeof createIcon>
  private recName!: ReturnType<typeof createLabel>
  private recStats!: ReturnType<typeof createLabel>
  private tab: LobbyTab = 'rooms'
  private rooms: RoomInfo[] = []
  private account: { name: string; won: number; played: number } | null = null
  private muted = false

  constructor(parent: Node, handlers: LobbyHandlers) {
    this.handlers = handlers
    this.node = createNode('lobby', parent, 1280, 720)

    this.buildBg()
    this.buildTopBar()
    this.buildNav()

    // ---------- 中央面板：房间表格 / 战绩页 二选一 ----------
    const panel = attachHomeUi(this.node, 'panel', 722, 480)
    panel.setPosition(90, -10)
    if (!homeFrame('panel')) {
      drawGlassPanel(panel.addComponent(Graphics), 740, 500, 22)
    }
    this.contentRooms = createNode('contentRooms', panel)
    this.contentRecord = createNode('contentRecord', panel)
    this.contentRecord.active = false

    const title = createLabel(this.contentRooms, '德州扑克  ♠', 30, THEME.goldBright, true)
    title.node.setPosition(0, 208)
    const sub = createLabel(this.contentRooms, '公开房间 · 点「加入」直接进桌（满员自动观战）', 14, THEME.textDim)
    sub.node.setPosition(0, 176)

    // 搜索 + 刷新
    const searchHost = attachHomeUi(this.contentRooms, 'searchBox', 330, 48)
    searchHost.setPosition(-172, 138)
    if (!homeFrame('searchBox')) {
      drawGlassPanel(searchHost.addComponent(Graphics), 330, 48, 24)
    }
    const editNode = createNode('edit', searchHost, 290, 40)
    editNode.setPosition(6, 0)
    this.searchBox = editNode.addComponent(EditBox)
    this.searchBox.maxLength = 12
    const ph = createLabel(editNode, '搜索房间号 / 房名', 15, THEME.textDim)
    ph.node.setPosition(-140, 0)
    ph.node.anchorX = 0
    const tl = createLabel(editNode, '', 15, THEME.textBright)
    tl.node.setPosition(-140, 0)
    tl.node.anchorX = 0
    this.searchBox.placeholderLabel = ph
    this.searchBox.textLabel = tl
    for (const name of ['PLACEHOLDER_LABEL', 'TEXT_LABEL']) {
      const orphan = editNode.getChildByName(name)
      if (orphan && orphan !== ph.node && orphan !== tl.node) {
        orphan.destroy()
        orphan.removeFromParent()
      }
    }
    editNode.on('editing-did-ended', () => this.refreshRows())

    const refresh = attachHomeUi(this.contentRooms, 'btnRefresh', 44, 44)
    refresh.setPosition(10, 138)
    if (!homeFrame('btnRefresh')) {
      const rg = refresh.addComponent(Graphics)
      rg.fillColor = new Color(24, 30, 42, 170)
      rg.circle(0, 0, 20)
      rg.fill()
      rg.lineWidth = 2
      rg.strokeColor = THEME.gold
      rg.circle(0, 0, 20)
      rg.stroke()
      createLabel(refresh, '⟳', 22, THEME.goldBright, true)
    }
    refresh.on(Node.EventType.TOUCH_END, () => {
      tween(refresh).to(0.16, { angle: 360 }).call(() => refresh.setRotationFromEuler(0, 0, 0)).start()
      handlers.onRefresh()
    })
    const count = createLabel(this.contentRooms, '', 14, THEME.textDim)
    count.node.setPosition(150, 138)
    this.countLabel = { string: (s: string) => (count.string = s) }

    // 表头
    const headY = 104
    const headers: Array<[string, number]> = [
      ['房间号', COLS.id],
      ['房间名称', COLS.name],
      ['底注', COLS.blind],
      ['人数', COLS.humans],
      ['状态', COLS.state],
      ['操作', COLS.act],
    ]
    headers.forEach(([text, x]) => {
      const h = createLabel(this.contentRooms, text, 14, THEME.textDim, true)
      h.node.setPosition(x, headY)
    })

    // 8 行缓存（setRooms 只重填不重建）
    for (let i = 0; i < ROW_COUNT; i++) {
      this.rows.push(new RowView(this.contentRooms, ROW_TOP - i * ROW_STEP, (id) => handlers.onJoinRoom(id)))
    }

    // 战绩页
    this.buildRecordPage()

    // 底部：创建房间 + 快速加入（文案烧在素材图上，不叠字）
    const create = attachHomeUi(this.node, 'btnCreate', 208, 54)
    create.setPosition(-14, -292)
    if (!homeFrame('btnCreate')) {
      const b = createButton(this.node, '创建房间', 190, 50, shade(THEME.call, 1.35), 20)
      b.node.setPosition(-14, -292)
    }
    create.on(Node.EventType.TOUCH_END, () => handlers.onCreateRoom())
    const quick = attachHomeUi(this.node, 'btnQuick', 200, 54)
    quick.setPosition(212, -292)
    if (!homeFrame('btnQuick')) {
      const b = createButton(this.node, '快速加入', 180, 50, shade(THEME.raise, 1.15), 20)
      b.node.setPosition(212, -292)
    }
    quick.on(Node.EventType.TOUCH_END, () => this.quickJoin())

    // 吉祥物点缀（缺图静默跳过）
    if (homeFrame('mascot')) {
      attachHomeUi(this.node, 'mascot', 116, 110).setPosition(-576, -286)
    }
  }

  private buildBg(): void {
    const bg = attachHomeUi(this.node, 'bg', 1280, 720)
    bg.setPosition(0, 0)
    if (!homeFrame('bg')) {
      const g = bg.addComponent(Graphics)
      g.fillColor = shade(THEME.feltRim, 0.55)
      g.rect(-640, -360, 1280, 720)
      g.fill()
      g.fillColor = new Color(8, 11, 18, 120)
      g.rect(-640, -360, 1280, 720)
      g.fill()
    }
    // 压暗一点，保证表格文字对比度（插画顶部很亮）
    const dim = createNode('bgDim', this.node, 1280, 720)
    const dg = dim.addComponent(Graphics)
    dg.fillColor = new Color(10, 13, 22, 92)
    dg.rect(-640, -360, 1280, 720)
    dg.fill()
  }

  private buildTopBar(): void {
    // 左：头像 + 昵称 + 战绩（素材信息条打底）
    const bar = attachHomeUi(this.node, 'playerBar', 300, 100)
    bar.setPosition(-486, 300)
    if (!homeFrame('playerBar')) {
      drawGlassPanel(bar.addComponent(Graphics), 280, 84, 42)
    }
    const ring = attachHomeUi(bar, 'avatarRing', 66, 66)
    ring.setPosition(-104, 6)
    if (!homeFrame('avatarRing')) {
      const rg = ring.addComponent(Graphics)
      rg.lineWidth = 3
      rg.strokeColor = THEME.gold
      rg.circle(0, 0, 26)
      rg.stroke()
    }
    if (uiFrame('turtle')) {
      const av = attachImage(bar, 'turtle', 44, 44)
      av.setPosition(-104, 6)
    }
    const name = createLabel(bar, '游客', 19, THEME.textBright, true)
    name.node.setPosition(-58, 16)
    name.node.anchorX = 0
    const stat = createLabel(bar, '登录后保存战绩', 14, THEME.textDim)
    stat.node.setPosition(-58, -12)
    stat.node.anchorX = 0
    this.nameLabels.push(
      (s: string) => (name.string = s),
      (s: string) => (stat.string = s),
    )

    // 右：声音 / 全屏 / 战绩 / 退出（圆钮，与房内工具条同一套图标语言）
    const mkIconBtn = (x: number, name: string, draw: (host: Node) => void, onTap: () => void): Node => {
      const node = createNode(name, this.node, 44, 44)
      node.setPosition(x, 318)
      const g = node.addComponent(Graphics)
      g.fillColor = new Color(24, 30, 42, 170)
      g.circle(0, 0, 20)
      g.fill()
      g.lineWidth = 2
      g.strokeColor = THEME.gold
      g.circle(0, 0, 20)
      g.stroke()
      draw(node)
      node.on(Node.EventType.TOUCH_END, () => {
        Tween.stopAllByTarget(node)
        tween(node)
          .to(0.12, { scale: new Vec3(0.9, 0.9, 1) })
          .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start()
        onTap()
      })
      return node
    }
    mkIconBtn(508, 'btnSound', (host) => {
      this.soundIcon = createIcon(host, ICON.volumeOn, 19, THEME.goldBright)
    }, () => {
      this.muted = this.handlers.onSound()
      this.setMuted(this.muted)
    })
    mkIconBtn(560, 'btnFull', (host) => {
      createIcon(host, ICON.expand, 16, THEME.goldBright)
    }, () => this.handlers.onFullscreen())
    mkIconBtn(612, 'btnRecord', (host) => {
      createIcon(host, ICON.trophy, 17, THEME.goldBright)
    }, () => this.setTab('record'))
    mkIconBtn(596 + 56, 'btnExit', (host) => {
      // 电源符号（图标字体子集没有退出键，Graphics 画：圆弧 + 竖线）
      const g = host.addComponent(Graphics)
      g.lineWidth = 3
      g.strokeColor = THEME.goldBright
      g.arc(0, -1, 9, (-70 * Math.PI) / 180, (250 * Math.PI) / 180, false)
      g.stroke()
      g.moveTo(0, -10)
      g.lineTo(0, 2)
      g.stroke()
    }, () => this.handlers.onExitAccount())
  }

  private buildNav(): void {
    const items: Array<{ label: string; action: () => void }> = [
      { label: '🏠 房间列表', action: () => this.setTab('rooms') },
      { label: '➕ 创建房间', action: () => this.handlers.onCreateRoom() },
      { label: '👤 我的房间', action: () => this.setTab('mine') },
      { label: '📊 战绩记录', action: () => this.setTab('record') },
    ]
    this.navSel = [true, false, false, false]
    items.forEach((it, i) => {
      const node = createNode('nav', this.node, 150, 52)
      node.setPosition(-548, 158 - i * 66)
      const g = node.addComponent(Graphics)
      const label = createLabel(node, it.label, 15, THEME.textBright, true)
      const redraw = (): void => {
        const on = this.navSel[i]
        g.clear()
        g.fillColor = on ? new Color(217, 164, 65, 52) : new Color(20, 25, 36, 150)
        g.roundRect(-72, -24, 144, 48, 16)
        g.fill()
        g.lineWidth = on ? 2 : 1
        g.strokeColor = on ? THEME.gold : new Color(255, 255, 255, 30)
        g.roundRect(-72, -24, 144, 48, 16)
        g.stroke()
        label.color = on ? THEME.goldBright : THEME.textDim
      }
      redraw()
      this.navItems.push({ node, redraw })
      node.on(Node.EventType.TOUCH_END, () => {
        // 创建房间是动作不是页签：点完仍回到列表页
        const isAction = i === 1
        this.navSel.forEach((_, j) => (this.navSel[j] = isAction ? j === 0 : j === i))
        this.navItems.forEach((n) => n.redraw())
        it.action()
      })
    })
  }

  private buildRecordPage(): void {
    const title = createLabel(this.contentRecord, '战绩记录', 30, THEME.goldBright, true)
    title.node.setPosition(0, 190)
    const hint = createLabel(this.contentRecord, '账号生涯口径：每打完一手记 1 手，赢家再记 1 胜', 14, THEME.textDim)
    hint.node.setPosition(0, 158)
    this.recName = createLabel(this.contentRecord, '游客（战绩不保存）', 26, THEME.textBright, true)
    this.recName.node.setPosition(0, 92)
    this.recStats = createLabel(this.contentRecord, '登录 / 注册后这里显示生涯战绩', 20, THEME.goldBright, true)
    this.recStats.node.setPosition(0, 30)
    const back = createGlassButton(this.contentRecord, '返回房间列表', 200, 48, 18, THEME.textBright)
    back.node.setPosition(0, -70)
    back.node.on(Node.EventType.TOUCH_END, () => this.setTab('rooms'))
  }

  // ---------- 对外接口 ----------

  show(): void {
    this.node.active = true
  }

  hide(): void {
    this.node.active = false
  }

  setAccount(name: string, won: number, played: number): void {
    this.account = { name, won, played }
    if (this.nameLabels.length) {
      this.nameLabels[0](name)
      this.nameLabels[1](`生涯 胜 ${won} · 手 ${played}`)
    }
    this.renderRecord()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    setIconChar(this.soundIcon, muted ? ICON.volumeOff : ICON.volumeOn, muted ? THEME.textDim : THEME.goldBright)
  }

  setRooms(rooms: RoomInfo[]): void {
    this.rooms = rooms
    this.refreshRows()
  }

  setTab(tab: LobbyTab): void {
    this.tab = tab
    this.contentRooms.active = tab !== 'record'
    this.contentRecord.active = tab === 'record'
    // 页签高亮与当前页同步（创建房间是动作项，保持列表页选中）
    const idx = tab === 'rooms' ? 0 : tab === 'mine' ? 2 : 3
    this.navSel.forEach((_, j) => (this.navSel[j] = j === idx))
    this.navItems.forEach((n) => n.redraw())
    this.refreshRows()
  }

  /** 快速加入：挑第一个没满的房；全满或没有房就建房 */
  private quickJoin(): void {
    const target = this.rooms.find((r) => r.humans < r.seats)
    if (target) {
      this.handlers.onJoinRoom(target.id)
    } else {
      this.handlers.onCreateRoom()
    }
  }

  private filtered(): RoomInfo[] {
    let list = this.rooms
    if (this.tab === 'mine') {
      list = list.filter((r) => r.mine)
    }
    const q = (this.searchBox?.string ?? '').trim().toLowerCase()
    if (q) {
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q))
    }
    return list
  }

  private refreshRows(): void {
    const list = this.filtered()
    this.rows.forEach((row, i) => row.fill(list[i] ?? null))
    this.countLabel.string(
      this.tab === 'mine'
        ? `我的房间 ${list.length} 间`
        : `共 ${this.rooms.length} 间${list.length > ROW_COUNT ? `，显示前 ${ROW_COUNT} 间` : ''}`,
    )
  }

  private renderRecord(): void {
    if (!this.recName || !this.recStats) {
      return
    }
    if (this.account) {
      const { name, won, played } = this.account
      const rate = played > 0 ? Math.round((won / played) * 100) : 0
      this.recName.string = name
      this.recStats.string = `总手数 ${played} · 胜 ${won} · 胜率 ${rate}%`
    } else {
      this.recName.string = '游客（战绩不保存）'
      this.recStats.string = '登录 / 注册后这里显示生涯战绩'
    }
  }
}

/** 一行房间：底条素材 + 六列内容 + 加入按钮（满员换灰钮），fill(null) 整行隐藏 */
class RowView {
  readonly node: Node
  private readonly idL: ReturnType<typeof createLabel>
  private readonly nameL: ReturnType<typeof createLabel>
  private readonly blindL: ReturnType<typeof createLabel>
  private readonly humansL: ReturnType<typeof createLabel>
  private readonly stateL: ReturnType<typeof createLabel>
  private readonly joinBtn: Node
  private readonly joinFallback?: { label: { string: string }; node: Node }
  private roomId = ''

  constructor(parent: Node, y: number, onJoin: (id: string) => void) {
    this.node = createNode('row', parent, 690, 50)
    this.node.setPosition(0, y)
    const row = attachHomeUi(this.node, 'roomRow', 690, 50)
    if (!homeFrame('roomRow')) {
      drawGlassPanel(row.addComponent(Graphics), 690, 50, 14)
    }
    // 行首小锁：开 = 可进，闭 = 已满
    const lock = attachHomeUi(this.node, 'lockOpen', 30, 28)
    lock.setPosition(-322, 0)
    if (!homeFrame('lockOpen')) {
      lock.destroy()
    }
    this.idL = createLabel(this.node, '', 15, THEME.textDim)
    this.idL.node.setPosition(COLS.id, 0)
    this.nameL = createLabel(this.node, '', 16, THEME.textBright, true)
    this.nameL.node.setPosition(COLS.name, 0)
    this.blindL = createLabel(this.node, '', 15, THEME.textBright)
    this.blindL.node.setPosition(COLS.blind, 0)
    this.humansL = createLabel(this.node, '', 15, THEME.textBright)
    this.humansL.node.setPosition(COLS.humans, 0)
    this.stateL = createLabel(this.node, '', 15, THEME.textBright)
    this.stateL.node.setPosition(COLS.state, 0)
    this.joinBtn = attachHomeUi(this.node, 'btnJoin', 82, 34)
    this.joinBtn.setPosition(COLS.act, 0)
    if (!homeFrame('btnJoin')) {
      const b = createGlassButton(this.node, '加入', 82, 34, 16, THEME.goldBright)
      b.node.setPosition(COLS.act, 0)
      this.joinFallback = b
    }
    const tap = (): void => {
      if (this.roomId) {
        onJoin(this.roomId)
      }
    }
    this.joinBtn.on(Node.EventType.TOUCH_END, tap)
    this.joinFallback?.node.on(Node.EventType.TOUCH_END, tap)
  }

  fill(r: RoomInfo | null): void {
    this.node.active = !!r
    if (!r) {
      this.roomId = ''
      return
    }
    this.roomId = r.id
    this.idL.string = r.id
    this.nameL.string = r.name
    this.blindL.string = `${r.smallBlind}/${r.bigBlind}`
    this.humansL.string = `${r.humans}/${r.seats}`
    const full = r.humans >= r.seats
    this.stateL.string = full ? '已满' : r.inHand ? '游戏中' : '等待中'
    this.stateL.color = full ? THEME.textDim : r.inHand ? shade(THEME.call, 1.5) : THEME.textBright
    // 素材钮切换：满员换「已满」灰钮（找不到帧时退玻璃灰字按钮）
    if (this.joinFallback) {
      this.joinFallback.label.string = full ? '已满' : '加入'
    } else {
      const frame = homeFrame(full ? 'btnFull' : 'btnJoin')
      const sp = this.joinBtn.getComponent(Sprite)
      if (sp && frame) {
        sp.spriteFrame = frame
      }
    }
  }
}
