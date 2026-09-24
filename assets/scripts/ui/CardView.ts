import { Color, Graphics, Node, Sprite, tween, Vec3 } from 'cc'
import { Card } from '../core/Card'
import { frameOfBack, frameOfCard } from './CardFaces'
import { createLabel, createNode, drawRoundRect, THEME } from './Theme'

/**
 * 单张扑克牌视图：正面优先使用 cards.png 雪碧图、背面优先使用 card-back.png
 * （见 CardFaces），图片缺失时回退 Graphics 绘制。
 * 支持发牌飞入、翻牌亮面动画。
 */
export class CardView {
  readonly node: Node
  private readonly face: Node
  private readonly back: Node
  private readonly faceG: Graphics
  /** 雪碧图牌面（Sprite 必须单独占一个节点：一个节点只能挂一个渲染组件） */
  private readonly imgNode: Node
  private readonly sp: Sprite
  /** 牌背图片（同样须单独占一个节点） */
  private readonly backImgNode: Node
  private readonly backSp: Sprite
  /** 回退绘制的文字标签容器 */
  private readonly labels: Node
  private readonly w: number
  private readonly h: number
  private faceUp = false

  /** 当前是否亮面（避免重复翻牌动画） */
  get isFaceUp(): boolean {
    return this.faceUp
  }

  constructor(parent: Node, w: number, h: number) {
    this.w = w
    this.h = h
    this.node = createNode('card', parent, w, h)
    this.face = createNode('face', this.node, w, h)
    this.back = createNode('back', this.node, w, h)
    this.backImgNode = createNode('backImg', this.back, w, h)
    this.backImgNode.active = false
    this.backSp = this.backImgNode.addComponent(Sprite)
    this.backSp.type = Sprite.Type.SIMPLE
    this.backSp.sizeMode = Sprite.SizeMode.CUSTOM
    this.faceG = this.face.addComponent(Graphics)
    this.imgNode = createNode('img', this.face, w, h)
    this.imgNode.active = false
    this.sp = this.imgNode.addComponent(Sprite)
    this.sp.type = Sprite.Type.SIMPLE
    this.sp.sizeMode = Sprite.SizeMode.CUSTOM
    this.labels = createNode('labels', this.face)
    this.drawBack()
    this.showBack()
  }

  /** 设置牌面内容并重绘正面（默认仍显示背面，reveal/flip 时才亮出） */
  setCard(card: Card): void {
    this.drawFace(card)
  }

  reveal(card: Card): void {
    this.drawFace(card)
    this.showFace()
  }

  showFace(): void {
    this.face.active = true
    this.back.active = false
    this.faceUp = true
  }

  showBack(): void {
    this.face.active = false
    this.back.active = true
    this.faceUp = false
  }

  /** 从发牌位置飞入落位 */
  dealFrom(from: Vec3, delay = 0): void {
    const to = this.node.position.clone()
    this.node.setPosition(from)
    this.node.setScale(0.7, 0.7, 1)
    tween(this.node)
      .delay(delay)
      .to(0.26, { position: to, scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
      .start()
  }

  /** 翻牌动画：横向压扁 → 亮面 → 展开 */
  flip(delay = 0): void {
    tween(this.node)
      .delay(delay)
      .to(0.12, { scale: new Vec3(0.06, 1, 1) })
      .call(() => this.showFace())
      .to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start()
  }

  /** 带花色的红色/黑色墨色 */
  private inkOf(card: Card): Color {
    return card.isRed ? THEME.inkRed : THEME.inkBlack
  }

  private drawFace(card: Card): void {
    this.labels.removeAllChildren()
    const frame = frameOfCard(card)
    if (frame) {
      // 雪碧图牌面：整幅拉伸到牌面尺寸（比例 ~0.72，与图源一致）
      this.faceG.clear()
      this.imgNode.active = true
      this.sp.spriteFrame = frame
      return
    }
    // 回退：雪碧图未就绪时用 Graphics 绘制
    this.imgNode.active = false
    drawRoundRect(this.faceG, this.w - 4, this.h - 4, 8, THEME.cardFace, THEME.cardBorder)
    const ink = this.inkOf(card)
    // 左上角：点数 + 花色
    const corner = createLabel(this.labels, `${card.rankLabel}${card.suitLabel}`, Math.round(this.w * 0.28), ink, true)
    corner.node.setPosition(-this.w / 2 + this.w * 0.24, this.h / 2 - this.w * 0.26)
    // 中央大花色
    const center = createLabel(this.labels, card.suitLabel, Math.round(this.w * 0.46), ink)
    center.node.setPosition(0, -this.h * 0.04)
  }

  private drawBack(): void {
    // 优先使用牌背图片（已带圆角透明）；缺图时回退 Graphics 绘制
    const img = frameOfBack()
    if (img) {
      this.backSp.spriteFrame = img
      this.backImgNode.active = true
      return
    }
    this.backImgNode.active = false
    const g = this.back.addComponent(Graphics)
    g.fillColor = THEME.cardBack
    g.roundRect(-this.w / 2 + 2, -this.h / 2 + 2, this.w - 4, this.h - 4, 8)
    g.fill()
    g.lineWidth = 2
    g.strokeColor = THEME.cardBackLine
    g.roundRect(-this.w / 2 + 7, -this.h / 2 + 7, this.w - 14, this.h - 14, 5)
    g.stroke()
    g.circle(0, 0, this.w * 0.15)
    g.stroke()
  }
}
