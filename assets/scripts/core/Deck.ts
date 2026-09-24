import { Card } from './Card'

/**
 * 牌堆：负责洗牌与发牌。
 * 构造时可传入固定顺序（用于单元测试或回放），默认生成乱序前先按顺序排好。
 */
export class Deck {
  private cards: Card[]

  constructor(cards?: Card[]) {
    this.cards = cards ? [...cards] : Card.fullDeck()
  }

  get size(): number {
    return this.cards.length
  }

  /** Fisher-Yates 洗牌（原地打乱） */
  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = this.cards[i]
      this.cards[i] = this.cards[j]
      this.cards[j] = tmp
    }
  }

  /** 从牌堆顶发出一张 */
  deal(): Card {
    const card = this.cards.pop()
    if (!card) {
      throw new Error('牌堆已空：一副牌最多支持 22 名玩家')
    }
    return card
  }
}
