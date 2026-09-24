import { Card, Suit } from '../core/Card'
import { Deck } from '../core/Deck'
import { GameEngine } from '../core/GameEngine'
import { compareHands, describeHand, evaluate5, evaluateBest, HandCategory } from '../core/HandRank'
import { Player } from '../core/Player'
import { settleShowdown } from '../core/Settler'
import { ActKind } from '../core/Types'

const c = (rank: number, suit: Suit): Card => new Card(rank, suit)

/** 纯逻辑自测：DEV 模式下由 GameApp 启动时调用，结果输出到控制台 */
export function runLogicSelfTests(): void {
  let passed = 0
  const failures: string[] = []
  const test = (name: string, fn: () => void): void => {
    try {
      fn()
      passed++
    } catch (e) {
      failures.push(name)
      console.error(`[自测失败] ${name}:`, e)
    }
  }
  const eq = (actual: unknown, expected: unknown): void => {
    if (actual !== expected) {
      throw new Error(`期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
    }
  }

  test('牌堆为 52 张且无重复', () => {
    const deck = new Deck()
    eq(deck.size, 52)
    eq(new Set(Card.fullDeck().map(x => x.toString())).size, 52)
    deck.shuffle()
    eq(deck.size, 52)
  })

  test('皇家同花顺胜四条', () => {
    const royal = evaluate5([c(14, 's'), c(13, 's'), c(12, 's'), c(11, 's'), c(10, 's')])
    const quads = evaluate5([c(9, 'h'), c(9, 'd'), c(9, 'c'), c(9, 's'), c(3, 'h')])
    eq(royal.category, HandCategory.StraightFlush)
    eq(quads.category, HandCategory.Quads)
    eq(compareHands(royal, quads) > 0, true)
    eq(describeHand(quads).includes('四条'), true)
  })

  test('A-2-3-4-5 是最小顺子', () => {
    const wheel = evaluate5([c(14, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c'), c(5, 's')])
    const lower = evaluate5([c(2, 's'), c(3, 'h'), c(4, 'd'), c(5, 'c'), c(6, 's')])
    eq(wheel.category, HandCategory.Straight)
    eq(wheel.tiebreak[0], 5)
    eq(compareHands(wheel, lower) < 0, true)
  })

  test('葫芦胜同花、同花胜顺子', () => {
    const fh = evaluate5([c(8, 's'), c(8, 'h'), c(8, 'd'), c(4, 'c'), c(4, 's')])
    const flush = evaluate5([c(14, 'd'), c(10, 'd'), c(6, 'd'), c(4, 'd'), c(2, 'd')])
    const straight = evaluate5([c(9, 's'), c(10, 'h'), c(11, 'd'), c(12, 'c'), c(13, 's')])
    eq(compareHands(fh, flush) > 0, true)
    eq(compareHands(flush, straight) > 0, true)
  })

  test('两对比踢脚', () => {
    const a = evaluate5([c(13, 's'), c(13, 'h'), c(9, 'c'), c(9, 'd'), c(14, 's')])
    const b = evaluate5([c(13, 'd'), c(13, 'c'), c(9, 's'), c(9, 'h'), c(12, 's')])
    eq(compareHands(a, b) > 0, true)
  })

  test('七选一最优：一对与四张同花中取同花', () => {
    const best = evaluateBest([
      c(14, 's'), c(13, 's'), c(12, 's'), c(7, 's'), c(2, 's'), c(9, 'd'), c(9, 'c'),
    ])
    eq(best.category, HandCategory.Flush)
  })

  test('引擎：加注全弃后正确结算并退还未跟注', () => {
    const engine = new GameEngine()
    for (let i = 0; i < 4; i++) {
      engine.addPlayer(`P${i}`, i > 0)
    }
    engine.startHand(new Deck())
    eq(engine.actingIndex, 3) // 首手庄家是 0 号，行动从 UTG(3) 开始
    const legal = engine.getLegalActs(3)
    eq(legal.callAmount, 20)
    eq(legal.raiseMinTo, 40)
    eq(engine.act(3, { kind: ActKind.Raise, raiseTo: 60 }), true)
    eq(engine.act(0, { kind: ActKind.Fold }), true)
    eq(engine.act(1, { kind: ActKind.Fold }), true)
    eq(engine.act(2, { kind: ActKind.Fold }), true)
    eq(engine.lastAwards.length, 1)
    eq(engine.lastAwards[0].reason, 'fold')
    eq(engine.lastAwards[0].amount, 50)
    eq(engine.byId(3)!.chips, 1030) // 1000 + 赢下盲注 30
    eq(engine.byId(1)!.chips, 990)
    eq(engine.byId(2)!.chips, 980)
  })

  test('结算：边池分层与弃牌贡献', () => {
    const a = new Player(0, 'A', true, 0)
    const b = new Player(1, 'B', true, 0)
    const cc = new Player(2, 'C', true, 0)
    const d = new Player(3, 'D', true, 0)
    a.hole = [c(14, 's'), c(14, 'h')]
    b.hole = [c(13, 's'), c(13, 'h')]
    cc.hole = [c(12, 's'), c(12, 'h')]
    d.hole = [c(7, 'd'), c(2, 'c')]
    a.betTotal = 100
    b.betTotal = 300
    cc.betTotal = 300
    d.betTotal = 50
    d.folded = true
    a.allIn = b.allIn = true
    const board = [c(2, 'd'), c(7, 'h'), c(9, 's'), c(3, 'h'), c(5, 'd')]
    const pots = settleShowdown([a, b, cc, d], board)
    eq(pots.length, 2)
    eq(pots[0].amount, 350) // 主池：100×3 + 弃牌者 50
    eq(pots[0].winners[0].id, 0) // AA 赢主池
    eq(pots[1].amount, 400) // 边池：B/C 各 200
    eq(pots[1].winners[0].id, 1) // KK 赢边池
  })

  console.log(`[逻辑自测] 通过 ${passed} 项，失败 ${failures.length} 项`)
  if (failures.length > 0) {
    console.warn('[逻辑自测] 失败项：', failures.join(' | '))
  }
}
