import { Card } from './Card'

/** 牌型类别（数值越大越强） */
export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

/** 一手牌的比较值：类别 + 决胜踢脚序列（从大到小） */
export interface HandValue {
  category: HandCategory
  tiebreak: number[]
}

/** 评估恰好 5 张牌的牌型 */
export function evaluate5(cards: Card[]): HandValue {
  if (cards.length !== 5) {
    throw new Error('evaluate5 需要 5 张牌')
  }
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a)
  const isFlush = cards.every(c => c.suit === cards[0].suit)
  // 不用 [...new Set(ranks)]：Cocos 构建的 ES5 降级会变成 [].concat(Set)，
  // Set 不会被展开（ranks 已降序，相邻去重等价）
  const uniq: number[] = []
  for (let i = 0; i < ranks.length; i++) {
    if (i === 0 || ranks[i] !== ranks[i - 1]) {
      uniq.push(ranks[i])
    }
  }

  // 按点数分组：entries = [点数, 张数]，按张数多、点数大排序
  // （同样不用 [...counts.entries()]，ES5 降级不展开 Map 迭代器）
  const counts = new Map<number, number>()
  for (const r of ranks) {
    counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  const groups: Array<[number, number]> = []
  counts.forEach((count, rank) => groups.push([rank, count]))
  groups.sort((a, b) => b[1] - a[1] || b[0] - a[0])

  // 顺子检测：A 可当 1 组成 A-2-3-4-5（此时顺子最高牌记为 5）
  let straightHigh = 0
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) {
      straightHigh = uniq[0]
    } else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) {
      straightHigh = 5
    }
  }
  const kickers = groups.map(g => g[0])

  if (isFlush && straightHigh > 0) {
    return { category: HandCategory.StraightFlush, tiebreak: [straightHigh] }
  }
  if (groups[0][1] === 4) {
    return { category: HandCategory.Quads, tiebreak: kickers }
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { category: HandCategory.FullHouse, tiebreak: kickers }
  }
  if (isFlush) {
    return { category: HandCategory.Flush, tiebreak: uniq }
  }
  if (straightHigh > 0) {
    return { category: HandCategory.Straight, tiebreak: [straightHigh] }
  }
  if (groups[0][1] === 3) {
    return { category: HandCategory.Trips, tiebreak: kickers }
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return { category: HandCategory.TwoPair, tiebreak: kickers }
  }
  if (groups[0][1] === 2) {
    return { category: HandCategory.Pair, tiebreak: kickers }
  }
  return { category: HandCategory.HighCard, tiebreak: uniq }
}

/** 比较：>0 表示 a 胜，=0 平分，<0 a 负 */
export function compareHands(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) {
    return a.category - b.category
  }
  const len = Math.min(a.tiebreak.length, b.tiebreak.length)
  for (let i = 0; i < len; i++) {
    if (a.tiebreak[i] !== b.tiebreak[i]) {
      return a.tiebreak[i] - b.tiebreak[i]
    }
  }
  return 0
}

/** 从 5~7 张牌（底牌 + 公共牌）中枚举所有 5 张组合，取最优 */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error('evaluateBest 需要 5~7 张牌')
  }
  const n = cards.length
  const pick: number[] = []
  let best: HandValue | null = null
  const choose = (start: number): void => {
    if (pick.length === 5) {
      const v = evaluate5(pick.map(i => cards[i]))
      if (!best || compareHands(v, best) > 0) {
        best = v
      }
      return
    }
    for (let i = start; i <= n - (5 - pick.length); i++) {
      pick.push(i)
      choose(i + 1)
      pick.pop()
    }
  }
  choose(0)
  return best as HandValue
}

/** 中文描述牌型，如「两对（K 和 9）」 */
export function describeHand(v: HandValue): string {
  const t = v.tiebreak
  const label = Card.labelOf
  switch (v.category) {
    case HandCategory.StraightFlush:
      return t[0] === 14 ? '皇家同花顺' : `同花顺（${label(t[0])} 高）`
    case HandCategory.Quads:
      return `四条（${label(t[0])}）`
    case HandCategory.FullHouse:
      return `葫芦（${label(t[0])} 带 ${label(t[1])}）`
    case HandCategory.Flush:
      return `同花（${label(t[0])} 高）`
    case HandCategory.Straight:
      return `顺子（${label(t[0])} 高）`
    case HandCategory.Trips:
      return `三条（${label(t[0])}）`
    case HandCategory.TwoPair:
      return `两对（${label(t[0])} 和 ${label(t[1])}）`
    case HandCategory.Pair:
      return `一对（${label(t[0])}）`
    default:
      return `高牌（${label(t[0])}）`
  }
}
