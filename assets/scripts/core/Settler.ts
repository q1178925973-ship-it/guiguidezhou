import { Card } from './Card'
import { compareHands, describeHand, evaluateBest, HandValue } from './HandRank'
import { Player } from './Player'
import { PotAward } from './Types'

/**
 * 摊牌结算：按「每人本手总投入」从低到高分层，形成主池 / 边池。
 * 每层由「仍在手内且贡献覆盖该层」的玩家里牌型最大者（可并列）赢得；
 * 已弃牌玩家的筹码照常沉入相应层，但不具备竞争资格。
 */
export function settleShowdown(players: Player[], community: Card[]): PotAward[] {
  const contribs = new Map<Player, number>()
  players.forEach(p => contribs.set(p, p.betTotal))

  const pots: PotAward[] = []
  let potNo = 0
  // 不用 [...contribs.values()]：Cocos 构建的 ES5 降级不会展开 Map 迭代器
  const hasStake = (): boolean => {
    let any = false
    contribs.forEach(v => { if (v > 0) any = true })
    return any
  }
  while (hasStake()) {
    const contenders = players.filter(p => p.inHand && (contribs.get(p) ?? 0) > 0)
    if (contenders.length === 0) {
      break
    }
    const level = Math.min(...contenders.map(p => contribs.get(p)!))

    let amount = 0
    for (const p of players) {
      const take = Math.min(contribs.get(p)!, level)
      contribs.set(p, contribs.get(p)! - take)
      amount += take
    }

    const values = new Map<Player, HandValue>()
    contenders.forEach(p => values.set(p, evaluateBest([...p.hole, ...community])))
    const bestValue = contenders
      .map(p => values.get(p)!)
      .reduce((a, b) => (compareHands(a, b) >= 0 ? a : b))
    const winners = contenders.filter(p => compareHands(values.get(p)!, bestValue) === 0)

    pots.push({
      potNo,
      amount,
      winners,
      reason: 'showdown',
      desc: potNo === 0 ? `主池 ${amount}` : `边池 ${amount}`,
      handDesc: describeHand(bestValue),
    })
    potNo++
  }
  return pots
}
