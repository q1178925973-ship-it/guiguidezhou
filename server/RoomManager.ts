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
        this.createRoom(ws, String(msg.name ?? ''), Number(msg.seats), Number(msg.blind))
        return true
      case 'joinRoom':
        this.joinRoom(ws, String(msg.roomId ?? ''))
        return true
      case 'leaveRoom': {
        const room = this.wsRoom.get(ws)
        if (room) {
          room.table.depart(ws)
          this.wsRoom.delete(ws)
          this.sendTo(ws, { t: 'roomLeft' })
          this.markDirty()
        } else {
          this.sendTo(ws, { t: 'err', msg: '当前不在房间里' })
        }
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
    }))
  }

  // ---------- 内部 ----------

  /** 创建房间并立即入房（创建即加入） */
  private createRoom(ws: WebSocket, rawName: string, seats: number, blindTier: number): void {
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
    const table = new Table(this.store, { seatCount: seats, ...tier }, () => this.markDirty())
    const room: Room = { id, name, table }
    this.rooms.set(id, room)
    this.joinRoom(ws, id)
  }

  /** 加入房间：退旧房 → 跨房顶号 → 进桌 → 回 roomJoined */
  private joinRoom(ws: WebSocket, roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      this.sendTo(ws, { t: 'err', msg: '房间不存在或已解散' })
      return
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
    room.table.join(ws, meta?.name ?? '', meta?.account ?? null)
    this.replyJoined(ws, room)
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

  /** 断线重连：账号在任一房有座位 / 保留座 → 直接回该房 */
  private autoRejoin(ws: WebSocket): boolean {
    const meta = this.wsMeta.get(ws)
    if (!meta?.account) {
      return false
    }
    for (const room of this.rooms.values()) {
      if (room.table.seatOfAccount(meta.account) >= 0) {
        this.joinRoom(ws, room.id)
        return true
      }
    }
    return false
  }

  /** 该连接视角的房间列表（带 mine：在房 / 有座位保留） */
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

  /** 回收空房：无在座真人、无任何连接、无未过期保留座（先收集后删，避免遍历时增删 Map） */
  private gc(): void {
    const doomed: Room[] = []
    for (const room of this.rooms.values()) {
      if (room.table.humans === 0 && room.table.clientCount === 0 && !room.table.hasReservations()) {
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
