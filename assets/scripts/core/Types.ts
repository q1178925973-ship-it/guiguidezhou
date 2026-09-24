import { Player } from './Player'

/** 牌局阶段 */
export enum Phase {
  Idle = 0,
  Preflop,
  Flop,
  Turn,
  River,
  Showdown,
  HandOver,
}

/** 动作类型 */
export enum ActKind {
  Fold = 'fold',
  Check = 'check',
  Call = 'call',
  Raise = 'raise',
}

/** 一次行动；Raise 时 raiseTo 表示「加注到」（该玩家本轮总投入目标） */
export interface Act {
  kind: ActKind
  raiseTo?: number
}

/** 某玩家当前可执行的操作，UI 依据它生成按钮 */
export interface LegalActs {
  canFold: boolean
  canCheck: boolean
  callAmount: number
  canRaise: boolean
  /** 主动全下（梭哈）是否可用：翻牌前三张公共牌未发时为 false（被动跟注全下不受限） */
  canAllIn: boolean
  raiseMinTo: number
  raiseMaxTo: number
}

/** 单个池（主池/边池）的分配结果 */
export interface PotAward {
  potNo: number
  amount: number
  winners: Player[]
  reason: 'fold' | 'showdown'
  /** 展示用描述，如「主池 300」 */
  desc: string
  /** 摊牌时赢家的牌型描述 */
  handDesc?: string
}

/** 引擎事件：UI 监听这些时机刷新界面 / 播放动画 */
export type GameEvent =
  | 'hand-start'
  | 'blinds'
  | 'deal-hole'
  | 'street'
  | 'act'
  | 'turn'
  | 'showdown'
  | 'hand-end'

/** 牌局配置 */
export interface EngineConfig {
  startChips: number
  smallBlind: number
  bigBlind: number
}
