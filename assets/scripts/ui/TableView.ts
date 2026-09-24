import { Graphics, Node, Size, Sprite, Texture2D, Vec3, resources, view } from 'cc'
import { frameOfTexture } from './CardFaces'
import { createNode, THEME } from './Theme'

/** 发牌动画起点（牌堆位置，根节点坐标系） */
export const DECK_POS = new Vec3(310, 30, 0)

/** 桌面中心，用于计算庄家钮等方位 */
export const TABLE_CENTER = new Vec3(0, 20, 0)

/**
 * 桌面视图：优先加载 resources/table.png（池塘 + 跑道桌整景，16:9）铺满全屏，
 * 加载失败或就绪前用 Graphics 绘制的房间背景 + 椭圆桌面兜底。
 * 牌堆始终代码绘制（发牌动画起点）。
 */
export class TableView {
  readonly node: Node
  /** 桌面整景图加载结果（true = 图片就绪，false = 使用兜底绘制）；供启动遮罩等待 */
  readonly ready: Promise<boolean>
  /** Graphics 兜底绘制的节点（背景图就绪后隐藏） */
  private readonly drawn: Node[] = []

  constructor(parent: Node) {
    this.node = createNode('table', parent)
    const size = view.getVisibleSize()

    // 房间深色背景（铺满可视区域）
    const room = createNode('room', this.node, size.width, size.height)
    const bgG = room.addComponent(Graphics)
    bgG.fillColor = THEME.roomBg
    bgG.rect(-size.width / 2, -size.height / 2, size.width, size.height)
    bgG.fill()
    this.drawn.push(room)

    // 桌面：深色包边 + 墨绿台呢 + 金色内圈线
    // 节点自身的 Graphics 会先于子节点绘制，挂在 this.node 上会被全屏的
    // room 子节点盖住，必须放进排在 room 之后的子节点才能盖住背景
    const felt = createNode('felt', this.node)
    const feltG = felt.addComponent(Graphics)
    feltG.fillColor = THEME.feltRim
    feltG.ellipse(TABLE_CENTER.x, TABLE_CENTER.y, 502, 270)
    feltG.fill()
    feltG.fillColor = THEME.felt
    feltG.ellipse(TABLE_CENTER.x, TABLE_CENTER.y, 480, 252)
    feltG.fill()
    const gold = THEME.gold.clone()
    gold.a = 170
    feltG.lineWidth = 2
    feltG.strokeColor = gold
    feltG.ellipse(TABLE_CENTER.x, TABLE_CENTER.y, 452, 228)
    feltG.stroke()
    this.drawn.push(felt)

    // 牌堆（所有发牌动画的起点）
    const deck = createNode('deck', this.node)
    deck.setPosition(DECK_POS)
    const dg = deck.addComponent(Graphics)
    dg.fillColor = THEME.cardBack
    dg.roundRect(-26, -36, 52, 72, 6)
    dg.fill()
    dg.lineWidth = 2
    dg.strokeColor = THEME.gold
    dg.roundRect(-21, -31, 42, 62, 5)
    dg.stroke()

    // 桌面整景图（与设计分辨率同为 16:9，整屏铺满即可对位）
    this.ready = this.loadTableImage(size)
  }

  /** 加载 table.png 成功后垫到最底层，并隐藏 Graphics 兜底绘制；返回就绪 Promise */
  private loadTableImage(size: Size): Promise<boolean> {
    return new Promise((resolve) => {
      resources.load('table/texture', Texture2D, (err, tex) => {
        if (err || !tex) {
          console.warn('[TableView] resources/table.png 加载失败，使用代码绘制桌面', err)
          resolve(false)
          return
        }
        const img = createNode('tableImg', this.node, size.width, size.height)
        img.setSiblingIndex(0)
        const sp = img.addComponent(Sprite)
        sp.type = Sprite.Type.SIMPLE
        sp.sizeMode = Sprite.SizeMode.CUSTOM
        sp.spriteFrame = frameOfTexture(tex)
        this.drawn.forEach((n) => (n.active = false))
        console.log(`[TableView] 桌面整景已加载：${tex.width}×${tex.height}`)
        resolve(true)
      })
    })
  }
}
