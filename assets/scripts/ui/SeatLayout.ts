import { Vec3 } from 'cc'
import { Player } from '../core/Player'
import { Act, ActKind, Phase } from '../core/Types'

/** 座位布局：0 号位是玩家（下方），其余为 AI。dealer 为庄家钮相对下注点的偏移 */
export interface SeatLayoutEntry {
  pos: Vec3
  bet: Vec3
  dealer?: Vec3
  faceUp: boolean
}

/**
 * 座位坐标由最终效果图（1280×720）像素测量换算（px 中心 = 像素坐标 − (640,360)）：
 * pos = 两牌槽中点（横幅由素材几何自动落在牌左侧，不再单独配置）；
 * bet = 下注筹码堆相对座位的偏移：紧贴自己横幅的桌面侧（18~30 cocos 内），
 * 让筹码堆一眼归属到下注者，不再散在桌面中环与公共牌 / 底池混在一起。
 */

/** 四人桌布局（单机模式用）：左（莉莉位）/ 顶（大乔位）/ 右（老K位）取效果图锚点。
 * 0 号位（自己）X 取 74 = 实测 +30：名牌挂在牌左侧，锚点 44 时整组视觉偏左不居中 */
export const SEAT_LAYOUT: SeatLayoutEntry[] = [
  { pos: new Vec3(74, -130, 0), bet: new Vec3(0, 75, 0), faceUp: true },
  { pos: new Vec3(-397, 82, 0), bet: new Vec3(97, 0, 0), faceUp: false },
  { pos: new Vec3(80, 263, 0), bet: new Vec3(0, -68, 0), faceUp: false },
  { pos: new Vec3(574, 82, 0), bet: new Vec3(-276, 0, 0), faceUp: false },
]

/**
 * 八人桌布局（联机模式用，自己永远旋转到 0 号下方位）。
 * 各座位对应效果图：1 阿宝右下 / 2 老K右中 / 3 胖虎右上 / 4 大乔顶 /
 * 5 石头左上 / 6 莉莉左中 / 7 教授左下。
 */
export const SEAT_LAYOUT_8: SeatLayoutEntry[] = [
  { pos: new Vec3(74, -130, 0), bet: new Vec3(0, 75, 0), faceUp: true },
  { pos: new Vec3(448, -43, 0), bet: new Vec3(0, -68, 0), faceUp: false },
  { pos: new Vec3(574, 82, 0), bet: new Vec3(-276, 0, 0), faceUp: false },
  { pos: new Vec3(425, 212, 0), bet: new Vec3(-235, -67, 0), faceUp: false },
  { pos: new Vec3(80, 263, 0), bet: new Vec3(0, -68, 0), faceUp: false },
  { pos: new Vec3(-274, 217, 0), bet: new Vec3(79, -72, 0), faceUp: false },
  { pos: new Vec3(-397, 82, 0), bet: new Vec3(97, 0, 0), faceUp: false },
  { pos: new Vec3(-280, -43, 0), bet: new Vec3(-30, 62, 0), faceUp: false },
]

/** 阶段显示名 */
export const PHASE_NAMES: Partial<Record<Phase, string>> = {
  [Phase.Preflop]: '翻牌前',
  [Phase.Flop]: '翻牌',
  [Phase.Turn]: '转牌',
  [Phase.River]: '河牌',
}

/**
 * 按桌大小给布局：4/8 人用实测表，其余（3/5/6/7）用椭圆拟合。
 * 椭圆参数取自 8 人表 8 锚点的拟合：中心 (81,80)、rx 494、ry 195；
 * 座位 i 角度 θ = -90° + i·360°/n（0 号位在正下方，随 n 增大逆时针铺开），
 * 0 号位仍钉在实测 (74,-130)（与 4/8 人表一致，自己永远在下方）。
 * 下注点 = 座位指向桌心方向 70（首版统一模长，实测表是 68~75 一带）。
 */
export function seatLayoutFor(n: number): SeatLayoutEntry[] {
  if (n === 8) {
    return SEAT_LAYOUT_8
  }
  if (n === 4) {
    return SEAT_LAYOUT
  }
  const count = Math.max(3, Math.min(8, Math.round(n)))
  const cx = 81
  const cy = 80
  const rx = 494
  const ry = 195
  const list: SeatLayoutEntry[] = []
  for (let i = 0; i < count; i++) {
    const th = (-90 + (i * 360) / count) * (Math.PI / 180)
    const pos =
      i === 0
        ? new Vec3(74, -130, 0)
        : new Vec3(Math.round(cx + rx * Math.cos(th)), Math.round(cy + ry * Math.sin(th)), 0)
    // 下注方向：座位 → 桌心，统一模长 70
    const dx = cx - pos.x
    const dy = cy - pos.y
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy))
    list.push({
      pos,
      bet: new Vec3(Math.round((dx / len) * 70), Math.round((dy / len) * 70), 0),
      faceUp: i === 0,
    })
  }
  return list
}

/** 动作文案（座位气泡显示）；betRound 为该玩家本轮总投入（跟注口径），chips 用于判定全下 */
export function describeAct(
  kind: 'fold' | 'check' | 'call' | 'raise',
  raiseTo: number | undefined,
  betRound: number,
  chipsAfter: number,
): string {
  switch (kind) {
    case 'fold':
      return '弃牌'
    case 'check':
      return '过牌'
    case 'call':
      return chipsAfter <= 0 ? '全下跟注' : `跟注 ${betRound}`
    case 'raise':
      return chipsAfter <= 0 ? '全下' : `加注到 ${raiseTo}`
    default:
      return ''
  }
}

/** 单机版便捷封装：直接从引擎动作与 Player 取口径 */
export function describeActOf(act: Act, p: Player): string {
  return describeAct(act.kind as 'fold' | 'check' | 'call' | 'raise', act.raiseTo, p.betRound, p.chips)
}
