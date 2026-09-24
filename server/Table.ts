import { WebSocket } from 'ws'
import { AiAdvisor } from '../assets/scripts/ai/AiAdvisor'
import { personaByName } from '../assets/scripts/ai/Personas'
import { Card } from '../assets/scripts/core/Card'
import { GameEngine } from '../assets/scripts/core/GameEngine'
import { Player } from '../assets/scripts/core/Player'
import { Act, ActKind, GameEvent, LegalActs, Phase } from '../assets/scripts/core/Types'
import { CardJ, ClientMsg, HandRecordJ, PlayerSnap, ServerMsg, Snapshot, VoteSnap } from '../assets/scripts/net/Protocol'
import { AccountStore } from './AccountStore'

/** 每个座位默认的 AI 名字（座位 0~7） */
export const BOT_NAMES = ['小美', '阿宝', '老K', '胖虎', '大乔', '石头', '莉莉', '教授']
const SEAT_COUNT = 8
/** 历史记录归档上限（够整晚复盘，防止长局内存无限增长） */
const HISTORY_MAX = 50
/** 局末到下一手的间隔（毫秒）；自检用环境变量调快节奏 */
const NEXT_HAND_DELAY = Number(process.env.TEXAS_NEXT_HAND_MS ?? 6000)
/** AI 行动前的思考停顿区间（毫秒），同样可被自检覆盖 */
const BOT_THINK = [
  Number(process.env.TEXAS_BOT_THINK_MIN ?? 1200),
  Number(process.env.TEXAS_BOT_THINK_MAX ?? 2800),
]
/** 真人行动超时：超时自动过牌/跟注 */
const TURN_TIMEOUT = 60000
/** 重置投票窗口：到时未反对即通过 */
const VOTE_TIMEOUT = 30000
/** 投票失败后的冷却，防连续发起刷屏 */
const VOTE_COOLDOWN = 8000
/** 掉线座位的账号保留时长：期间重登找回原座位与筹码，过期释放给新玩家 */
const SEAT_RESERVE_MS = 10 * 60 * 1000

interface Client {
  ws: WebSocket
  name: string
  /** 座位号，-1 = 观战或等待入座 */
  seat: number
  /** 绑定的账号名（游客为 null）：胜负数累计进数据库 */
  account: string | null
}

/** 进行中的重置投票 */
interface VoteState {
  by: number
  deadline: number
  /** 已显式表态的真人座位（未表态 = 到时视为同意） */
  votes: Map<number, boolean>
}

const PHASE_KEY: Record<Phase, Snapshot['phase']> = {
  [Phase.Idle]: 'idle',
  [Phase.Preflop]: 'preflop',
  [Phase.Flop]: 'flop',
  [Phase.Turn]: 'turn',
  [Phase.River]: 'river',
  [Phase.Showdown]: 'showdown',
  [Phase.HandOver]: 'over',
}

/**
 * 权威牌桌：一台服务器一张桌。
 * 真人按加入顺序占 8 个座位，空位与掉线座位由 AI 代打；
 * 满员后新连接进观战；等待中的真人在下一手开始时入座。
 * 服务端 AI 走 DeepSeek（DEEPSEEK_API_KEY 环境变量注入），失败自动降级本地决策。
 */
export class Table {
  private engine = new GameEngine()
  private readonly advisor = new AiAdvisor({ timeoutMs: 7000, retries: 0 })
  private readonly clients: Client[] = []
  private readonly seatClient: Array<Client | null> = new Array(SEAT_COUNT).fill(null)
  /** 账号绑定的座位（掉线后保留供重登找回）：座位 → 用户名 */
  private readonly seatAccount: Array<string | null> = new Array(SEAT_COUNT).fill(null)
  /** 账号座位保留截止时间（毫秒时间戳，0 = 无保留） */
  private readonly reserveUntil = new Array<number>(SEAT_COUNT).fill(0)
  /** 账号座位的生涯胜负（快照下发口径；游客 / 机器人用引擎当次统计） */
  private readonly accWon = new Array<number | null>(SEAT_COUNT).fill(null)
  private readonly accPlayed = new Array<number | null>(SEAT_COUNT).fill(null)
  private readonly waiting: Client[] = []
  /** 局末摊牌 / 中途弃牌亮出的底牌（座位 → 牌） */
  private readonly reveal = new Map<number, Card[]>()
  /** 当前对局的历史手牌归档（局末写入，重置对局清空，getHistory 按需下发） */
  private readonly handLog: HandRecordJ[] = []
  /** 摊牌后全员可见（弃牌亮牌只给仍在局内的玩家） */
  private revealAll = false
  private botTimer: ReturnType<typeof setTimeout> | null = null
  private nextTimer: ReturnType<typeof setTimeout> | null = null
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private turnDeadline = 0
  private vote: VoteState | null = null
  private voteTimer: ReturnType<typeof setTimeout> | null = null
  private voteCooldownUntil = 0
  /** 是否已开局（无任何连接时挂起，等人来再开） */
  private started = false
  /** 处于两手之间的间隙（此时加入可直接入座） */
  private handOver = true
  /** 动作流水号：客户端据此识别「新动作」避免重复播气泡 */
  private actSeq = 0

  constructor(private readonly store: AccountStore) {
    BOT_NAMES.forEach((name) => this.engine.addPlayer(name, true))
    this.engine.on((ev) => this.onEngineEvent(ev))
  }

  /** 新连接：注册 / 登录 / 游客取名后进桌；账号玩家先尝试找回座位 */
  join(ws: WebSocket, rawName: string, account: string | null): void {
    const name = account ?? sanitizeName(rawName)
    const client: Client = { ws, name, seat: -1, account }
    this.clients.push(client)
    if (!this.resumeSeat(client)) {
      const free = this.firstFreeSeat()
      if (free >= 0 && this.handOver) {
        this.sitAt(client, free)
      } else if (free >= 0) {
        this.waiting.push(client)
        this.say('系统', `${name} 已加入，下一手入座`)
      } else {
        this.say('系统', `${name} 进入观战`)
      }
    }
    this.send(client, { t: 'welcome', seat: client.seat, waiting: this.waiting.includes(client) })
    if (!this.started && this.clients.length > 0) {
      this.beginHand()
    } else {
      this.broadcastState()
    }
  }

  /** 客户端消息（join 之外的都走这里） */
  onMessage(ws: WebSocket, msg: ClientMsg): void {
    const client = this.clients.find((c) => c.ws === ws)
    if (
      !client ||
      (msg.t !== 'act' && msg.t !== 'chat' && msg.t !== 'voteReset' && msg.t !== 'showCards' && msg.t !== 'getHistory')
    ) {
      return
    }
    if (msg.t === 'getHistory') {
      // 最新在前：面板直接从上往下翻最近的手牌
      this.send(client, { t: 'history', hands: [...this.handLog].reverse() })
      return
    }
    if (msg.t === 'chat') {
      const text = String(msg.text ?? '').trim().slice(0, 60)
      if (text) {
        this.say(client.name, text, client.seat, 'chat')
      }
      return
    }
    if (msg.t === 'voteReset') {
      this.handleVoteReset(client, msg.agree !== false)
      return
    }
    if (msg.t === 'showCards') {
      this.handleShowCards(client)
      return
    }
    this.handleAct(client, msg)
  }

  /**
   * 账号玩家找回座位：离线保留期内回收原座（继承筹码与座次）；
   * 同账号在别处登录则顶掉旧连接接管座位（单点登录）。
   */
  private resumeSeat(client: Client): boolean {
    if (!client.account) {
      return false
    }
    const seat = this.seatAccount.findIndex((a) => a === client.account)
    if (seat < 0) {
      return false
    }
    const cur = this.seatClient[seat]
    if (cur && cur !== client) {
      this.clients.splice(this.clients.indexOf(cur), 1)
      if (cur.ws.readyState === WebSocket.OPEN) {
        cur.ws.close(4000, 'account-replaced')
      }
      this.say('系统', `${client.name} 在别处登录，接管了座位`)
    } else if (!cur) {
      if (Date.now() >= this.reserveUntil[seat]) {
        return false // 保留期已过，走正常入座
      }
      this.say('系统', `${client.name} 找回了原来的座位`)
    }
    this.sitAt(client, seat)
    const acting = this.engine.actingPlayer
    if (acting && acting.id === seat) {
      // 行动权正落在该座位：撤掉 AI 代打，恢复真人计时
      this.clearBotTimer()
      this.armTurnTimer(seat)
    }
    return true
  }

  /** 连接断开：座位转 AI 托管（正轮到时立即代打，防卡局） */
  leave(ws: WebSocket): void {
    const idx = this.clients.findIndex((c) => c.ws === ws)
    if (idx < 0) {
      return
    }
    const client = this.clients[idx]
    this.clients.splice(idx, 1)
    if (client.seat >= 0) {
      this.seatClient[client.seat] = null
      if (client.account) {
        // 账号座位保留一段时间：重登可带着原筹码找回
        this.seatAccount[client.seat] = client.account
        this.reserveUntil[client.seat] = Date.now() + SEAT_RESERVE_MS
        this.say('系统', `${client.name} 离开，座位保留 ${SEAT_RESERVE_MS / 60000} 分钟，AI 暂时托管`)
      } else {
        this.seatAccount[client.seat] = null
        this.say('系统', `${client.name} 离开，座位由 AI 托管`)
      }
      const acting = this.engine.actingPlayer
      if (acting && acting.id === client.seat) {
        // 行动权留给 AI：先撤掉真人超时计时，避免超时自动动作与 AI 决策撞车
        this.clearTurnTimer()
        this.scheduleBot()
      }
      // 投票人离场：剩余已表态者若全部同意则直接通过
      if (this.vote) {
        this.vote.votes.delete(client.seat)
        this.checkVotePass()
      }
    } else {
      const w = this.waiting.indexOf(client)
      if (w >= 0) {
        this.waiting.splice(w, 1)
      }
    }
    this.broadcastState()
  }

  /** 空闲时收尾（测试用） */
  dispose(): void {
    this.clearBotTimer()
    this.clearTurnTimer()
    if (this.nextTimer) {
      clearTimeout(this.nextTimer)
    }
    if (this.voteTimer) {
      clearTimeout(this.voteTimer)
    }
  }

  // ---------- 重置对局投票 ----------

  private handleVoteReset(client: Client, agree: boolean): void {
    if (client.seat < 0) {
      this.send(client, { t: 'err', msg: '入座后才能发起或参与投票' })
      return
    }
    if (this.vote) {
      if (!agree) {
        this.endVote(false, `${client.name} 反对，重置投票未通过`)
        return
      }
      this.vote.votes.set(client.seat, true)
      this.say('系统', `${client.name} 同意重置对局`)
      this.checkVotePass()
      return
    }
    if (Date.now() < this.voteCooldownUntil) {
      this.send(client, { t: 'err', msg: '投票刚结束，稍后再试' })
      return
    }
    this.vote = { by: client.seat, deadline: Date.now() + VOTE_TIMEOUT, votes: new Map([[client.seat, true]]) }
    this.voteTimer = setTimeout(() => {
      this.voteTimer = null
      if (this.vote) {
        this.endVote(true, '投票截止，无人反对')
      }
    }, VOTE_TIMEOUT)
    this.say('系统', `${client.name} 发起重置对局投票，${VOTE_TIMEOUT / 1000} 秒内不操作视为同意`)
    this.checkVotePass()
    this.broadcastState()
  }

  /** 所有在座真人都已同意（AI 默认同意）则立即通过 */
  private checkVotePass(): void {
    if (!this.vote) {
      return
    }
    const humans = this.seatClient
      .map((c, seat) => (c ? seat : -1))
      .filter((seat) => seat >= 0)
    if (humans.length > 0 && humans.every((seat) => this.vote!.votes.get(seat) === true)) {
      this.endVote(true, '所有玩家已同意')
    }
  }

  private endVote(pass: boolean, reason: string): void {
    if (this.voteTimer) {
      clearTimeout(this.voteTimer)
      this.voteTimer = null
    }
    this.vote = null
    this.voteCooldownUntil = Date.now() + VOTE_COOLDOWN
    if (pass) {
      this.say('系统', `${reason}，正在重置对局`)
      this.resetMatch()
    } else {
      this.say('系统', `${reason}，对局继续`)
      this.broadcastState()
    }
  }

  /** 投票通过：重建引擎（全员 1000 筹码、胜负统计清零），直接开新一手 */
  private resetMatch(): void {
    this.clearBotTimer()
    this.clearTurnTimer()
    if (this.nextTimer) {
      clearTimeout(this.nextTimer)
      this.nextTimer = null
    }
    this.reveal.clear()
    this.revealAll = false
    this.handLog.length = 0
    this.handOver = true
    this.engine = new GameEngine()
    BOT_NAMES.forEach((name) => this.engine.addPlayer(name, true))
    this.engine.on((ev) => this.onEngineEvent(ev))
    this.say('系统', '对局已重置：全员回到 1000 筹码（账号玩家仍累计生涯胜负）')
    while (this.waiting.length > 0) {
      const free = this.firstFreeSeat()
      if (free < 0) {
        break
      }
      this.sitAt(this.waiting.shift()!, free)
    }
    this.started = this.clients.length > 0
    if (this.started) {
      this.beginHand()
    } else {
      this.broadcastState()
    }
  }

  // ---------- 内部：座位与手牌流转 ----------

  private firstFreeSeat(): number {
    return this.seatClient.findIndex((c, i) => c === null && !this.seatReserved(i))
  }

  /** 账号掉线座位在保留期内不分配给他人 */
  private seatReserved(seat: number): boolean {
    return !!this.seatAccount[seat] && Date.now() < this.reserveUntil[seat]
  }

  private sitAt(client: Client, seat: number): void {
    client.seat = seat
    this.seatClient[seat] = client
    this.seatAccount[seat] = client.account
    this.reserveUntil[seat] = 0
    if (client.account) {
      const acct = this.store.getAccount(client.account)
      this.accWon[seat] = acct ? acct.won : 0
      this.accPlayed[seat] = acct ? acct.played : 0
    } else {
      this.accWon[seat] = null
      this.accPlayed[seat] = null
    }
    this.say('系统', `${client.name} 坐上 ${seat + 1} 号位`)
  }

  private beginHand(): void {
    this.clearBotTimer()
    this.clearTurnTimer()
    this.reveal.clear()
    this.revealAll = false
    while (this.waiting.length > 0) {
      const free = this.firstFreeSeat()
      if (free < 0) {
        break
      }
      this.sitAt(this.waiting.shift()!, free)
    }
    // 破产自动重买：联机不打断牌局
    this.engine.players.forEach((p, i) => {
      if (p.chips < this.engine.cfg.bigBlind) {
        p.chips = this.engine.cfg.startChips
        this.say('系统', `${this.seatName(i)} 重新买入 ${this.engine.cfg.startChips} 筹码`)
      }
    })
    this.started = true
    this.handOver = false
    this.engine.startHand()
    this.broadcastState()
  }

  private onEngineEvent(ev: GameEvent): void {
    if (ev === 'hand-end') {
      this.handOver = true
      this.clearTurnTimer()
      this.settleAccountStats()
      const showdown = this.engine.lastAwards.some((a) => a.reason === 'showdown')
      if (showdown) {
        this.revealAll = true
        this.engine.players.forEach((p, i) => {
          if (p.inHand && p.hole.length > 0) {
            this.reveal.set(i, [...p.hole])
          }
        })
      }
      this.logHand()
      if (this.clients.length > 0) {
        this.nextTimer = setTimeout(() => {
          this.nextTimer = null
          this.beginHand()
        }, NEXT_HAND_DELAY)
      } else {
        this.started = false
      }
    }
    if (ev === 'act') {
      // 弃牌者底牌翻给仍在局内的玩家看（降低读牌难度）；摊牌可见性由 revealAll 控制
      const la = this.engine.lastAction
      if (la && la.act.kind === ActKind.Fold) {
        const p = this.engine.players[la.playerId]
        if (p.hole.length > 0) {
          this.reveal.set(la.playerId, [...p.hole])
        }
      }
    }
    if (ev === 'turn') {
      const acting = this.engine.actingPlayer
      if (!acting) {
        return
      }
      if (this.seatClient[acting.id]) {
        this.armTurnTimer(acting.id)
      } else {
        this.scheduleBot()
      }
    }
    this.broadcastState()
  }

  /** 局末：账号座位的生涯胜负入库（离线托管期间照常累计，重登可见） */
  private settleAccountStats(): void {
    const winners = new Set<number>()
    this.engine.lastAwards.forEach((a) => a.winners.forEach((w) => winners.add(w.id)))
    this.seatAccount.forEach((acct, seat) => {
      // 保留期已过且无人回归的幽灵座位不再累计
      if (!acct || (!this.seatClient[seat] && !this.seatReserved(seat))) {
        return
      }
      const wonInc = winners.has(seat) ? 1 : 0
      this.accWon[seat] = (this.accWon[seat] ?? 0) + wonInc
      this.accPlayed[seat] = (this.accPlayed[seat] ?? 0) + 1
      this.store.addStats(acct, wonInc, 1)
    })
  }

  /** 真人行动计时：60 秒不操作自动过牌/跟注 */
  private armTurnTimer(seat: number): void {
    this.clearTurnTimer()
    const handNo = this.engine.handNo
    this.turnDeadline = Date.now() + TURN_TIMEOUT
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null
      const cur = this.engine.actingPlayer
      if (!cur || cur.id !== seat || this.engine.handNo !== handNo) {
        return
      }
      const legal = this.engine.getLegalActs(seat)
      const act: Act = legal.canCheck ? { kind: ActKind.Check } : { kind: ActKind.Call }
      this.say('系统', `${this.seatName(seat)} 超时，自动${legal.canCheck ? '过牌' : '跟注'}`)
      if (this.engine.act(seat, act)) {
        this.actSeq++
      }
      this.broadcastState()
    }, TURN_TIMEOUT)
  }

  /** 轮到 AI 座位：稍作停顿后决策并附台词（DeepSeek 失败自动回落本地） */
  private scheduleBot(): void {
    this.clearBotTimer()
    const acting = this.engine.actingPlayer
    if (!acting) {
      return
    }
    const seat = acting.id
    this.botTimer = setTimeout(() => {
      this.botTimer = null
      const cur = this.engine.actingPlayer
      if (!cur || cur.id !== seat || this.seatClient[seat]) {
        return
      }
      const handNo = this.engine.handNo
      const persona = personaByName(BOT_NAMES[seat])
      this.advisor.decide(this.engine, seat, persona).then((d) => {
        // 响应回来时行动权可能已转移（真人重连接管 / 换手 / 重置），过期即丢弃
        const now = this.engine.actingPlayer
        if (!now || now.id !== seat || this.engine.handNo !== handNo || this.seatClient[seat]) {
          return
        }
        this.say(BOT_NAMES[seat], d.say, seat, 'ai')
        this.engine.act(seat, d.act)
        this.actSeq++
      })
    }, BOT_THINK[0] + Math.random() * (BOT_THINK[1] - BOT_THINK[0]))
  }

  private clearBotTimer(): void {
    if (this.botTimer) {
      clearTimeout(this.botTimer)
      this.botTimer = null
    }
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer)
      this.turnTimer = null
    }
  }

  private handleAct(client: Client, msg: Extract<ClientMsg, { t: 'act' }>): void {
    const acting = this.engine.actingPlayer
    if (!acting || acting.id !== client.seat) {
      this.send(client, { t: 'err', msg: '还没轮到你行动' })
      return
    }
    const legal = this.engine.getLegalActs(client.seat)
    const act = toAct(msg, legal)
    if (!act) {
      this.send(client, { t: 'err', msg: '动作不合法' })
      return
    }
    this.clearTurnTimer()
    this.clearBotTimer()
    if (this.engine.act(client.seat, act)) {
      this.actSeq++
    }
  }

  /** 主动亮牌：底牌翻给仍在局内的玩家看（与弃牌亮牌同一可见性口径），一手一次不可收回 */
  private handleShowCards(client: Client): void {
    const p = client.seat >= 0 ? this.engine.players[client.seat] : null
    if (!p || !p.inHand || p.hole.length === 0 || p.showed) {
      return
    }
    p.showed = true
    this.reveal.set(client.seat, [...p.hole])
    this.say('系统', `${client.name} 亮出了底牌`, client.seat, 'sys')
    this.broadcastState()
  }

  // ---------- 内部：广播与序列化 ----------

  private seatName(seat: number): string {
    return this.seatClient[seat]?.name ?? this.seatAccount[seat] ?? BOT_NAMES[seat]
  }

  /** 系统消息 seat 传 -1；tag 区分 AI 台词 / 真人聊天 / 系统提示（客户端展示方式不同） */
  private say(name: string, text: string, seat = -1, tag: 'ai' | 'chat' | 'sys' = 'sys'): void {
    this.broadcast({ t: 'say', name, text, seat, tag })
  }

  private broadcast(msg: ServerMsg): void {
    [...this.clients].forEach((c) => this.send(c, msg))
  }

  private broadcastState(): void {
    [...this.clients].forEach((c) => this.send(c, { t: 'state', snap: this.snapshotFor(c) }))
  }

  private send(client: Client, msg: ServerMsg): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg))
    }
  }

  private snapshotFor(client: Client): Snapshot {
    const e = this.engine
    const pot = e.potAmount + e.players.reduce((s, p) => s + p.betRound, 0)
    // 弃牌亮牌只发给仍在局内的在座玩家（自己的牌自己始终可见，摊牌后全员可见）
    const meInHand = client.seat >= 0 && e.players[client.seat].inHand
    const players: PlayerSnap[] = e.players.map((p, i) => {
      const snap: PlayerSnap = {
        name: this.seatName(i),
        bot: !this.seatClient[i],
        online: !!this.seatClient[i],
        chips: p.chips,
        betRound: p.betRound,
        folded: p.folded,
        allIn: p.allIn,
        // 账号座位显示数据库生涯战绩，游客 / 机器人显示本局统计
        won: this.accWon[i] ?? p.won,
        played: this.accPlayed[i] ?? p.played,
        showed: p.showed,
        holeCount: p.hole.length,
      }
      const rv = this.reveal.get(i)
      if (rv && (client.seat === i || this.revealAll || meInHand)) {
        snap.revealed = rv.map(toCardJ)
      }
      // 自己的底牌只发给自己（弃牌后自己仍可见，他人始终看不到）
      if (client.seat === i && p.hole.length > 0) {
        snap.hole = p.hole.map(toCardJ)
      }
      return snap
    })
    const legal =
      client.seat >= 0 && e.actingIndex === client.seat ? e.getLegalActs(client.seat) : undefined
    // 真人行动剩余秒数（客户端本地递减渲染倒计时）
    const turnLeft =
      this.turnTimer && e.actingIndex >= 0 && e.actingIndex === client.seat
        ? Math.max(0, Math.ceil((this.turnDeadline - Date.now()) / 1000))
        : undefined
    const vote: VoteSnap | undefined = this.vote
      ? {
          by: this.vote.by,
          leftSec: Math.max(0, Math.ceil((this.vote.deadline - Date.now()) / 1000)),
          votes: [...this.vote.votes.entries()].map(([seat, agree]) => ({ seat, agree })),
        }
      : undefined
    return {
      handNo: e.handNo,
      phase: PHASE_KEY[e.phase],
      dealerIndex: e.dealerIndex,
      actingIndex: e.actingIndex,
      turnLeft,
      pot,
      community: e.community.map(toCardJ),
      players,
      lastAct: e.lastAction
        ? {
            seat: e.lastAction.playerId,
            kind: e.lastAction.act.kind,
            raiseTo: e.lastAction.act.raiseTo,
            seq: this.actSeq,
          }
        : undefined,
      awards: e.phase === Phase.HandOver ? this.buildAwards() : undefined,
      vote,
      you: {
        seat: client.seat,
        waiting: this.waiting.includes(client),
        legal,
      },
    }
  }

  /**
   * 结算横幅：单一赢家合并播报总额；
   * 多池不同赢家分开播报（主池归 A，边池归 B），只有同池并列才叫「平分」，
   * 避免边池赢家被误读成平分底池。
   */
  private buildAwards(): Snapshot['awards'] | undefined {
    const awards = this.engine.lastAwards
    if (awards.length === 0) {
      return undefined
    }
    const total = awards.reduce((s, a) => s + a.amount, 0)
    const names = (ws: Player[]): string => ws.map((w) => this.seatName(w.id)).join('、')
    const unique = new Set<number>()
    awards.forEach((a) => a.winners.forEach((w) => unique.add(w.id)))
    const potLabel = (a: (typeof awards)[number]): string =>
      a.reason === 'fold' ? '底池' : a.potNo === 0 ? '主池' : '边池'
    const lines = awards.map((a) =>
      a.winners.length > 1
        ? `${potLabel(a)} ${a.amount} ${names(a.winners)} 平分${a.handDesc ? `（${a.handDesc}）` : ''}`
        : `${potLabel(a)} ${a.amount} 归 ${names(a.winners)}${a.handDesc ? `（${a.handDesc}）` : ''}`,
    )
    let title: string
    if (unique.size === 1) {
      title = `${names(awards[0].winners)} 赢得 ${total}`
    } else {
      title = awards
        .map((a) =>
          a.winners.length > 1
            ? `${potLabel(a)} ${names(a.winners)} 平分`
            : `${potLabel(a)} 归 ${names(a.winners)}`,
        )
        .join('，')
    }
    const winners: number[] = []
    unique.forEach((id) => winners.push(id))
    return { title, lines, winners }
  }

  /**
   * 局末归档一手记录（对局记录面板用）：标题与明细复用结算横幅口径；
   * 赢家底牌总是收录——摊牌本就全员可见，弃牌收局的赢家牌做事后复盘（局已结束，无信息优势）。
   */
  private logHand(): void {
    const awards = this.engine.lastAwards
    const built = this.buildAwards()
    if (awards.length === 0 || !built) {
      return
    }
    const unique = new Set<number>()
    awards.forEach((a) => a.winners.forEach((w) => unique.add(w.id)))
    const winners = [...unique].map((id) => ({
      name: this.seatName(id),
      hole: this.engine.players[id].hole.map(toCardJ),
    }))
    this.handLog.push({
      handNo: this.engine.handNo,
      title: built.title,
      lines: built.lines,
      community: this.engine.community.map(toCardJ),
      winners,
    })
    if (this.handLog.length > HISTORY_MAX) {
      this.handLog.shift()
    }
  }
}

// ---------- 纯函数 ----------

function toCardJ(c: Card): CardJ {
  return { r: c.rank, s: c.suit }
}

/** 名字清洗：去空白、限长，空名给默认 */
function sanitizeName(raw: string): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 8)
  return name || `玩家${Math.floor(1000 + Math.random() * 9000)}`
}

/** 网络动作 → 引擎动作（不合法返回 null；check/call 按局面互换容错） */
function toAct(msg: Extract<ClientMsg, { t: 'act' }>, legal: LegalActs): Act | null {
  switch (msg.kind) {
    case 'fold':
      return { kind: ActKind.Fold }
    case 'check':
      return legal.canCheck ? { kind: ActKind.Check } : { kind: ActKind.Call }
    case 'call':
      return legal.canCheck ? { kind: ActKind.Check } : { kind: ActKind.Call }
    case 'raise': {
      if (!legal.canRaise) {
        return null
      }
      const t = Math.floor(Number(msg.raiseTo ?? 0))
      if (t < legal.raiseMinTo || t > legal.raiseMaxTo) {
        return null
      }
      return { kind: ActKind.Raise, raiseTo: t }
    }
    default:
      return null
  }
}
