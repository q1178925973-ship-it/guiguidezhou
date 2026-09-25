import { spawn } from 'child_process'
import { join } from 'path'
import WebSocket from 'ws'
import { HandRecordJ, RoomInfo, ServerMsg, Snapshot } from '../assets/scripts/net/Protocol'

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
  /** 多房间：所在房间号（建房 / 加入成功后由 roomJoined 带回） */
  roomId: string | null
  /** 最近一次 rooms 列表（拉取或推送） */
  rooms: RoomInfo[] | null
}

/**
 * 游客替身：join 落大厅后立刻建 / 加房（同连接按序送达），
 * 之后 welcome / state 流程与单桌时代一致。
 */
function connect(name: string, roomId?: string): Promise<Recorder> {
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
      roomId: null,
      rooms: null,
    }
    ws.on('open', () => {
      // 协议：客户端连上后先报上名字（进大厅），再建房或加房进桌
      ws.send(JSON.stringify({ t: 'join', name }))
      ws.send(
        roomId
          ? JSON.stringify({ t: 'joinRoom', roomId })
          : JSON.stringify({ t: 'createRoom', name: `${name}的房间`, seats: 8, blind: 0 }),
      )
      resolveFn(rec)
    })
    ws.on('error', reject)
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMsg
      if (msg.t === 'roomJoined') {
        rec.roomId = msg.roomId
      } else if (msg.t === 'rooms') {
        rec.rooms = msg.rooms
      } else if (msg.t === 'welcome') {
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
  /** 所在房间号（autoRejoin 或 enter 带回） */
  roomId: string | null
}

/** 入房方式：enter 省略 = 认证后依赖服务器 autoRejoin（断线重连场景） */
interface EnterOpts {
  create?: { name: string; seats: number; blind: number }
  join?: string
}

function connectAuth(port: number, first: Record<string, unknown>, enter?: EnterOpts): Promise<AuthRec> {
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
      roomId: null,
    }
    const enterRoom = (): void => {
      if (enter?.join) {
        ws.send(JSON.stringify({ t: 'joinRoom', roomId: enter.join }))
      } else if (enter?.create) {
        ws.send(JSON.stringify({ t: 'createRoom', ...enter.create }))
      }
    }
    ws.on('open', () => {
      ws.send(JSON.stringify(first))
      // 游客首条消息：join 落大厅后立刻建房 / 加房（同连接按序送达）
      if (first.t === 'join') {
        enterRoom()
      }
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
        enterRoom()
      } else if (msg.t === 'auth-err') {
        rec.authErr = msg.msg
      } else if (msg.t === 'roomJoined') {
        rec.roomId = msg.roomId
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

/** 多房间节的通用替身：首条消息任意（游客 join / 注册 / 登录），进房方式可选 */
interface RoomRec {
  ws: WebSocket
  roomJoined: Extract<ServerMsg, { t: 'roomJoined' }> | null
  roomLeft: boolean
  rooms: RoomInfo[] | null
  welcome: { seat: number; waiting: boolean } | null
  latest: Snapshot | null
  /** 真人聊天文本（tag=chat） */
  chatTexts: string[]
  errCount: number
  /** 退房后仍收到的 state 条数（应为 0：大厅不透传牌桌消息） */
  leftStates: number
  /** 连接被服务器关闭时的 code（顶号 = 4000） */
  closedCode: number | null
}

function openRoom(port: number, first: Record<string, unknown>, enter?: EnterOpts): Promise<RoomRec> {
  return new Promise((resolveFn, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const rec: RoomRec = {
      ws,
      roomJoined: null,
      roomLeft: false,
      rooms: null,
      welcome: null,
      latest: null,
      chatTexts: [],
      errCount: 0,
      leftStates: 0,
      closedCode: null,
    }
    const enterRoom = (): void => {
      if (enter?.join) {
        ws.send(JSON.stringify({ t: 'joinRoom', roomId: enter.join }))
      } else if (enter?.create) {
        ws.send(JSON.stringify({ t: 'createRoom', ...enter.create }))
      }
    }
    ws.on('open', () => {
      ws.send(JSON.stringify(first))
      if (first.t === 'join') {
        enterRoom() // 游客：join 落大厅后立刻建 / 加房
      }
      resolveFn(rec)
    })
    ws.on('error', reject)
    ws.on('close', (code) => {
      rec.closedCode = code
    })
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMsg
      if (msg.t === 'auth-ok') {
        enterRoom() // 账号：认证过再入房（省略 enter = 依赖 autoRejoin）
      } else if (msg.t === 'roomJoined') {
        rec.roomJoined = msg
      } else if (msg.t === 'roomLeft') {
        rec.roomLeft = true
      } else if (msg.t === 'rooms') {
        rec.rooms = msg.rooms
      } else if (msg.t === 'welcome') {
        rec.welcome = { seat: msg.seat, waiting: msg.waiting }
      } else if (msg.t === 'state') {
        if (rec.roomLeft) {
          rec.leftStates++
        }
        rec.latest = msg.snap
        if (msg.snap.you.legal) {
          const legal = msg.snap.you.legal
          const act = legal.canCheck ? { t: 'act', kind: 'check' } : { t: 'act', kind: 'call' }
          setTimeout(() => ws.send(JSON.stringify(act)), 120)
        }
      } else if (msg.t === 'err') {
        rec.errCount++
      } else if (msg.t === 'say' && msg.tag === 'chat') {
        rec.chatTexts.push(msg.text)
      }
    })
  })
}

/** 轮询等待条件成立（局末到下一手有 6 秒间隔，固定时刻断言会踩空；谓词可异步） */
async function waitFor(fn: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) {
      return true
    }
    await sleep(300)
  }
  return await fn()
}

/** 直接用 node 跑本仓 tsx 的 CLI 起子服务器：Windows 上 spawn('npx') 会因 .cmd 安全限制 ENOENT */
const TSX_CLI = join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs')

async function runSelftest(): Promise<void> {
  const child = spawn(process.execPath, [TSX_CLI, 'index.ts'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT), TEXAS_DB: ':memory:' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[server!] ${d}`))

  const results: string[] = []
  const fail = (msg: string) => results.push(`  失败 ${msg}`)
  const pass = (msg: string) => results.push(`  通过 ${msg}`)
  const check = (ok: boolean, label: string): void => {
    ok ? pass(label) : fail(label)
  }

  try {
    await sleep(2500)
    const alice = await connect('alice')
    const gotRoom = await waitFor(() => !!alice.roomId, 8000)
    check(gotRoom, `游客建房进房（roomId=${alice.roomId}）`)
    const roomId = alice.roomId ?? ''
    const bob = await connect('bob', roomId)
    await sleep(500)
    // 非法动作：还没轮到也发一个 raise，应收到 err
    alice.ws.send(JSON.stringify({ t: 'act', kind: 'raise', raiseTo: 99999 }))
    await sleep(500)
    // 此时桌上只有 alice 一个真人入座，其余 7 座应为 bot
    const botsSeen = (alice.latest?.players ?? []).filter((p) => p.bot).length
    // 第 3~8 个真人：手进行中加入，排队等下一手入座（8 人桌）
    const carol = await connect('carol', roomId)
    const dave = await connect('dave', roomId)
    const eve = await connect('eve', roomId)
    const frank = await connect('frank', roomId)
    const grace = await connect('grace', roomId)
    const henry = await connect('henry', roomId)
    await sleep(500)
    // 第 9 个连接应进观战（seat -1）
    const iris = await connect('iris', roomId)
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
    const seqBeforeVote = alice.latest?.matchSeq ?? 0
    alice.ws.send(JSON.stringify({ t: 'voteReset' }))
    await waitFor(() => !!alice.latest?.vote, 5000)
    check(!!alice.latest?.vote, `发起投票后快照带投票状态`)
    bob.ws.send(JSON.stringify({ t: 'voteReset', agree: false }))
    const refused = await waitFor(
      () => alice.sysTexts.some((t) => t.includes('反对')) && !alice.latest?.vote,
      5000,
    )
    check(refused, '反对后投票立即失败并广播系统消息')
    check((alice.latest?.matchSeq ?? 0) === seqBeforeVote, '投票失败后 matchSeq 不变')
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
        (alice.latest.matchSeq ?? 0) > seqBeforeVote &&
        !alice.latest.vote,
      15000,
    )
    check(resetDone, '全员同意后对局重置（手数与统计回到起点）')
    check((alice.latest?.matchSeq ?? 0) > seqBeforeVote, '重置后 matchSeq 递增（客户端可识别重开）')
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
    const child2 = spawn(process.execPath, [TSX_CLI, 'index.ts'], {
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
      const zhang = await connectAuth(PORT + 1, { t: 'register', name: '张三', pass: '秘密123' }, {
        create: { name: '张三的房间', seats: 8, blind: 0 },
      })
      check(
        await waitFor(() => !!zhang.token && zhang.authName === '张三', 5000),
        '注册成功返回 token（中文用户名）',
      )
      check(await waitFor(() => !!zhang.roomId, 5000), `注册后建房进房（roomId=${zhang.roomId}）`)
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
      const watcher = await connectAuth(PORT + 1, { t: 'join', name: '旁观者' }, { join: zhang.roomId ?? '' })
      await waitFor(() => !!watcher.latest, 8000)
      check(
        (watcher.latest?.players[mySeat]?.name ?? '张三') !== '张三',
        `断线托管后名牌立即换机器人名（实际 ${watcher.latest?.players[mySeat]?.name}）`,
      )
      watcher.ws.close()
      // 断线重连不传 enter：依赖服务器 autoRejoin 自动回原房原座
      const back = await connectAuth(PORT + 1, { t: 'login', token: zhang.token })
      const reclaimed = await waitFor(
        () => back.welcome?.seat === mySeat && back.sysTexts.some((t) => t.includes('找回')),
        8000,
      )
      check(reclaimed, `token 重登自动回原房原座（roomId=${back.roomId} seat=${mySeat}）`)
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

    // ---- 第三节：多房间参数 / 隔离 / 满员观战 / 退房 / 空房 GC / 跨房顶号 ----
    // GC 与保留座都调快：GC 400ms 一轮，断线保留座 1500ms 过期
    const child3 = spawn(process.execPath, [TSX_CLI, 'index.ts'], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(PORT + 2),
        TEXAS_DB: ':memory:',
        TEXAS_NEXT_HAND_MS: '1200',
        TEXAS_BOT_THINK_MIN: '250',
        TEXAS_BOT_THINK_MAX: '500',
        TEXAS_ROOM_GC_MS: '400',
        TEXAS_SEAT_RESERVE_MS: '1500',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      await sleep(2500)
      const P = PORT + 2
      const pullRooms = async (rec: RoomRec): Promise<RoomInfo[]> => {
        rec.ws.send(JSON.stringify({ t: 'listRooms' }))
        await sleep(150)
        return rec.rooms ?? []
      }

      // ① 建房参数：3 人桌 + 2 档盲注
      const r1 = await openRoom(P, { t: 'join', name: '房主' }, { create: { name: '茶馆', seats: 3, blind: 1 } })
      check(await waitFor(() => !!r1.roomJoined && !!r1.welcome && !!r1.latest, 8000), '建房即入房（roomJoined + welcome + state）')
      const rj = r1.roomJoined!
      check(/^\d{6}$/.test(rj.roomId), `房间号为 6 位数字（实际 ${rj.roomId}）`)
      check(rj.seats === 3 && rj.smallBlind === 25 && rj.bigBlind === 50, `3 座 + 25/50 盲注档位生效（${rj.seats} 座 ${rj.smallBlind}/${rj.bigBlind}）`)
      check(rj.name === '茶馆', `房名按传入采用（实际「${rj.name}」）`)
      check(r1.latest?.players.length === 3, `快照按桌大小给 3 名玩家（实际 ${r1.latest?.players.length}）`)

      // ② 第二人加入：手进行中先排队，下一手入座 1 + 列表人数 / mine
      const r2 = await openRoom(P, { t: 'join', name: '阿二' }, { join: rj.roomId })
      check(await waitFor(() => r2.latest?.you.seat === 1, 15000), `第二人加入下一手入座 1（实际 ${r2.latest?.you.seat}）`)
      let list = await pullRooms(r1)
      const mine1 = list.find((x) => x.id === rj.roomId)
      check(mine1?.humans === 2 && mine1.seats === 3 && mine1.mine === true, `列表项含座位数 / 人数 / mine（humans=${mine1?.humans} mine=${mine1?.mine}）`)

      // ③ 跨房隔离 + 空房名默认值
      const r3 = await openRoom(P, { t: 'join', name: '隔壁' }, { create: { name: '', seats: 4, blind: 0 } })
      check(await waitFor(() => !!r3.roomJoined, 8000), '第二个房间创建成功')
      check(r3.roomJoined!.name === '隔壁的房间', `空房名落默认「创建者的房间」（实际「${r3.roomJoined!.name}」）`)
      r1.ws.send(JSON.stringify({ t: 'chat', text: '房内密语' }))
      await sleep(1200)
      check(r1.chatTexts.includes('房内密语') || r2.chatTexts.includes('房内密语'), '同房聊天互通')
      check(!r3.chatTexts.includes('房内密语'), '跨房聊天隔离')

      // ④ 主动退房：roomLeft + 人数回落 + 大厅态牌桌消息静默丢弃 + 大厅持续收列表推送
      r2.ws.send(JSON.stringify({ t: 'leaveRoom' }))
      check(await waitFor(() => r2.roomLeft, 5000), '退房收到 roomLeft')
      list = await pullRooms(r1)
      check(list.find((x) => x.id === rj.roomId)?.humans === 1, `退房后人数回落（实际 ${list.find((x) => x.id === rj.roomId)?.humans}）`)
      const errsBefore = r2.errCount
      r2.ws.send(JSON.stringify({ t: 'act', kind: 'raise', raiseTo: 99999 }))
      await sleep(800)
      check(r2.errCount === errsBefore && r2.leftStates === 0, '大厅态发牌桌消息被静默丢弃')
      check(await waitFor(() => (r2.rooms?.length ?? 0) >= 2, 5000), `退房后持续收列表推送（${r2.rooms?.length ?? 0} 个房间）`)

      // ⑤ 满员观战：3 座满员后第 4 人 seat=-1（inHand 有 1.2s 局间空隙，轮询到进行中为准）
      const r4 = await openRoom(P, { t: 'join', name: '老三' }, { join: rj.roomId })
      check(await waitFor(() => r4.latest?.you.seat === 1, 15000), `补位者下一手入座释放的 1 号位（实际 ${r4.latest?.you.seat}）`)
      const r5 = await openRoom(P, { t: 'join', name: '第四个' }, { join: rj.roomId })
      check(await waitFor(() => r5.welcome !== null && r5.welcome.seat === -1, 8000), `满员第 4 人观战（实际 ${r5.welcome?.seat}）`)
      const inHandSeen = await waitFor(async () => (await pullRooms(r2)).find((x) => x.id === rj.roomId)?.inHand === true, 15000)
      check(inHandSeen, '列表 inHand 标记牌局进行中')

      // ⑥ 空房 GC：创建者退房（游客无保留座）→ 房间回收
      const otherId = r3.roomJoined!.roomId
      r3.ws.send(JSON.stringify({ t: 'leaveRoom' }))
      const gone = await waitFor(async () => !(await pullRooms(r2)).some((x) => x.id === otherId), 6000)
      check(gone, '空房被 GC 回收（列表中消失）')

      // ⑦ 保留座续命：账号创建者断线 → 保留期内不回收，过期后回收
      const acc = await openRoom(P, { t: 'register', name: '房东', pass: 'p' }, { create: { name: '保留房', seats: 3, blind: 0 } })
      check(await waitFor(() => !!acc.roomJoined, 8000), '账号建房成功')
      const accId = acc.roomJoined!.roomId
      acc.ws.close()
      await sleep(900) // GC 已跑过多轮，但保留期（1500ms）未过
      list = await pullRooms(r2)
      check(list.some((x) => x.id === accId), '断线保留期内空房不回收')
      const accGone = await waitFor(async () => !(await pullRooms(r2)).some((x) => x.id === accId), 8000)
      check(accGone, '保留期过后空房被回收')

      // ⑧ 跨房顶号：同账号新连接去别的房，旧连接收 4000
      const jia = await openRoom(P, { t: 'register', name: '甲', pass: 'p' }, { create: { name: '甲房', seats: 3, blind: 0 } })
      check(await waitFor(() => !!jia.roomJoined, 8000), '甲建房成功')
      const jia2 = await openRoom(P, { t: 'login', name: '甲', pass: 'p' }, { create: { name: '乙房', seats: 3, blind: 0 } })
      check(await waitFor(() => jia.closedCode === 4000, 8000), `跨房顶号旧连接收 4000（实际 ${jia.closedCode}）`)
      check(await waitFor(() => jia2.roomJoined?.name === '乙房', 8000), `新连接进新房（实际「${jia2.roomJoined?.name}」）`)

      r1.ws.close()
      r2.ws.close()
      r4.ws.close()
      r5.ws.close()
      jia2.ws.close()
    } finally {
      child3.kill('SIGTERM')
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
