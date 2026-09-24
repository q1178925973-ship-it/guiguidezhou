/** 花色：s 黑桃 h 红心 d 方块 c 梅花 */
export const SUITS = ['s', 'h', 'd', 'c'] as const
export type Suit = typeof SUITS[number]

/** 点数：2~14（11=J 12=Q 13=K 14=A） */
export type Rank = number

/** 一张扑克牌：纯数据对象，不依赖渲染层 */
export class Card {
  constructor(readonly rank: Rank, readonly suit: Suit) {}

  /** 点数显示文本（10、J、Q、K、A） */
  get rankLabel(): string {
    return Card.labelOf(this.rank)
  }

  /** 花色显示符号 */
  get suitLabel(): string {
    return { s: '♠', h: '♥', d: '♦', c: '♣' }[this.suit]
  }

  /** 是否红色花色（渲染用） */
  get isRed(): boolean {
    return this.suit === 'h' || this.suit === 'd'
  }

  toString(): string {
    return this.rankLabel + this.suitLabel
  }

  static labelOf(rank: Rank): string {
    const map: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
    return map[rank] ?? String(rank)
  }

  /** 生成一副完整 52 张牌 */
  static fullDeck(): Card[] {
    const deck: Card[] = []
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) {
        deck.push(new Card(rank, suit))
      }
    }
    return deck
  }
}
