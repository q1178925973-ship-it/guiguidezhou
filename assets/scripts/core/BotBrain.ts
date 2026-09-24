import { Card } from './Card'
import { GameEngine } from './GameEngine'
import { evaluateBest, HandCategory } from './HandRank'
import { Act, ActKind, LegalActs } from './Types'

/**
 * 极简 AI：
 * - 翻牌前用 Chen 公式给底牌打分；
 * - 翻牌后按「当前成牌强度」估势（不考虑听牌，教学够用）；
 * - 决策带少量随机性（诈唬 / 混淆），避免行为死板。
 */
export class BotBrain {
  decide(engine: GameEngine, botId: number): Act {
    const legal = engine.getLegalActs(botId)
    const me = engine.byId(botId)!
    const strength =
      engine.community.length === 0
        ? preflopScore(me.hole)
        : postflopScore(me.hole, engine.community)
    const r = Math.random()

    if (legal.canCheck) {
      // 免费时可看牌：强牌倾向下注，弱牌偶尔诈唬
      if (strength > 0.72 && r < 0.7) {
        return raiseAct(legal, engine, strength > 0.9)
      }
      if (strength < 0.35 && r < 0.1) {
        return raiseAct(legal, engine, false)
      }
      return { kind: ActKind.Check }
    }

    // 面对下注：强度优先，其次看底池赔率是否便宜
    const potOdds = legal.callAmount / Math.max(1, engine.potAmount + legal.callAmount)
    if (strength > 0.82 && r < 0.6) {
      return raiseAct(legal, engine, strength > 0.92)
    }
    if (strength > 0.45) {
      return { kind: ActKind.Call }
    }
    if (potOdds < 0.18 && strength > 0.25) {
      return { kind: ActKind.Call }
    }
    if (r < 0.05) {
      return raiseAct(legal, engine, false)
    }
    return { kind: ActKind.Fold }
  }
}

/** 生成加注动作：牌力越强加得越多，超池时直接全下 */
function raiseAct(legal: LegalActs, engine: GameEngine, toNuts: boolean): Act {
  if (!legal.canRaise) {
    return { kind: legal.canCheck ? ActKind.Check : ActKind.Call }
  }
  const potTarget = engine.currentBet * 2 + Math.round(engine.potAmount * 0.6)
  const target = toNuts
    ? legal.raiseMaxTo
    : Math.min(legal.raiseMaxTo, Math.max(legal.raiseMinTo, potTarget))
  return { kind: ActKind.Raise, raiseTo: target }
}

/** Chen 公式：底牌起点分（AA=20 … 垃圾牌≈0），映射到 0~1 */
function preflopScore(hole: Card[]): number {
  const [hi, lo] = [...hole].sort((a, b) => b.rank - a.rank)
  const val = (r: number): number => ({ 14: 10, 13: 8, 12: 7, 11: 6 } as Record<number, number>)[r] ?? r / 2
  let score = hi.rank === lo.rank ? Math.max(val(hi.rank) * 2, 5) : val(hi.rank)
  if (hi.rank !== lo.rank) {
    if (hi.suit === lo.suit) {
      score += 2
    }
    const gap = hi.rank - lo.rank - 1
    score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5
    if (gap <= 1 && hi.rank < 12) {
      score += 1
    }
  }
  return Math.max(0, Math.min(1, score / 16 + (Math.random() - 0.5) * 0.06))
}

/** 翻牌后：以当前最佳成牌为基准的粗略强度 */
function postflopScore(hole: Card[], community: Card[]): number {
  const base: Record<HandCategory, number> = {
    [HandCategory.HighCard]: 0.1,
    [HandCategory.Pair]: 0.32,
    [HandCategory.TwoPair]: 0.58,
    [HandCategory.Trips]: 0.72,
    [HandCategory.Straight]: 0.84,
    [HandCategory.Flush]: 0.88,
    [HandCategory.FullHouse]: 0.94,
    [HandCategory.Quads]: 0.98,
    [HandCategory.StraightFlush]: 1,
  }
  const v = evaluateBest([...hole, ...community])
  let score = base[v.category]
  const boardHigh = Math.max(...community.map(x => x.rank))
  if (v.category === HandCategory.Pair) {
    // 顶对 / 超对明显强于小对
    score += v.tiebreak[0] >= boardHigh ? 0.18 : (v.tiebreak[0] / 14) * 0.08
  } else if (v.category === HandCategory.HighCard) {
    score += (v.tiebreak[0] / 14) * 0.08
  }
  return Math.max(0, Math.min(1, score + (Math.random() - 0.5) * 0.08))
}
