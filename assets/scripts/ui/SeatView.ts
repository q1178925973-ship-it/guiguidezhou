import { Label, Node, Tween, tween, UIOpacity, Vec3 } from 'cc'
import { Card } from '../core/Card'
import { Player } from '../core/Player'
import { CardView } from './CardView'
import { ChipStackView } from './ChipView'
import { SeatPlate } from './SeatPlate'
import { createLabel, createNode, THEME, withOutline } from './Theme'

export interface SeatOptions {
  /** 座位在根节点下的位置（即两牌槽中点，横幅由素材几何自动偏移到牌左侧） */
  pos: Vec3
  /** 下注额显示相对座位的偏移（朝桌面中心方向，避开横幅与底牌） */
  betOffset: Vec3
  /** 乌龟头像壳色下标（缺省 0） */
  colorIndex?: number
  /** 底牌是否亮面（玩家自己） */
  faceUp: boolean
}

/**
 * 一个座位：手牌、玩家卡片（SeatPlate：乌龟头像 + 名字 / 筹码 / 提示 / 统计）、
 * 本轮下注、动作气泡、行动高亮与胜利特效。
 */
export class SeatView {
  readonly node: Node
  private readonly opts: SeatOptions
  private readonly plate: SeatPlate
  private readonly cardsHost: Node
  private readonly cardsOpacity: UIOpacity
  private lastBet = 0
  private readonly betNode: Node
  private readonly betChips: ChipStackView
  private readonly bubbleLabel: Label
  private readonly bubbleOpacity: UIOpacity
  private cardViews: CardView[] = []

  constructor(parent: Node, name: string, opts: SeatOptions) {
    this.opts = opts
    this.node = createNode(`seat-${name}`, parent)
    this.node.setPosition(opts.pos)

    this.plate = new SeatPlate(this.node, opts.faceUp, name, opts.colorIndex ?? 0)
    this.plate.node.setPosition(this.plate.plateOffset)

    this.cardsHost = createNode('cards', this.node)
    this.cardsOpacity = this.cardsHost.addComponent(UIOpacity)

    this.betNode = createNode('bet', this.node)
    this.betNode.setPosition(opts.betOffset)
    // 金额药丸放在背离横幅的一侧（下注点本就贴着横幅，避免药丸压住横幅 / 头像）
    const away = new Vec3(opts.betOffset).subtract(this.plate.node.position)
    this.betChips = new ChipStackView(this.betNode, 11, true, away.x >= 0 ? 1 : -1)
    this.betNode.active = false

    // 气泡挂在横幅正下方（横幅左置，牌槽在横幅右端）
    this.bubbleLabel = withOutline(createLabel(this.node, '', 19, THEME.textBright, true))
    this.bubbleLabel.node.setPosition(
      this.plate.plateOffset.x,
      this.plate.plateOffset.y - this.plate.plateH / 2 - 18,
    )
    this.bubbleOpacity = this.bubbleLabel.node.addComponent(UIOpacity)
    this.bubbleOpacity.opacity = 0
  }

  /** 新一手：清空手牌与所有临时显示 */
  clearHand(): void {
    this.cardViews = []
    this.cardsHost.removeAllChildren()
    this.cardsOpacity.opacity = 255
    this.betNode.active = false
    this.lastBet = 0
    this.bubbleOpacity.opacity = 0
    Tween.stopAllByTarget(this.node)
    this.node.setScale(1, 1, 1)
    this.setActing(false)
    this.setBlindTag(null)
  }

  /** 发两张底牌（from 为牌堆在根节点下的位置），牌直接落进横幅图内的两个牌槽 */
  dealCards(cards: Card[], from: Vec3, baseDelay = 0, faceUp = this.opts.faceUp): void {
    const localFrom = from.clone().subtract(this.node.position)
    const cw = Math.round(this.plate.slotW) - 1
    const ch = Math.round(this.plate.slotH) - 1
    cards.forEach((card, i) => {
      const view = new CardView(this.cardsHost, cw, ch)
      const slot = this.plate.slotLocal[Math.min(i, 1)]
      view.node.setPosition(slot.x, slot.y)
      view.setCard(card)
      this.cardViews.push(view)
      const delay = baseDelay + i * 0.18
      view.dealFrom(localFrom, delay)
      if (faceUp) {
        view.flip(delay + 0.32)
      }
    })
  }

  /** 横幅上缘中点（座位坐标系）：联机模式的行动计时胶囊挂在这里 */
  plateTopCenter(): Vec3 {
    return new Vec3(this.plate.plateOffset.x, this.plate.plateOffset.y + this.plate.plateH / 2, 0)
  }

  /** 依次翻亮底牌（已翻开的不重复播放动画） */
  revealCards(): void {
    this.cardViews.forEach((view, i) => {
      if (!view.isFaceUp) {
        view.flip(i * 0.15)
      }
    })
  }

  /** 替换底牌内容（联机局末亮牌：把牌背换成真实牌面），不重播发牌动画 */
  setHoleCards(cards: Card[]): void {
    this.cardViews.forEach((view, i) => {
      if (cards[i]) {
        view.setCard(cards[i])
      }
    })
  }

  /** 按引擎状态刷新筹码 / 下注 / 统计 / 弃牌置灰 */
  refresh(player: Player): void {
    this.plate.refresh(player)
    this.betNode.active = player.betRound > 0
    if (player.betRound > 0) {
      const grew = player.betRound > this.lastBet
      this.lastBet = player.betRound
      // 下注时筹码从玩家卡片方向「推」到下注区（起点 = 卡片位置换算到下注区坐标系）
      const s = this.plate.node.position
      const off = this.opts.betOffset
      this.betChips.setAmount(
        player.betRound,
        grew ? new Vec3(s.x - off.x, s.y - off.y, 0) : undefined,
      )
    }
  }

  /** 名牌提示行（玩家座位的牌型 / 胜率）；仅自己的卡片有提示行 */
  setHint(text: string): void {
    this.plate.setHint(text)
  }

  /** 动作气泡：短暂显示后淡出 */
  showAction(text: string): void {
    this.bubbleLabel.string = text
    Tween.stopAllByTarget(this.bubbleOpacity)
    this.bubbleOpacity.opacity = 255
    tween(this.bubbleOpacity).delay(1.5).to(0.4, { opacity: 0 }).start()
  }

  /** 当前行动者：卡片头像外金色呼吸圈 */
  setActing(on: boolean): void {
    this.plate.setActing(on)
  }

  /** 胜利特效：头像金圈 + 座位脉冲 */
  showWin(): void {
    this.plate.showWinRing()
    const s = 1.1
    tween(this.node)
      .to(0.25, { scale: new Vec3(s, s, 1) })
      .to(0.25, { scale: new Vec3(1, 1, 1) })
      .to(0.25, { scale: new Vec3(s, s, 1) })
      .to(0.25, { scale: new Vec3(1, 1, 1) })
      .start()
  }

  /** 翻牌前盲注徽章（贴头像旁） */
  setBlindTag(kind: 'sb' | 'bb' | null): void {
    this.plate.setBlindTag(kind)
  }
}
