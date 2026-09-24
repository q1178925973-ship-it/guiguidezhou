import { _decorator, Component, Graphics, Label, Node, Tween, tween, UIOpacity, Vec3 } from 'cc'
import { Card } from '../core/Card'
import { Player } from '../core/Player'
import { Act } from '../core/Types'
import { CardJ, PlayerSnap, ServerMsg, Snapshot } from '../net/Protocol'
import { NetClient } from '../net/NetClient'
import { ActionBar } from './ActionBar'
import { hideBootSplash, settle, setupBootDom } from './Boot'
import { createFullscreenToggle } from './FullscreenBtn'
import { loadCardFaces } from './CardFaces'
import { ChatLog } from './ChatLog'
import { CommunityView } from './CommunityView'
import { buildHeroHint } from './HeroHint'
import { HistoryPanel } from './HistoryPanel'
import { loadIconFont } from './IconFont'
import { AccountDialog, AuthKind } from './AccountDialog'
import { MessageBar } from './MessageBar'
import { createSoundToggle, SoundFx } from './SoundFx'
import { SeatView } from './SeatView'
import { describeAct, SEAT_LAYOUT_8 } from './SeatLayout'
import { DECK_POS, TABLE_CENTER, TableView } from './TableView'
import { attachImage, loadUiRes, uiFrame } from './UiRes'
import { WinFx } from './WinFx'
import { createGlassButton, createLabel, createNode, drawGlassPanel, shade, SimpleButton, THEME } from './Theme'

const { ccclass } = _decorator

const PHASE_LABEL: Record<Snapshot['phase'], string> = {
  idle: '',
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  over: '结算',
}

const fromCardJ = (c: CardJ): Card => new Card(c.r, c.s)
/** 牌背占位牌（不亮面，内容无意义） */
const DUMMY = new Card(2, 's')

// ---------- 本地凭据（token 自动续登；隐私模式下 localStorage 可能被禁，全部兜底） ----------
const TOKEN_KEY = 'texas_token'
const NAME_KEY = 'texas_name'

function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // 隐私模式等场景存不进去：只是下次要重新登录，不影响本局
  }
}

function loadSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // 同上，静默降级
  }
}
/**
 * 联机入口组件（GameApp 检测到 ?online=1 时移交给它）：
 * 名字弹窗 → 连接服务器 → 纯快照渲染。视角永远以自己为下方座位（观战固定 0 号视角）。
 * 8 人桌；附带重置投票面板与真人行动倒计时。
 */
@ccclass('OnlineGameApp')
export class OnlineGameApp extends Component {
  private readonly net = new NetClient()
  private readonly sfx = new SoundFx()
  private readonly seats: SeatView[] = []
  private community!: CommunityView
  private actionBar!: ActionBar
  private messages!: MessageBar
  private chatLog!: ChatLog
  private winFx!: WinFx
  private dealerMark!: Node
  private tableView!: TableView
  /** 主动亮牌按钮（发给服务器校验广播，一手一次） */
  private showBtn!: SimpleButton
  /** 上一份快照（diff 动画依据） */
  private prev: Snapshot | null = null
  /** 服务器座位数（8 人桌），L() 旋转取模用 */
  private seatCount = 8
  /** 每座位（视角位）最近一轮下注，收池动画起飞依据 */
  private lastBets: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  /** AI 台词暂存：动作快照到达时合并进气泡 */
  private readonly pendingSay = new Map<number, string>()
  /** 已播过气泡的动作序号 */
  private lastActSeq = 0
  /** 操作条当前对应的行动权标识（防同一次行动权重复滑入） */
  private barKey = ''
  /** 已翻开的座位（视角位） */
  private readonly revealed = new Set<number>()
  /** 本手是否已把自己的真实底牌铺上（开局快照先到、底牌快照后到） */
  private heroDealt = false
  /** 真人行动倒计时（秒，快照校准 + 本地递减） */
  private turnLeft = 0
  private timerView = -1
  private timerPill!: Node
  private timerLabel!: Label
  /** 重置投票：面板 + 发起按钮 */
  private votePanel!: Node
  private voteOpacity!: UIOpacity
  private voteText!: Label
  private voteAgreeBtn!: SimpleButton
  private voteRefuseBtn!: SimpleButton
  private resetBtn!: SimpleButton
  /** 对局记录悬浮框（打开时创建，关闭即销毁） */
  private historyPanel: HistoryPanel | null = null
  private voteLeft = 0
  private voteLabelBase = ''
  /** 待发送的首条认证消息（连接建立即发；认证失败可更新后重发） */
  private pendingAuth: { t: 'join'; name: string } | { t: 'register'; name: string; pass: string } | { t: 'login'; name?: string; pass?: string; token?: string } = {
    t: 'join',
    name: '玩家',
  }
  /** 打开中的账号弹窗（auth-ok 后关闭） */
  private accountDialog: AccountDialog | null = null

  onLoad(): void {
    setupBootDom()
    // 关键顺序：UI 素材异步加载，必须等帧缓存就绪后再构建界面，
    // 否则 uiFrame() 全部取不到、界面整体回退成代码绘制的兜底样式
    this.tableView = new TableView(this.node)
    settle([loadCardFaces(), loadIconFont(), loadUiRes(), this.tableView.ready]).then(() => {
      this.buildUi()
      hideBootSplash()
      this.askAccount()
    })
  }

  onDestroy(): void {
    this.net.close()
  }

  /** 快照之间服务器时间不会推送，倒计时在本地平滑递减 */
  update(dt: number): void {
    if (this.turnLeft > 0 && this.timerView >= 0) {
      this.turnLeft = Math.max(0, this.turnLeft - dt)
      this.renderTimer()
    }
    if (this.votePanel?.active && this.voteLeft > 0) {
      this.voteLeft = Math.max(0, this.voteLeft - dt)
      this.renderVoteText()
    }
  }

  private buildUi(): void {
    SEAT_LAYOUT_8.forEach((s, i) => {
      this.seats.push(
        new SeatView(this.node, '', {
          pos: s.pos,
          betOffset: s.bet,
          colorIndex: i,
          faceUp: s.faceUp,
        }),
      )
    })
    this.community = new CommunityView(this.node, new Vec3(TABLE_CENTER.x, TABLE_CENTER.y, 0))
    // 庄家钮：素材徽章图；缺图回退白圆 + D
    this.dealerMark = attachImage(this.node, 'dealer-badge', 40, 40)
    if (!uiFrame('dealer-badge')) {
      const dg = this.dealerMark.addComponent(Graphics)
      dg.fillColor = THEME.textBright
      dg.circle(0, 0, 16)
      dg.fill()
      createLabel(this.dealerMark, 'D', 20, THEME.inkBlack, true)
    }
    this.actionBar = new ActionBar(this.node)
    this.messages = new MessageBar(this.node)
    createSoundToggle(this.node, this.sfx)
    createFullscreenToggle(this.node)
    this.chatLog = new ChatLog(this.node, new Vec3(-478, -232, 0), (text) =>
      this.net.send({ t: 'chat', text }),
    )
    // 主动亮牌：手牌左侧，服务器校验并广播给局内玩家（一手一次）
    this.showBtn = createGlassButton(this.node, '亮牌', 76, 32, 14, shade(THEME.call, 1.55))
    this.showBtn.node.setPosition(-223, -246, 0)
    this.showBtn.node.on(Node.EventType.TOUCH_END, () => {
      this.showBtn.node.active = false
      this.net.send({ t: 'showCards' })
    })
    this.showBtn.node.active = false
    this.winFx = new WinFx(this.node)
    this.buildTimerPill()
    this.buildVoteUi()
    // 对局记录：左上角入口（8 人桌左上区域空旷，不与座位 5 横幅 / 计时胶囊相撞）
    const histBtn = createGlassButton(this.node, '对局记录', 104, 34, 15, THEME.goldBright)
    histBtn.node.setPosition(-540, 280)
    histBtn.node.on(Node.EventType.TOUCH_END, () => this.openHistory())
  }

  /** 打开对局记录悬浮框并向服务器拉取最新归档 */
  private openHistory(): void {
    this.historyPanel?.hide()
    this.historyPanel = new HistoryPanel(this.node, () => {
      this.historyPanel = null
    })
    this.net.send({ t: 'getHistory' })
  }

  /** 行动倒计时胶囊：贴在当前行动真人座位卡片上方 */
  private buildTimerPill(): void {
    this.timerPill = createNode('turnTimer', this.node, 94, 30)
    drawGlassPanel(this.timerPill.addComponent(Graphics), 94, 30, 15)
    this.timerLabel = createLabel(this.timerPill, '', 14, THEME.goldBright, true)
    this.timerPill.active = false
  }

  /** 重置投票面板（顶部长条）+ 右下角发起按钮 */
  private buildVoteUi(): void {
    this.votePanel = createNode('votePanel', this.node, 460, 56)
    this.votePanel.setPosition(0, 300)
    drawGlassPanel(this.votePanel.addComponent(Graphics), 460, 56, 14)
    this.voteOpacity = this.votePanel.addComponent(UIOpacity)
    this.voteOpacity.opacity = 0
    this.votePanel.active = false
    this.voteText = createLabel(this.votePanel, '', 13, THEME.textBright)
    this.voteText.node.setPosition(-60, 0)
    this.voteText.maxLineWidth = 280
    this.voteRefuseBtn = createGlassButton(this.votePanel, '反对', 76, 34, 15, shade(THEME.fold, 1.35))
    this.voteRefuseBtn.node.setPosition(128, 0)
    this.voteRefuseBtn.node.on(Node.EventType.TOUCH_END, () => this.net.send({ t: 'voteReset', agree: false }))
    this.voteAgreeBtn = createGlassButton(this.votePanel, '同意', 76, 34, 15, shade(THEME.call, 1.55))
    this.voteAgreeBtn.node.setPosition(196, 0)
    this.voteAgreeBtn.node.on(Node.EventType.TOUCH_END, () => this.net.send({ t: 'voteReset', agree: true }))

    this.resetBtn = createGlassButton(this.node, '重置对局', 96, 32, 14, THEME.goldBright)
    this.resetBtn.node.setPosition(486, 246)
    this.resetBtn.node.on(Node.EventType.TOUCH_END, () => this.net.send({ t: 'voteReset' }))
    this.resetBtn.node.active = false
  }

  /** 入口：本地有 token 先静默续登（自动找回座位），失败或无 token 再弹账号弹窗 */
  private askAccount(): void {
    this.net.onMessage = (msg) => this.onNet(msg)
    this.net.onClose = () => this.messages.showPhase('与服务器断开连接，请刷新页面重试')
    this.net.onOpen = () => this.net.auth(this.pendingAuth)
    const token = loadToken()
    if (token) {
      this.pendingAuth = { t: 'login', token }
      this.messages.showPhase('正在登录…')
      this.net.connect()
      return
    }
    this.openAccountDialog()
  }

  /** 注册 / 登录 / 游客弹窗（认证失败带错误信息重开） */
  private openAccountDialog(errMsg?: string): void {
    const dialog = new AccountDialog(this.node, (kind: AuthKind, name: string, pass: string) => {
      if (kind === 'guest') {
        dialog.hide()
        this.accountDialog = null
      } else {
        dialog.setBusy(true)
        this.accountDialog = dialog
      }
      this.pendingAuth =
        kind === 'guest'
          ? { t: 'join', name: name || `玩家${Math.floor(1000 + Math.random() * 9000)}` }
          : kind === 'register'
            ? { t: 'register', name, pass }
            : { t: 'login', name, pass }
      if (this.net.connected) {
        // 认证失败后的重试：同一条连接直接换凭据再发
        this.net.auth(this.pendingAuth)
      } else {
        this.net.connect()
      }
    })
    dialog.prefill(loadSavedName())
    if (errMsg) {
      dialog.showError(errMsg)
    }
  }

  // ---------- 网络消息 ----------

  private onNet(msg: ServerMsg): void {
    if (msg.t === 'auth-ok') {
      saveToken(msg.token)
      saveName(msg.name)
      const lost = Math.max(0, msg.played - msg.won)
      this.messages.showPhase(`${msg.name}，生涯 胜 ${msg.won} · 负 ${lost}`)
      this.accountDialog?.hide()
      this.accountDialog = null
      return
    }
    if (msg.t === 'auth-err') {
      // token 过期 / 账密错误：清掉本地 token；弹窗在则提示重试，不在则弹出来
      try {
        localStorage.removeItem(TOKEN_KEY)
      } catch {
        // 静默
      }
      if (this.accountDialog) {
        this.accountDialog.showError(msg.msg)
      } else {
        this.openAccountDialog(msg.msg)
      }
      return
    }
    if (msg.t === 'welcome') {
      this.messages.showPhase(msg.waiting ? '已排队，下一手入座' : msg.seat < 0 ? '观战中' : '正在入座')
      return
    }
    if (msg.t === 'state') {
      this.applySnapshot(msg.snap)
      return
    }
    if (msg.t === 'say') {
      this.chatLog.push(msg.name, msg.text)
      if (msg.tag === 'chat' && msg.seat !== undefined && msg.seat >= 0) {
        // 真人聊天：说话者座位冒文字气泡
        this.seats[this.L(msg.seat)].showAction(msg.text)
      } else if (msg.tag === 'ai' && msg.seat !== undefined && msg.seat >= 0) {
        this.pendingSay.set(msg.seat, msg.text)
      }
      return
    }
    if (msg.t === 'history') {
      this.historyPanel?.show(msg.hands)
      return
    }
    if (msg.t === 'err') {
      console.log('[net] 动作被拒绝:', msg.msg)
    }
  }

  /** 座位号 → 视角布局位：永远把自己转到下方 0 号位 */
  private L(seat: number, rot = this.prev?.you.seat ?? 0): number {
    return (seat - (rot < 0 ? 0 : rot) + this.seatCount) % this.seatCount
  }

  // ---------- 快照渲染 ----------

  private applySnapshot(snap: Snapshot): void {
    this.seatCount = Math.max(2, snap.players.length)
    const prev = this.prev
    if (!prev || snap.handNo !== prev.handNo) {
      this.startHandView(snap)
    } else if (snap.community.length > prev.community.length) {
      this.sweepBets(snap)
      this.sfx.flip()
      const start = prev.community.length
      snap.community.slice(start).forEach((cj, k) => {
        this.community.dealCard(fromCardJ(cj), start + k, DECK_POS, 0.15 + k * 0.2)
      })
    }
    // 自己的底牌可能晚于开局快照到达（deal-hole 事件在其后）：到货即替换占位牌
    const myHole = snap.you.seat >= 0 ? snap.players[snap.you.seat].hole : undefined
    if (myHole && !this.heroDealt) {
      this.heroDealt = true
      this.seats[0].setHoleCards(myHole.map(fromCardJ))
    }
    // 局末摊牌亮牌
    snap.players.forEach((p, seat) => {
      const view = this.L(seat, snap.you.seat)
      if (p.revealed && !this.revealed.has(view)) {
        this.revealed.add(view)
        this.seats[view].setHoleCards(p.revealed.map(fromCardJ))
        this.seats[view].revealCards()
      }
    })
    // 新动作 → 气泡 + 音效（seq 防重播）
    const la = snap.lastAct
    if (la && la.seq > this.lastActSeq) {
      this.lastActSeq = la.seq
      const ps = snap.players[la.seat]
      const say = this.pendingSay.get(la.seat) ?? ''
      this.pendingSay.delete(la.seat)
      const text = `${describeAct(la.kind, la.raiseTo, ps.betRound, ps.chips)}${say ? `「${say}」` : ''}`
      this.seats[this.L(la.seat, snap.you.seat)].showAction(text)
      if (la.kind === 'call' || la.kind === 'raise') {
        this.sfx.chip()
      }
    }
    this.refreshAll(snap)
    this.updateVote(snap)
    if (snap.awards && !prev?.awards) {
      this.showAwards(snap)
    }
    this.prev = snap
  }

  private startHandView(snap: Snapshot): void {
    this.winFx.clear()
    this.pendingSay.clear()
    this.revealed.clear()
    this.seats.forEach((s) => s.clearHand())
    this.community.reset()
    this.messages.hideBanner()
    this.placeDealerMark(snap)
    this.heroDealt = false
    snap.players.forEach((p, seat) => {
      const view = this.L(seat, snap.you.seat)
      const hole = view === 0 && p.hole ? p.hole.map(fromCardJ) : null
      if (hole) {
        this.heroDealt = true
      }
      this.seats[view].dealCards(hole ?? [DUMMY, DUMMY], DECK_POS, 0.1 + view * 0.12)
    })
    this.sfx.deal()
    this.lastBets = snap.players.map((p) => p.betRound)
  }

  private refreshAll(snap: Snapshot): void {
    const rot = snap.you.seat
    snap.players.forEach((p, seat) => {
      this.seats[this.L(seat, rot)].refresh(toSeatPlayer(seat, p))
    })
    this.community.setPot(snap.pot)
    this.seats.forEach((s, i) => s.setActing(snap.actingIndex >= 0 && this.L(snap.actingIndex, rot) === i))
    // 翻牌前在头像旁标出小盲 / 大盲座位（换算到视角位）
    const n = snap.players.length
    const preflop = snap.phase === 'preflop'
    if (preflop) {
      const sbView = this.L((snap.dealerIndex + 1) % n, rot)
      const bbView = this.L((snap.dealerIndex + 2) % n, rot)
      this.seats.forEach((s, i) => s.setBlindTag(i === sbView ? 'sb' : i === bbView ? 'bb' : null))
    } else {
      this.seats.forEach((s) => s.setBlindTag(null))
    }
    this.updatePhaseLabel(snap)
    this.updateHeroHint(snap)
    // 行动倒计时：服务器校准剩余秒数，渲染贴在行动座位上方
    if (snap.turnLeft !== undefined && snap.actingIndex >= 0) {
      this.turnLeft = snap.turnLeft
      this.timerView = this.L(snap.actingIndex, rot)
      this.renderTimer()
    } else {
      this.turnLeft = 0
      this.timerView = -1
      this.timerPill.active = false
    }
    // 轮到自己：滑出操作条；发完动作立即收起防连点
    if (snap.you.legal && snap.actingIndex === snap.you.seat) {
      const key = `${snap.handNo}:${snap.actingIndex}:${snap.phase}`
      if (key !== this.barKey) {
        this.barKey = key
        const currentBet = Math.max(0, ...snap.players.map((p) => p.betRound))
        this.actionBar.show(snap.you.legal, { currentBet, pot: snap.pot }, (a: Act) => {
          this.actionBar.hide()
          this.net.send({
            t: 'act',
            kind: String(a.kind) as 'fold' | 'check' | 'call' | 'raise',
            raiseTo: a.raiseTo,
          })
        })
      }
    } else {
      this.barKey = ''
      this.actionBar.hide()
    }
    this.lastBets = snap.players.map((p) => p.betRound)
    // 亮牌按钮：自己入座、局内、未亮过才显示
    const me = snap.you.seat >= 0 ? snap.players[snap.you.seat] : null
    this.showBtn.node.active = !!me && !me.folded && !me.showed && snap.phase !== 'over'
  }

  private renderTimer(): void {
    if (this.timerView < 0 || this.turnLeft <= 0) {
      this.timerPill.active = false
      return
    }
    this.timerPill.active = true
    // 计时胶囊挂在行动座位横幅上缘中点（横幅几何由 SeatPlate 素材实测得出）
    const lay = SEAT_LAYOUT_8[this.timerView]
    const top = this.seats[this.timerView].plateTopCenter()
    this.timerPill.setPosition(lay.pos.x + top.x, lay.pos.y + top.y + 16, 0)
    this.timerLabel.string = `剩 ${Math.ceil(this.turnLeft)} 秒`
    this.timerLabel.color = this.turnLeft <= 10 ? shade(THEME.fold, 1.5) : THEME.goldBright
  }

  /** 投票面板：发起者与已投票者按钮收起，倒计时本地递减 */
  private updateVote(snap: Snapshot): void {
    const v = snap.vote
    this.resetBtn.node.active = snap.you.seat >= 0 && !v
    if (!v) {
      if (this.votePanel.active) {
        this.fadeVote(false)
      }
      return
    }
    this.voteLeft = v.leftSec
    const byName = snap.players[v.by]?.name ?? '?'
    this.voteLabelBase = `${byName} 发起重置对局`
    const mine = v.votes.find((x) => x.seat === snap.you.seat)
    const voted = !!mine || snap.you.seat === v.by
    const refused = mine?.agree === false
    this.voteAgreeBtn.node.active = !voted
    this.voteRefuseBtn.node.active = !voted
    this.voteText.color = refused ? shade(THEME.fold, 1.4) : THEME.textBright
    if (!this.votePanel.active) {
      this.votePanel.active = true
      this.votePanel.setScale(0.9, 0.9, 1)
      Tween.stopAllByTarget(this.voteOpacity)
      Tween.stopAllByTarget(this.votePanel)
      tween(this.voteOpacity).to(0.22, { opacity: 255 }).start()
      tween(this.votePanel).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start()
    }
    if (voted) {
      this.voteLabelBase += refused ? '（你已反对，等待其他人）' : '（你已同意，等待其他人）'
    }
    this.renderVoteText()
  }

  private renderVoteText(): void {
    this.voteText.string = `${this.voteLabelBase} · ${Math.ceil(this.voteLeft)} 秒后未反对即通过`
  }

  private fadeVote(show: boolean): void {
    Tween.stopAllByTarget(this.voteOpacity)
    if (show) {
      this.votePanel.active = true
      tween(this.voteOpacity).to(0.22, { opacity: 255 }).start()
      return
    }
    tween(this.voteOpacity)
      .to(0.2, { opacity: 0 })
      .call(() => {
        if (this.voteOpacity.opacity === 0) {
          this.votePanel.active = false
        }
      })
      .start()
  }

  private showAwards(snap: Snapshot): void {
    this.sweepBets(snap)
    const aw = snap.awards
    if (!aw) {
      return
    }
    aw.winners.forEach((seat) => this.seats[this.L(seat, snap.you.seat)].showWin())
    this.sfx.win()
    this.messages.showBanner(aw.title, aw.lines)
    aw.winners.forEach((seat) => {
      const view = this.L(seat, snap.you.seat)
      this.winFx.fly(
        new Vec3(TABLE_CENTER.x, TABLE_CENTER.y, 0),
        this.seats[view].node.position.clone(),
        6,
      )
    })
    this.seats[0].setHint('')
  }

  private sweepBets(snap: Snapshot): void {
    snap.players.forEach((p, seat) => {
      if (this.lastBets[seat] > 0 && p.betRound === 0) {
        const view = this.L(seat, snap.you.seat)
        const lay = SEAT_LAYOUT_8[view]
        this.winFx.flyChips(
          new Vec3(lay.pos.x + lay.bet.x, lay.pos.y + lay.bet.y, 0),
          new Vec3(TABLE_CENTER.x, TABLE_CENTER.y + 40, 0),
          Math.min(5, Math.max(2, Math.round(this.lastBets[seat] / 40))),
        )
      }
    })
  }

  private placeDealerMark(snap: Snapshot): void {
    const lay = SEAT_LAYOUT_8[this.L(snap.dealerIndex, snap.you.seat)]
    const off = lay.dealer ?? new Vec3(-70, 0, 0)
    this.dealerMark.setPosition(lay.pos.x + lay.bet.x + off.x, lay.pos.y + lay.bet.y + off.y, 0)
  }

  private updatePhaseLabel(snap: Snapshot): void {
    let text = `第 ${snap.handNo} 手 · ${PHASE_LABEL[snap.phase] || '进行中'}`
    if (snap.you.seat < 0) {
      text = snap.you.waiting ? '已排队，等待下一手入座' : `观战 · ${text}`
    }
    this.messages.showPhase(text)
  }

  private updateHeroHint(snap: Snapshot): void {
    const me = snap.you.seat >= 0 ? snap.players[snap.you.seat] : null
    if (me && !me.folded && me.hole && snap.phase !== 'over') {
      const opponents = Math.max(1, snap.players.filter((p) => !p.folded).length - 1)
      this.seats[0].setHint(
        buildHeroHint(me.hole.map(fromCardJ), snap.community.map(fromCardJ), opponents),
      )
    } else {
      this.seats[0].setHint('')
    }
  }
}

/** 快照玩家 → SeatView.refresh 需要的 Player 形状 */
function toSeatPlayer(seat: number, p: PlayerSnap): Player {
  const pl = new Player(seat, p.name, p.bot, p.chips)
  pl.betRound = p.betRound
  pl.folded = p.folded
  pl.allIn = p.allIn
  pl.won = p.won
  pl.played = p.played
  return pl
}
