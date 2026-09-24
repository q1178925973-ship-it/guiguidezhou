import { Card } from '../core/Card'
import { compareHands, describeHand, evaluateBest } from '../core/HandRank'

/** 蒙特卡洛模拟次数（精度与性能折中，同步计算毫秒级） */
const SIMS = 160

/**
 * 玩家辅助计算：拼装「当前牌型 · 蒙特卡洛胜率」文案。
 * 展示由玩家名牌的提示行承担（见 SeatView.setHint）。
 */
export function buildHeroHint(hole: Card[], community: Card[], opponents: number): string {
  const hand = community.length >= 3 ? describeHand(evaluateBest([...hole, ...community])) : ''
  const equity = simulate(hole, community, opponents)
  return hand ? `${hand} · 胜率 ${equity}%` : `胜率 ${equity}%`
}

/** 蒙特卡洛胜率：随机补全公共牌与对手底牌，赢计 1 分 / 平计 0.5 分 */
function simulate(hole: Card[], community: Card[], opponents: number): number {
  const known = new Set(hole.concat(community).map((c) => c.toString()))
  const rest = Card.fullDeck().filter((c) => !known.has(c.toString()))
  let score = 0
  for (let s = 0; s < SIMS; s++) {
    // 部分洗牌：只洗需要的前 need 张（补公共牌 + 每对手 2 张）
    const need = opponents * 2 + (5 - community.length)
    for (let i = 0; i < need && i < rest.length - 1; i++) {
      const j = i + Math.floor(Math.random() * (rest.length - i))
      const t = rest[i]
      rest[i] = rest[j]
      rest[j] = t
    }
    const board = community.concat(rest.slice(0, 5 - community.length))
    const mine = evaluateBest(hole.concat(board))
    const oppBase = 5 - community.length
    let lost = false
    let tie = false
    for (let o = 0; o < opponents; o++) {
      const v = evaluateBest([rest[oppBase + o * 2], rest[oppBase + o * 2 + 1], ...board])
      const c = compareHands(v, mine)
      if (c > 0) {
        lost = true
        break
      }
      if (c === 0) {
        tie = true
      }
    }
    score += lost ? 0 : tie ? 0.5 : 1
  }
  return Math.round((score / SIMS) * 100)
}
