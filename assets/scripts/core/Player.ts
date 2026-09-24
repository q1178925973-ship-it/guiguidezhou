import { Card } from './Card'

/**
 * 玩家：真人与 AI 共用的纯数据结构。
 * 下注金额一律记整数筹码。
 */
export class Player {
  /** 底牌 */
  hole: Card[] = []
  /** 本轮（当前街）已投入 */
  betRound = 0
  /** 本手牌总投入（边池分层结算依据） */
  betTotal = 0
  /** 剩余筹码 */
  chips: number
  folded = false
  allIn = false
  /** 本轮是否已行动过（下注轮结束判定用） */
  acted = false
  /** 累计赢下手数与参与手数（跨手统计，随引擎重建 / 重置对局清零） */
  won = 0
  played = 0
  /** 本手已主动亮牌（亮出后不可收回，新手复位） */
  showed = false

  constructor(
    readonly id: number,
    readonly name: string,
    readonly isBot: boolean,
    startChips: number,
  ) {
    this.chips = startChips
  }

  /** 尚未弃牌 */
  get inHand(): boolean {
    return !this.folded
  }

  /** 新一手开始时复位手内状态（筹码保留） */
  resetForHand(): void {
    this.hole = []
    this.betRound = 0
    this.betTotal = 0
    this.folded = false
    this.allIn = false
    this.acted = false
    this.showed = false
  }

  /**
   * 投入筹码：不足时按剩余全下。
   * @returns 实际投入金额
   */
  pay(amount: number): number {
    const real = Math.max(0, Math.min(amount, this.chips))
    this.chips -= real
    this.betRound += real
    this.betTotal += real
    if (this.chips === 0 && real > 0) {
      this.allIn = true
    }
    return real
  }
}
