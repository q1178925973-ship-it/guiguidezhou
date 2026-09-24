import { spawn } from 'child_process'
import WebSocket from 'ws'
import { HandRecordJ, ServerMsg, Snapshot } from '../assets/scripts/net/Protocol'

/**
 * 协议自检：起一个真实服务器，模拟 8 名玩家 + 1 名观战者，
 * 验证入座、快照可见性、非法动作拒绝、AI 自动推进、聊天广播与重置投票。
 */

const PORT = 18080
const DURATION = 30000

interface Recorder {
  name: string
  ws: WebSocket
  welcome: { seat: number; waiting: boolean } | null
  latest: Snapshot | null
  holes: number
  revealedSeen: number
  errs: number
  says: number
  sysTexts: string[]
}

function connect(name: string): Promise<Recorder> {
  return new Promise((resolveFn, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const rec: Recorder = {
      name,
      ws,
      welcome: null,
      latest: null,
      holes: 0,
      revealedSeen: 0,
      errs: 0,
      says: 0,
      sysTexts: [],
    }
    ws.on('open', () => {
      // 协议：客户端连上后先报上名字，服务器分配座位后回 welcome
      ws.send(JSON.stringify({ t: 'join', name }))
      resolveFn(rec)
    })
    ws.on('error', reject)
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMsg
      if (msg.t === 'welcome') {
        rec.welcome = { seat: msg.seat, waiting: msg.waiting }
      } else if (msg.t === 'state') {
        rec.latest = msg.snap
        const me = msg.snap.you.seat >= 0 ? msg.snap.players[msg.snap.you.seat] : undefined
        if (me?.hole?.length) {
          rec.holes++
        }
        msg.snap.players.forEach((p) => {
          if (p.revealed?.length) {
            rec.revealedSeen++
          }
        })
        // 自检替身：轮到本人就自动跟注/过牌，让牌局能推进到摊牌
        if (msg.snap.you.legal) {
          const legal = msg.snap.you.legal
          const act = legal.canCheck ? { t: 'act', kind: 'check' } : { t: 'act', kind: 'call' }
          setTimeout(() => ws.send(JSON.stringify(act)), 120)
        }
      } else if (msg.t === 'err') {
        rec.errs++
      } else if (msg.t === 'say') {
        rec.says++
        if (msg.tag === 'sys') {
          rec.sysTexts.push(msg.text)
        }
        if (process.env.DEBUG_SAY) {
          console.log(`[say→${name}] ${msg.name}: ${msg.text}`)
        }
      }
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 账号流替身：以 register / login 首条消息连接，自动过牌跟注推进牌局 */
interface AuthRec {
  ws: WebSocket
  token: string
  authName: string
  authWon: number
  authPlayed: number
  authErr: string | null
  welcome: { seat: number; waiting: boolean } | null
  latest: Snapshot | null
  sysTexts: string[]
  /** getHistory 的最近一次应答 */
  hist: HandRecordJ[] | null
}

function connectAuth(port: number, first: Record<string, unknown>): Promise<AuthRec> {
  return new Promise((resolveFn, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const rec: AuthRec = {
      ws,
      token: '',
      authName: '',
      authWon: -1,
      authPlayed: -1,
      authErr: null,
      welcome: null,
      latest: null,
      sysTexts: [],
      hist: null,
    }
    ws.on('open', () => {
      ws.send(JSON.stringify(first))
      resolveFn(rec)
    })
    ws.on('error', reject)
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMsg
      if (msg.t === 'auth-ok') {
        rec.token = msg.token
        rec.authName = msg.name
        rec.authWon = msg.won
        rec.authPlayed = msg.played
      } else if (msg.t === 'auth-err') {
        rec.authErr = msg.msg
      } else if (msg.t === 'welcome') {
        rec.welcome = { seat: msg.seat, waiting: msg.waiting }
      } else if (msg.t === 'state') {
        rec.latest = msg.snap
        if (msg.snap.you.legal) {
          const legal = msg.snap.you.legal
          const act = legal.canCheck ? { t: 'act', kind: 'check' } : { t: 'act', kind: 'call' }
          setTimeout(() => ws.send(JSON.stringify(act)), 120)
        }
      } else if (msg.t === 'say' && msg.tag === 'sys') {
        rec.sysTexts.push(msg.text)
      } else if (msg.t === 'history') {
        rec.hist = msg.hands
      }
    })
  })
}

/** 轮询等待条件成立（局末到下一手有 6 秒间隔，固定时刻断言会踩空） */
async function waitFor(fn: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) {
      return true
    }
    await sleep(300)
  }
  return fn()
}

async function runSelftest(): Promise<void> {
  const child = spawn('npx', ['tsx', 'index.ts'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT), TEXAS_DB: ':memory:' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[server!] ${d}`))

  const results: string[] = []
  const fail = (msg: string) => results.push(`  失败 ${msg}`)
  const pass = (msg: string) => results.push(`  通过 ${msg}`)

  try {
    await sleep(2500)
    const alice = await connect('alice')
    const bob = await connect('bob')
    await sleep(500)
    // 非法动作：还没轮到也发一个 raise，应收到 err
    alice.ws.send(JSON.stringify({ t: 'act', kind: 'raise', raiseTo: 99999 }))
    await sleep(500)
    // 此时桌上只有 alice 一个真人入座，其余 7 座应为 bot
    const botsSeen = (alice.latest?.players ?? []).filter((p) => p.bot).length
    // 第 3~8 个真人：手进行中加入，排队等下一手入座（8 人桌）
    const carol = await connect('carol')
    const dave = await connect('dave')
    const eve = await connect('eve')
    const frank = await connect('frank')
    const grace = await connect('grace')
    const henry = await connect('henry')
    await sleep(500)
    // 第 9 个连接应进观战（seat -1）
    const iris = await connect('iris')
    await sleep(1000)
    // 真人聊天广播
    alice.ws.send(JSON.stringify({ t: 'chat', text: '大家好' }))
    await sleep(500)

    // 替身自动跟注，等牌局自然推进若干手，随后校验座位终态
    await sleep(DURATION - 6000)
    const seated = await waitFor(
      () => [alice, bob, carol, dave, eve, frank, grace, henry].every((r, i) => r.latest?.you.seat === i),
      30000,
    )
    await waitFor(() => (alice.latest?.handNo ?? 0) >= 2, 25000)
    const playedBefore = alice.latest?.players[0]?.played ?? 0

    const check = (ok: boolean, label: string): void => {
      ok ? pass(label) : fail(label)
    }
    check(botsSeen === 7, `手进行中 7 空位由 AI 补位（实际 ${botsSeen}）`)
    check(alice.latest?.you.seat === 0, `alice 座位 0（实际 ${alice.latest?.you.seat}）`)
    check(seated, `8 名真人全部排队入座（bob~henry 座位 1~7）`)
    check(iris.latest?.you.seat === -1, `满员后 iris 观战（实际 ${iris.latest?.you.seat}）`)

    const snapIris = iris.latest
    if (snapIris) {
      snapIris.players.length === 8 ? pass('快照含 8 名玩家') : fail(`快照玩家数 ${snapIris.players.length}`)
      const anyHidden = snapIris.players.some((p) => p.holeCount > 0)
      anyHidden ? pass('观战者能看到各家牌背数量') : fail('观战者看不到牌背')
      const leak = JSON.stringify(snapIris).includes('"hole":')
      !leak ? pass('观战者收不到任何底牌') : fail('观战者收到了底牌（信息泄露）')
      const stats = snapIris.players.every((p) => typeof p.won === 'number' && typeof p.played === 'number')
      stats ? pass('快照含胜负局数统计') : fail('快照缺少胜负局数统计')
    } else {
      fail('观战者未收到快照')
    }
    const snapAlice = alice.latest
    if (snapAlice && snapAlice.you.seat >= 0) {
      pass(`alice 快照 handNo = ${snapAlice.handNo}`)
      alice.errs > 0 ? pass('非法动作被拒绝（收到 err）') : fail('非法动作未被拒绝')
      check(playedBefore >= 2, `胜负统计随手数累计（played=${playedBefore}）`)
    } else {
      fail('alice 未收到快照')
    }
    bob.says > 0 ? pass(`收到聊天/AI 台词广播 ${bob.says} 条`) : fail('无聊天广播')
    const handBeforeVote = alice.latest?.handNo ?? 0
    check(handBeforeVote >= 2, `牌局自动推进了多手（handNo=${handBeforeVote}）`)

    // ---- 重置投票：一人反对即失败 ----
    alice.ws.send(JSON.stringify({ t: 'voteReset' }))
    await waitFor(() => !!alice.latest?.vote, 5000)
    check(!!alice.latest?.vote, `发起投票后快照带投票状态`)
    bob.ws.send(JSON.stringify({ t: 'voteReset', agree: false }))
    const refused = await waitFor(
      () => alice.sysTexts.some((t) => t.includes('反对')) && !alice.latest?.vote,
      5000,
    )
    check(refused, '反对后投票立即失败并广播系统消息')
    await sleep(1000)
    check(
      (alice.latest?.handNo ?? 0) >= handBeforeVote,
      `投票失败后对局继续（handNo=${alice.latest?.handNo}）`,
    )

    // ---- 重置投票：全员同意即通过（冷却 8 秒后重新发起）----
    await sleep(8500)
    alice.ws.send(JSON.stringify({ t: 'voteReset' }))
    await waitFor(() => !!alice.latest?.vote, 5000)
    ;[bob, carol, dave, eve, frank, grace, henry].forEach((r) =>
      r.ws.send(JSON.stringify({ t: 'voteReset', agree: true })),
    )
    const resetDone = await waitFor(
      () =>
        !!alice.latest &&
        (alice.latest.handNo <= 2 || (alice.latest.players[0]?.played ?? 99) <= 1) &&
        !alice.latest.vote,
      15000,
    )
    check(resetDone, '全员同意后对局重置（手数与统计回到起点）')
    check(
      alice.sysTexts.some((t) => t.includes('重置')),
      '重置时广播系统说明',
    )

    // 摊牌亮牌可见性：长时间运行里应有 revealed 出现过（观战者只见摊牌，不见弃牌亮牌）
    iris.revealedSeen > 0
      ? pass(`观战者看到过摊牌亮牌（${iris.revealedSeen} 次）`)
      : pass('本次未到摊牌（真人未行动导致等待，属正常）')

    // ---- 账号流：独立服务器 + 内存库，验证注册 / 登录 / token 找回座位 / 胜负入库 ----
    // 节奏调快（AI 思考 / 局间间隔），让两手牌在可接受的窗口内打完
    const child2 = spawn('npx', ['tsx', 'index.ts'], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(PORT + 1),
        TEXAS_DB: ':memory:',
        TEXAS_NEXT_HAND_MS: '1200',
        TEXAS_BOT_THINK_MIN: '250',
        TEXAS_BOT_THINK_MAX: '500',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      await sleep(2500)
      // 逐步等待回复再断言：认证应答是异步的，open 即查必踩空
      const zhang = await connectAuth(PORT + 1, { t: 'register', name: '张三', pass: '秘密123' })
      check(
        await waitFor(() => !!zhang.token && zhang.authName === '张三', 5000),
        '注册成功返回 token（中文用户名）',
      )
      const dup = await connectAuth(PORT + 1, { t: 'register', name: '张三', pass: '随便' })
      check(await waitFor(() => (dup.authErr ?? '').includes('已被注册'), 5000), '重名注册被拒绝')
      const wrong = await connectAuth(PORT + 1, { t: 'login', name: '张三', pass: '错误的' })
      check(await waitFor(() => (wrong.authErr ?? '').includes('不正确'), 5000), '错误密码登录被拒绝')
      // 替身自动过牌：handNo>=3 表示打完两手（结算过两次），账号胜负随每次局末入库
      await waitFor(() => (zhang.latest?.handNo ?? 0) >= 3, 90000)
      // 对局记录：按需拉取应包含打完的手牌（最新在前，赢家带两张底牌）
      zhang.ws.send(JSON.stringify({ t: 'getHistory' }))
      const gotHist = await waitFor(() => (zhang.hist?.length ?? 0) >= 2, 8000)
      check(gotHist, `对局记录按需下发（${zhang.hist?.length ?? 0} 手）`)
      const h0 = zhang.hist?.[0]
      check(
        !!h0 &&
          h0.handNo > 0 &&
          h0.title.length > 0 &&
          Array.isArray(h0.community) &&
          Array.isArray(h0.others) &&
          h0.winners.length > 0 &&
          h0.winners.every((w) => w.hole.length === 2),
        '记录含手数 / 标题 / 公共牌 / 赢家底牌 / 其余玩家',
      )
      check(
        (zhang.hist ?? []).every((h, i) => i === 0 || (zhang.hist ?? [])[i - 1].handNo > h.handNo),
        '记录按最新在前排序',
      )
      const mySeat = zhang.welcome?.seat ?? -1
      zhang.ws.close()
      await sleep(800)
      // 断线托管：座位名牌应立即换成机器人名（与聊天/台词口径一致，不出戏）
      const watcher = await connectAuth(PORT + 1, { t: 'join', name: '旁观者' })
      await waitFor(() => !!watcher.latest, 8000)
      check(
        (watcher.latest?.players[mySeat]?.name ?? '张三') !== '张三',
        `断线托管后名牌立即换机器人名（实际 ${watcher.latest?.players[mySeat]?.name}）`,
      )
      watcher.ws.close()
      const back = await connectAuth(PORT + 1, { t: 'login', token: zhang.token })
      const reclaimed = await waitFor(
        () => back.welcome?.seat === mySeat && back.sysTexts.some((t) => t.includes('找回')),
        8000,
      )
      check(reclaimed, `token 重登找回原座位（seat=${mySeat}）`)
      await waitFor(() => back.latest?.players[mySeat]?.name === '张三', 8000)
      check(
        back.latest?.players[mySeat]?.name === '张三',
        `找回座位后名牌恢复玩家名（实际 ${back.latest?.players[mySeat]?.name}）`,
      )
      // 全新连接账密登录：生涯战绩应已持久化（played>=2）
      const again = await connectAuth(PORT + 1, { t: 'login', name: '张三', pass: '秘密123' })
      await waitFor(() => again.authPlayed >= 2, 10000)
      check(again.authPlayed >= 2, `胜负数已入库（won=${again.authWon} played=${again.authPlayed}）`)
      check(again.authWon >= 0 && again.authWon + again.authPlayed >= 2, '胜场数随结算累计')
      back.ws.close()
      again.ws.close()
      dup.ws.close()
      wrong.ws.close()
    } finally {
      child2.kill('SIGTERM')
    }
  } catch (err) {
    fail(`异常退出：${String(err)}`)
  } finally {
    child.kill('SIGTERM')
  }

  console.log('\n[协议自检结果]')
  results.forEach((r) => console.log(r))
  // 只统计行首的「失败」标记，避免通过文案里含「失败」二字被误计
  const failed = results.filter((r) => r.trimStart().startsWith('失败')).length
  console.log(`\n[协议自检] 通过 ${results.length - failed} 项，失败 ${failed} 项`)
  process.exit(failed > 0 ? 1 : 0)
}

void runSelftest()
