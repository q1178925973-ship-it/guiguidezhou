import { WebSocket } from 'ws'
import { AccountStore } from './AccountStore'
import { Table } from './Table'
import { ClientMsg, RoomInfo, ServerMsg } from '../assets/scripts/net/Protocol'

/**
 * 多房间管理：认证通过的连接先进大厅（不在任何房），
 * createRoom / joinRoom 入房，leaveRoom 回大厅；
 * 房间信息变化经 300ms 防抖逐连接单播给大厅态连接；
 * 无人、无连接、无未过期保留座的房间由 GC 定时回收。
 */

export interface Room {
  id: string
  name: string
  table: Table
  /** 房间密码（'' = 不加密）。创建者本人、断线重连 autoRejoin 不再校验 */
  password: string
  /** 首次变为可回收（无人无连接无保留座）的时刻；0 = 当前不可回收。空置满一个 GC 周期才删，保证退房后有稳定的重进窗口 */
  emptySince: number
}

/** 已认证连接的登录身份（attach 时登记，建房默认名 / 跨房顶号 / mine 标记用） */
interface WsMeta {
  name: string
  account: string | null
}

/** 房间数上限（防刷） */
const MAX_ROOMS = 32
/** rooms 列表推送防抖（毫秒）：建房 / 退房 / 人数变化合并成一次推 */
const PUSH_DEBOUNCE = 300
/** 空房 GC 周期（毫秒），自检可调快 */
const ROOM_GC_MS = Number(process.env.TEXAS_ROOM_GC_MS ?? 60000)
/** 底注档位表（客户端传索引 0~3） */
const BLIND_TIERS = [
  { smallBlind: 10, bigBlind: 20 },
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 100, bigBlind: 200 },
]

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  /** 连接当前所在房间（不在 Map = 大厅态） */
  private readonly wsRoom = new Map<WebSocket, Room>()
  private readonly wsMeta = new Map<WebSocket, WsMeta>()
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly gcTimer: ReturnType<typeof setInterval>

  constructor(private readonly store: AccountStore) {
    this.gcTimer = setInterval(() => this.gc(), ROOM_GC_MS)
  }

  /** 认证通过：登记身份进大厅；账号在任一房有座位 / 保留座则自动回房（断线重连） */
  attach(ws: WebSocket, name: string, account: string | null): void {
    this.wsMeta.set(ws, { name, account })
    if (!this.autoRejoin(ws)) {
      this.sendTo(ws, { t: 'rooms', rooms: this.roomInfos(ws) })
    }
  }

  /** 房间命令：已消费返回 true，否则交还调用方透传给牌桌 */
  handleCommand(ws: WebSocket, msg: ClientMsg): boolean {
    switch (msg.t) {
      case 'listRooms':
        this.sendTo(ws, { t: 'rooms', rooms: this.roomInfos(ws) })
        return true
      case 'createRoom':
        this.createRoom(ws, String(msg.name ?? ''), Number(msg.seats), Number(msg.blind), String(msg.password ?? ''))
        return true
      case 'joinRoom':
        this.joinRoom(ws, String(msg.roomId ?? ''), typeof msg.password === 'string' ? msg.password : undefined)
        return true
      case 'leaveRoom': {
        const room = this.wsRoom.get(ws)
        if (!room) {
          this.sendTo(ws, { t: 'err', msg: '当前不在房间里' })
          return true
        }
        // 最后一名玩家退房：先问一次（客户端弹确认），confirm 才真退
        const closeAfter = room.table.wouldBeEmptyAfter(ws)
        if (closeAfter && msg.confirm !== true) {
          this.sendTo(ws, { t: 'askLeaveClose', roomId: room.id })
          return true
        }
        room.table.depart(ws)
        this.wsRoom.delete(ws)
        this.sendTo(ws, { t: 'roomLeft' })
        if (closeAfter) {
          // 房随人走：无人无连接无保留座，立即销毁（GC 只兜底连接异常断开的残留）
          room.table.dispose()
          this.rooms.delete(room.id)
        }
        this.markDirty()
        return true
      }
      default:
        return false
    }
  }

  /** 牌桌内消息透传（大厅态静默丢弃） */
  forward(ws: WebSocket, msg: ClientMsg): void {
    const room = this.wsRoom.get(ws)
    if (room) {
      room.table.onMessage(ws, msg)
    }
  }

  /** 连接关闭：清理映射，在房则按断线口径离桌（账号座位保留 + AI 托管） */
  handleClose(ws: WebSocket): void {
    const room = this.wsRoom.get(ws)
    this.wsMeta.delete(ws)
    this.wsRoom.delete(ws)
    if (room) {
      room.table.leave(ws)
      this.markDirty()
    }
  }

  /** 当前公开房间列表（mine 按连接计算：在房 / 有座位保留） */
  listRooms(): RoomInfo[] {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      seats: r.table.seats,
      humans: r.table.humans,
      smallBlind: r.table.smallBlind,
      bigBlind: r.table.bigBlind,
      inHand: r.table.inHand,
      locked: r.password !== '',
    }))
  }

  // ---------- 内部 ----------

  /** 创建房间并立即入房（创建即加入；创建者本人不再过密码门） */
  private createRoom(ws: WebSocket, rawName: string, seats: number, blindTier: number, rawPass: string): void {
    if (this.rooms.size >= MAX_ROOMS) {
      this.sendTo(ws, { t: 'err', msg: '房间太多，稍后再试' })
      return
    }
    const meta = this.wsMeta.get(ws)
    if (!meta) {
      return
    }
    let id = ''
    do {
      id = String(100000 + Math.floor(Math.random() * 900000))
    } while (this.rooms.has(id))
    const tierRaw = Math.floor(Number.isFinite(blindTier) ? blindTier : 0)
    const tier = BLIND_TIERS[Math.max(0, Math.min(BLIND_TIERS.length - 1, tierRaw))]
    const name = sanitizeRoomName(rawName) || `${sanitizePlayerName(meta.name)}的房间`
    const password = String(rawPass ?? '').replace(/\s+/g, '').slice(0, 12)
    const table = new Table(this.store, { seatCount: seats, ...tier }, () => this.markDirty())
    const room: Room = { id, name, table, password, emptySince: 0 }
    this.rooms.set(id, room)
    this.joinRoom(ws, id, undefined, true)
  }

  /** 加入房间：密码门 → 退旧房 → 跨房顶号 → 进桌 → 回 roomJoined */
  private joinRoom(ws: WebSocket, roomId: string, password?: string, skipPassCheck = false): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      this.sendTo(ws, { t: 'err', msg: '房间不存在或已解散' })
      return
    }
    if (!skipPassCheck && room.password) {
      const given = password ?? ''
      if (!given) {
        this.sendTo(ws, { t: 'roomNeedPass', roomId })
        return
      }
      if (given !== room.password) {
        this.sendTo(ws, { t: 'err', msg: '房间密码错误' })
        return
      }
    }
    const cur = this.wsRoom.get(ws)
    if (cur === room) {
      // 重复加入同一房：只补发确认，不重复进桌
      this.replyJoined(ws, room)
      return
    }
    if (cur) {
      // 先退当前房（主动退房口径：座位立即释放）
      cur.table.depart(ws)
      this.wsRoom.delete(ws)
    }
    // 同账号在其他房的在线连接一律顶掉（跨房顶号，旧连接收 4000）
    const meta = this.wsMeta.get(ws)
    if (meta?.account) {
      for (const [w, r] of this.wsRoom) {
        if (r !== room && this.wsMeta.get(w)?.account === meta.account) {
          r.table.evictAccount(meta.account)
          this.wsRoom.delete(w)
        }
      }
    }
    this.wsRoom.set(ws, room)
    // 先回 roomJoined 再 table.join：join 内部会 broadcastState，若抢在回执前到达，
    // 客户端还处在大厅态会把首包 state 丢掉——牌局挂起（等某人行动）时再无后续
    // state 补发，进房者整局只能看到空桌（v26.6 修复）
    this.replyJoined(ws, room)
    room.table.join(ws, meta?.name ?? '', meta?.account ?? null)
    this.markDirty()
  }

  private replyJoined(ws: WebSocket, room: Room): void {
    this.sendTo(ws, {
      t: 'roomJoined',
      roomId: room.id,
      name: room.name,
      seats: room.table.seats,
      smallBlind: room.table.smallBlind,
      bigBlind: room.table.bigBlind,
    })
  }

  /** 断线重连：账号在任一房有座位 / 保留座 → 直接回该房（有座位即证明此前进过，不再过密码门） */
  private autoRejoin(ws: WebSocket): boolean {
    const meta = this.wsMeta.get(ws)
    if (!meta?.account) {
      return false
    }
    for (const room of this.rooms.values()) {
      if (room.table.seatOfAccount(meta.account) >= 0) {
        this.joinRoom(ws, room.id, undefined, true)
        return true
      }
    }
    return false
  }

  /** 该连接视角的房间列表（带 mine：在房 / 有座位保留；locked：设了密码） */
  private roomInfos(ws: WebSocket): RoomInfo[] {
    const meta = this.wsMeta.get(ws)
    const cur = this.wsRoom.get(ws)
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      seats: r.table.seats,
      humans: r.table.humans,
      smallBlind: r.table.smallBlind,
      bigBlind: r.table.bigBlind,
      inHand: r.table.inHand,
      locked: r.password !== '',
      mine: cur === r || (meta?.account ? r.table.seatOfAccount(meta.account) >= 0 : false),
    }))
  }

  /** 房间信息变化：防抖合并后逐连接单播（大厅态才收） */
  private markDirty(): void {
    if (this.pushTimer) {
      return
    }
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      for (const ws of this.wsMeta.keys()) {
        if (this.wsRoom.has(ws)) {
          continue
        }
        this.sendTo(ws, { t: 'rooms', rooms: this.roomInfos(ws) })
      }
    }, PUSH_DEBOUNCE)
  }

  /** 回收空房：无在座真人、无任何连接、无未过期保留座，且空置已满一个 GC 周期（先收集后删，避免遍历时增删 Map） */
  private gc(): void {
    const now = Date.now()
    const doomed: Room[] = []
    for (const room of this.rooms.values()) {
      const collectible = room.table.humans === 0 && room.table.clientCount === 0 && !room.table.hasReservations()
      if (!collectible) {
        room.emptySince = 0
        continue
      }
      // 首次发现只记时刻，满一个周期再删：退房后的房间不会在任意秒数后突然从列表消失
      if (room.emptySince === 0) {
        room.emptySince = now
      } else if (now - room.emptySince >= ROOM_GC_MS) {
        doomed.push(room)
      }
    }
    if (doomed.length === 0) {
      return
    }
    for (const room of doomed) {
      room.table.dispose()
      this.rooms.delete(room.id)
    }
    this.markDirty()
  }

  /** 测试收尾用：停掉定时器 */
  dispose(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
    }
    clearInterval(this.gcTimer)
    for (const room of this.rooms.values()) {
      room.table.dispose()
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }
}

/** 房名清洗：去空白限 12 字，空串返回 ''（调用方给默认名） */
function sanitizeRoomName(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 12)
}

/** 玩家名清洗（建房默认名用）：与 Table 的 sanitizeName 同口径 */
function sanitizePlayerName(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 8)
}
