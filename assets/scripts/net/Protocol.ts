import { LegalActs } from '../core/Types'

/**
 * 联机协议：客户端（Cocos web）与服务器（Node）共用的消息与快照类型。
 * 本文件不得 import cc —— 服务器直接复用。
 */

/** 一张牌的网络序列化形式（r=点数 2~14，s=花色） */
export interface CardJ {
  r: number
  s: 's' | 'h' | 'd' | 'c'
}

/** 座位玩家在快照中的投影 */
export interface PlayerSnap {
  name: string
  /** 由服务端 AI 代打（空位机器人 / 真人掉线托管） */
  bot: boolean
  /** 真人连接在线 */
  online: boolean
  chips: number
  betRound: number
  folded: boolean
  allIn: boolean
  /** 胜负局数：账号座位为数据库生涯战绩，游客 / 机器人为本局统计 */
  won: number
  played: number
  /** 底牌张数（0 或 2），他人 / 观战视角只知张数 */
  holeCount: number
  /** 你自己的底牌（仅发给本人客户端） */
  hole?: CardJ[]
  /** 局末摊牌亮出的底牌（所有客户端可见） */
  revealed?: CardJ[]
  /** 本手已主动亮牌（客户端据此收起亮牌按钮） */
  showed?: boolean
}

/** 最近一次成功动作（客户端据此播气泡 / 音效；seq 递增用于防重播） */
export interface ActJ {
  seat: number
  kind: 'fold' | 'check' | 'call' | 'raise'
  raiseTo?: number
  seq: number
}

/** 局末结算横幅数据 */
export interface AwardsSnap {
  title: string
  lines: string[]
  /** 赢家座位号（金币飞行 / 胜利光环） */
  winners: number[]
}

/** 一手牌的历史记录（局末归档，对局记录面板按需拉取；重置对局后清空） */
export interface HandRecordJ {
  handNo: number
  /** 结算标题（与局末横幅同口径，如「阿宝 赢得 240」或「主池 归 阿宝，边池 归 老K」） */
  title: string
  /** 每池明细行 */
  lines: string[]
  /** 本手实际翻出的公共牌 */
  community: CardJ[]
  /** 各赢家及其底牌（赢家视角展示：摊牌本就公开，弃牌收局做事后复盘） */
  winners: Array<{ name: string; hole: CardJ[] }>
  /** 其余拿到牌的玩家及底牌（复盘：摊牌输家 / 弃牌者的牌，事后展示无信息优势） */
  others: Array<{ name: string; hole: CardJ[] }>
}

/** 重置对局投票状态（快照内下发，客户端据此渲染投票面板） */
export interface VoteSnap {
  /** 发起者座位 */
  by: number
  /** 剩余秒数（服务器下发时刻口径，客户端本地递减） */
  leftSec: number
  /** 已显式投票的真人（未投 = 到时视为同意） */
  votes: Array<{ seat: number; agree: boolean }>
}

/** 全量视图快照：客户端只依据它渲染 */
export interface Snapshot {
  handNo: number
  /** 对局纪元号：服务器每次 resetMatch 重建引擎时 +1（handNo 会归 1，客户端据此识别「重开后的新一手」） */
  matchSeq: number
  phase: 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'over'
  dealerIndex: number
  /** 当前行动座位，-1 表示无人行动 */
  actingIndex: number
  /** 真人行动剩余秒数（60 秒超时自动过牌/跟注），仅轮到真人时下发 */
  turnLeft?: number
  pot: number
  community: CardJ[]
  players: PlayerSnap[]
  lastAct?: ActJ
  awards?: AwardsSnap
  vote?: VoteSnap
  you: {
    /** 你的座位，-1 = 观战 */
    seat: number
    /** 正在排队等下一手入座 */
    waiting: boolean
    /** 轮到你行动时附带合法动作 */
    legal?: LegalActs
  }
}

/** 大厅房间列表项 */
export interface RoomInfo {
  /** 6 位数字房间号 */
  id: string
  name: string
  /** 桌子总座位（3~8） */
  seats: number
  /** 在座真人数 */
  humans: number
  smallBlind: number
  bigBlind: number
  /** 牌局进行中（等待开局 / 两手之间 = false） */
  inHand: boolean
  /** 设了密码的房间（加入需要密码，列表行显示上锁图标） */
  locked?: boolean
  /** 我有座位或保留座的房间（服务器逐连接单播时附带） */
  mine?: boolean
}

/** 客户端发给服务器的消息 */
export type ClientMsg =
  /** 连接后的首条消息三选一：游客进大厅 */
  | { t: 'join'; name: string }
  /** 注册新账号（用户名支持中文）并登录 */
  | { t: 'register'; name: string; pass: string }
  /** 登录：账密或 token 自动续登（token 命中时 name/pass 可省） */
  | { t: 'login'; name?: string; pass?: string; token?: string }
  | { t: 'act'; kind: 'fold' | 'check' | 'call' | 'raise'; raiseTo?: number }
  | { t: 'chat'; text: string }
  /** 无 vote 进行中 = 发起重置投票；有 vote 进行中 = 投票（agree 缺省视为同意） */
  | { t: 'voteReset'; agree?: boolean }
  /** 对局中主动亮牌：底牌展示给仍在局内的玩家（一手只能亮一次，不可收回） */
  | { t: 'showCards' }
  /** 拉取当前对局的历史记录（最新在前，观战者也可看） */
  | { t: 'getHistory' }
  // ---- 多房间：登录后先进大厅，以下命令在任意态可发 ----
  /** 拉取公开房间列表（服务器也会在房间增减 / 人数变化时防抖推送） */
  | { t: 'listRooms' }
  /** 创建并立即加入新房：seats=桌子总人数 3~8；blind=底注档位索引 0~3；password 留空 = 不设密码 */
  | { t: 'createRoom'; name: string; seats: number; blind: 0 | 1 | 2 | 3; password?: string }
  /** 加入指定房间（满员自动观战；在别的房则先退房）；加密房需带 password */
  | { t: 'joinRoom'; roomId: string; password?: string }
  /** 主动退出当前房间回大厅（座位立即释放，不留保留座）。
   *  服务器判定你是房内最后一名玩家时会先回 askLeaveClose 询问，confirm=true 才真退 */
  | { t: 'leaveRoom'; confirm?: boolean }

/** 服务器发给客户端的消息 */
export type ServerMsg =
  /** 注册 / 登录成功：token 供下次自动续登，won/played 为账号生涯战绩 */
  | { t: 'auth-ok'; token: string; name: string; won: number; played: number }
  /** 注册 / 登录失败（可换凭据在同一连接上重试） */
  | { t: 'auth-err'; msg: string }
  | { t: 'welcome'; seat: number; waiting: boolean }
  | { t: 'state'; snap: Snapshot }
  | { t: 'say'; name: string; text: string; seat?: number; tag: 'ai' | 'chat' | 'sys' }
  | { t: 'err'; msg: string }
  /** 对 getHistory 的应答：当前对局已归档的历史手牌（最新在前） */
  | { t: 'history'; hands: HandRecordJ[] }
  // ---- 多房间 ----
  /** 公开房间列表（防抖推送，仅发大厅态连接；mine 逐连接计算） */
  | { t: 'rooms'; rooms: RoomInfo[] }
  /** 进房成功（建房 / joinRoom / 断线重连自动回归都会发） */
  | { t: 'roomJoined'; roomId: string; name: string; seats: number; smallBlind: number; bigBlind: number }
  /** 加入加密房间但未带密码：客户端弹密码框后带密码重发 joinRoom */
  | { t: 'roomNeedPass'; roomId: string }
  /** 你是房内最后一名玩家，退房将关闭房间：客户端弹确认后发 leaveRoom{confirm:true} */
  | { t: 'askLeaveClose'; roomId: string }
  /** 退房成功，已回大厅 */
  | { t: 'roomLeft' }
