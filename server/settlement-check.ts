import { Card } from '../assets/scripts/core/Card'
import { compareHands, describeHand, evaluateBest } from '../assets/scripts/core/HandRank'
import { Player } from '../assets/scripts/core/Player'
import { settleShowdown } from '../assets/scripts/core/Settler'

/**
 * 结算回归检查：复刻线上反馈的「对A 与对9 平分底池」场景。
 * 结论应为：牌型比较不可能判平（对A 恒胜对9）；
 * 所谓「平分」实际是主池归对A、边池归对9 被横幅合并展示造成的误读。
 */

const c = (r: number, s: 's' | 'h' | 'd' | 'c'): Card => new Card(r, s)

const mk = (id: number, name: string, hole: Card[], betTotal: number): Player => {
  const p = new Player(id, name, false, 1000)
  p.hole = hole
  p.betTotal = betTotal
  return p
}

const results: string[] = []
const check = (ok: boolean, label: string): void => {
  results.push(`  ${ok ? '通过' : '失败'} ${label}`)
}

// ---- 场景一：对A 全下争主池，对9 与高牌争边池（对9 合法赢下边池）----
// 公共牌 7-6-4-3-2 彩虹，无干扰
const community = [c(7, 'd'), c(6, 'c'), c(4, 's'), c(3, 'd'), c(2, 'h')]
const A = mk(0, '对A', [c(14, 's'), c(14, 'h')], 300)
const B = mk(1, '对9', [c(9, 's'), c(9, 'h')], 700)
const C = mk(2, '高牌J', [c(11, 'h'), c(10, 's')], 700)
const pots = settleShowdown([A, B, C], community)

check(pots.length === 2, `分层出 2 个池（实际 ${pots.length}）`)
check(
  pots[0].amount === 900 && pots[0].winners.length === 1 && pots[0].winners[0].name === '对A',
  `主池 900 归对A（实际 ${pots[0].amount} 归 ${pots[0].winners.map((w) => w.name).join('、')}）`,
)
check(
  pots[0].handDesc === '一对（A）',
  `主池牌型为一对（A）（实际 ${pots[0].handDesc}）`,
)
check(
  pots[1].amount === 800 && pots[1].winners.length === 1 && pots[1].winners[0].name === '对9',
  `边池 800 归对9（实际 ${pots[1].amount} 归 ${pots[1].winners.map((w) => w.name).join('、')}）`,
)
check(pots[1].handDesc === '一对（9）', `边池牌型为一对（9）（实际 ${pots[1].handDesc}）`)

// ---- 场景二：对A 与对9 直接比较，绝不可能判平 ----
const va = evaluateBest([c(14, 's'), c(14, 'h'), ...community])
const vb = evaluateBest([c(9, 's'), c(9, 'h'), ...community])
check(compareHands(va, vb) > 0, `对A 严格胜对9（${describeHand(va)} vs ${describeHand(vb)}）`)

// ---- 场景三：真平分（双方同为对A 且踢脚相同）才会并列 ----
const D = mk(3, '同花色A', [c(14, 'd'), c(14, 'c')], 300)
const potsTie = settleShowdown([A, D], community)
check(
  potsTie.length === 1 && potsTie[0].winners.length === 2,
  `同强度对A 才平分（实际 ${potsTie[0].winners.length} 家并列）`,
)

console.log('[结算回归结果]')
results.forEach((r) => console.log(r))
const failed = results.filter((r) => r.includes('失败')).length
console.log(`\n[结算回归] 通过 ${results.length - failed} 项，失败 ${failed} 项`)
process.exit(failed > 0 ? 1 : 0)
