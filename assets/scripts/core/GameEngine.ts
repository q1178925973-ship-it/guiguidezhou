import { Card } from './Card'
import { Deck } from './Deck'
import { Player } from './Player'
import { settleShowdown } from './Settler'
import { Act, ActKind, EngineConfig, GameEvent, LegalActs, Phase, PotAward } from './Types'

const DEFAULT_CONFIG: EngineConfig = {
  startChips: 1000,
  smallBlind: 10,
  bigBlind: 20,
}

const NEXT_PHASE: Partial<Record<Phase, Phase>> = {
  [Phase.Preflop]: Phase.Flop,
  [Phase.Flop]: Phase.Turn,
  [Phase.Turn]: Phase.River,
}

/**
 * 德州牌局状态机：盲注 → 各街下注 → 摊牌结算。
 * 纯逻辑无渲染依赖，玩家 id 与 players 数组下标一致。
 * 注意：小于最小加注的全下不再开放他人重新加注（官方规则简化）。
 */
export class GameEngine {
  readonly cfg: EngineConfig
  players: Player[] = []
  community: Card[] = []
  phase = Phase.Idle
  /** 已收集的底池总额（展示时另加本轮未收注） */
  potAmount = 0
  /** 本轮最高注（本轮总投入口径） */
  currentBet = 0
  /** 最小加注增量 */
  minRaise = 0
  dealerIndex = -1
  actingIndex = -1
  handNo = 0
  /** 最近一手牌结算结果，hand-end 事件时读取 */
  lastAwards: PotAward[] = []
  /** 最近一次成功的动作，act 事件时读取 */
  lastAction: { playerId: number; act: Act } | null = null

  private deck = new Deck()
  private listeners: Array<(ev: GameEvent) => void> = []

  constructor(cfg: Partial<EngineConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg }
  }

  on(fn: (ev: GameEvent) => void): void {
    this.listeners.push(fn)
  }

  private emit(ev: GameEvent): void {
    this.listeners.forEach(fn => fn(ev))
  }

  addPlayer(name: string, isBot: boolean): Player {
    const player = new Player(this.players.length, name, isBot, this.cfg.startChips)
    this.players.push(player)
    return player
  }

  byId(id: number): Player | undefined {
    return this.players.find(p => p.id === id)
  }

  get actingPlayer(): Player | undefined {
    return this.actingIndex >= 0 ? this.players[this.actingIndex] : undefined
  }

  aliveCount(): number {
    return this.players.filter(p => p.inHand).length
  }

  /** 开启一手新牌；可传入固定顺序牌堆（测试用） */
  startHand(deck?: Deck): void {
    if (this.players.length < 2) {
      throw new Error('至少需要 2 名玩家')
    }
    this.deck = deck ?? new Deck()
    if (!deck) {
      this.deck.shuffle()
    }
    this.handNo++
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length
    this.players.forEach(p => {
      p.resetForHand()
      p.played++
    })
    this.community = []
    this.potAmount = 0
    this.lastAwards = []
    this.lastAction = null
    this.phase = Phase.Preflop
    this.emit('hand-start')

    const n = this.players.length
    this.players[(this.dealerIndex + 1) % n].pay(this.cfg.smallBlind)
    this.players[(this.dealerIndex + 2) % n].pay(this.cfg.bigBlind)
    this.currentBet = this.cfg.bigBlind
    this.minRaise = this.cfg.bigBlind
    this.emit('blinds')

    for (let round = 0; round < 2; round++) {
      for (const p of this.players) {
        p.hole.push(this.deck.deal())
      }
    }
    this.emit('deal-hole')

    this.actingIndex = (this.dealerIndex + 3) % n
    this.emit('turn')
  }

  /** 某玩家当前可执行的操作 */
  getLegalActs(id: number): LegalActs {
    const p = this.byId(id)
    const toCall = p ? this.currentBet - p.betRound : 0
    const maxTo = p ? p.betRound + p.chips : 0
    return {
      canFold: !!p,
      canCheck: p ? toCall <= 0 : false,
      callAmount: p ? Math.max(0, Math.min(toCall, p.chips)) : 0,
      canRaise: p ? p.chips > Math.max(0, toCall) : false,
      raiseMinTo: Math.min(this.currentBet + this.minRaise, maxTo),
      raiseMaxTo: maxTo,
    }
  }

  /** 执行动作（仅当前行动玩家有效） */
  act(id: number, act: Act): boolean {
    const p = this.byId(id)
    if (!p || this.actingIndex !== id || !p.inHand || p.allIn) {
      return false
    }
    switch (act.kind) {
      case ActKind.Fold:
        p.folded = true
        p.acted = true
        break
      case ActKind.Check:
        if (this.currentBet > p.betRound) {
          return false
        }
        p.acted = true
        break
      case ActKind.Call: {
        const need = this.currentBet - p.betRound
        if (need <= 0) {
          return false
        }
        p.pay(need)
        p.acted = true
        break
      }
      case ActKind.Raise: {
        const maxTo = p.betRound + p.chips
        const target = Math.floor(act.raiseTo ?? 0)
        const isAllIn = target === maxTo
        const minTo = Math.min(this.currentBet + this.minRaise, maxTo)
        if (target <= this.currentBet || target > maxTo || (!isAllIn && target < minTo)) {
          return false
        }
        const raiseSize = target - this.currentBet
        p.pay(target - p.betRound)
        if (raiseSize >= this.minRaise) {
          this.minRaise = raiseSize
        }
        this.currentBet = target
        this.players.forEach(o => {
          if (o !== p) {
            o.acted = false
          }
        })
        p.acted = true
        break
      }
      default:
        return false
    }
    this.lastAction = { playerId: id, act }
    this.emit('act')
    if (this.aliveCount() === 1) {
      this.finishByFold()
    } else {
      this.advanceTurn()
    }
    return true
  }

  /** 找下一个需要行动的玩家；没有则本轮下注结束 */
  private advanceTurn(): void {
    const n = this.players.length
    for (let step = 1; step <= n; step++) {
      const i = (this.actingIndex + step) % n
      const p = this.players[i]
      if (p.inHand && !p.allIn && (!p.acted || p.betRound < this.currentBet)) {
        this.actingIndex = i
        this.emit('turn')
        return
      }
    }
    this.actingIndex = -1
    this.endBettingRound()
  }

  private endBettingRound(): void {
    this.potAmount = this.players.reduce((sum, p) => sum + p.betTotal, 0)
    this.players.forEach(p => {
      p.betRound = 0
      p.acted = false
    })
    this.currentBet = 0
    this.minRaise = this.cfg.bigBlind

    const next = NEXT_PHASE[this.phase]
    if (!next) {
      this.doShowdown()
      return
    }
    this.phase = next
    const count = this.phase === Phase.Flop ? 3 : 1
    for (let i = 0; i < count; i++) {
      this.community.push(this.deck.deal())
    }
    this.emit('street')

    // 剩余可行动玩家 ≥2 才继续下注，否则直接发完公共牌（全下 run-out）
    if (this.players.filter(p => p.inHand && !p.allIn).length >= 2) {
      this.actingIndex = this.firstActingAfter(this.dealerIndex)
      this.emit('turn')
    } else {
      this.endBettingRound()
    }
  }

  private firstActingAfter(from: number): number {
    const n = this.players.length
    for (let step = 1; step <= n; step++) {
      const i = (from + step) % n
      const p = this.players[i]
      if (p.inHand && !p.allIn) {
        return i
      }
    }
    return -1
  }

  /** 其余人全部弃牌：退还超额后底池直接归最后一人 */
  private finishByFold(): void {
    this.refundUncalled()
    const winner = this.players.find(p => p.inHand)!
    const amount = this.players.reduce((sum, p) => sum + p.betTotal, 0)
    winner.chips += amount
    winner.won++
    this.lastAwards = [{ potNo: 0, amount, winners: [winner], reason: 'fold', desc: `底池 ${amount}` }]
    this.actingIndex = -1
    this.phase = Phase.HandOver
    this.emit('hand-end')
  }

  /** 总投入最高者中未被任何人跟上的部分退还（含全下超额） */
  private refundUncalled(): void {
    const sorted = [...this.players].sort((a, b) => b.betTotal - a.betTotal)
    const top = sorted[0]
    const excess = top ? top.betTotal - (sorted[1]?.betTotal ?? 0) : 0
    if (top && excess > 0) {
      top.chips += excess
      top.betTotal -= excess
    }
  }

  private doShowdown(): void {
    this.refundUncalled()
    this.phase = Phase.Showdown
    this.actingIndex = -1
    this.emit('showdown')
    this.lastAwards = settleShowdown(this.players, this.community)
    // 平分时余数从最靠前座位开始每家 1 筹码
    for (const pot of this.lastAwards) {
      pot.winners.forEach(w => w.won++)
      const share = Math.floor(pot.amount / pot.winners.length)
      let remainder = pot.amount - share * pot.winners.length
      for (const w of pot.winners) {
        w.chips += share + (remainder-- > 0 ? 1 : 0)
      }
    }
    this.phase = Phase.HandOver
    this.emit('hand-end')
  }
}
