import { Color, EditBox, Graphics, Node, Sprite, Tween, tween, UIOpacity, Vec3, view } from 'cc'
import { RoomInfo } from '../net/Protocol'
import { attachElem, attachHomeUi, attachHomeUiSliced, attachLobbyBg, elemFrame, homeFrame, lobbyBgFrame } from './HomeUi'
import { createIcon, ICON, setIconChar } from './IconFont'
import {
  createButton,
  createGlassButton,
  createLabel,
  createNode,
  drawGlassPanel,
  shade,
  THEME,
} from './Theme'
export type LobbyTab = 'rooms' | 'mine' | 'record'

export interface LobbyHandlers {
  /** 点某行的加入（或行本身） */
  onJoinRoom: (roomId: string) => void
  /** 创建房间（底部大按钮 / 左导航第二项 / 快速加入无房可进时的兜底） */
  onCreateRoom: () => void
  /** 手动刷新 */
  onRefresh: () => void
  /** 退出账号：回登录弹窗 */
  onExitAccount: () => void
  /** 切静音，返回切换后的静音态（音效 + BGM 由 app 统一持有） */
  onSound: () => boolean
  /** 全屏切换（app 侧走 Boot.toggleFullscreen） */
  onFullscreen: () => void
}

// ---------- 几何：全部由效果图 image.png（1672×941）实测换算 ----------
// 换算口径：等比 ×0.7655 落到 1280×720；cocos_x = 原图x×0.7655 − 640，cocos_y = 360 − 原图y×0.7655。
// 面板内元素再用面板中心 (25,−10) 转面板局部坐标（局部x = 屏幕−665，局部y = 370−屏幕y），
// 行内再减行条偏移 ROW_X（COLS = 屏幕 − 624）。
// v27 复测（表头亮段与行1字形亮段互证，五列全部居中对齐）：
//   行1 金锁 x374..400、id x460..521、名称 x605..684、底注 x868..887、人数 x1011..1047、状态 x1149..1203；
//   行文字纯白 (255,255,255)，表头暖米 (238,219,182)；字高→行 16 / 表头 15。
const COLS = {
  lock: -327, // 金锁贴片中心（原图行1 锁 x374..400 中心 387）
  id: -249, // 房间号（居中，白粗体；对齐表头房间号 c−248.9）
  name: -132, // 房间名称（居中；对齐表头 c−133.7）
  blind: 49, // 底注（居中；表头 c50.0）
  humans: 164, // 人数（居中；表头 c163.7）
  state: 276, // 状态（居中；表头 c276.6）
  join: 432, // 加入胶囊中心（原图 x1312..1448 → 屏幕 1005..1108 中心）
}
const HEAD_Y = 177 // 表头文字中心（面板局部；原图金字 y243..260 → 屏幕 192.5）
const ROW_TOP = 137 // 首行中心（面板局部；行1 文字中心原图 y305 → 屏幕 233.4）
const ROW_STEP = 42
const ROW_COUNT = 8
const ROW_W = 1030
const ROW_H = 34
const ROW_X = -41 // 行条整体在面板局部里的 x 偏移

/** 效果图表头暖米色（实测 (238,219,182)） */
const HEAD_INK = new Color(238, 219, 182)

/** 导航页签纵列中心（效果图页签1..4 中心 y251/353/450/540 → cocos） */
const NAV_YS = [167.8, 89.8, 15.5, -53.4]

/** 导航/圆钮小图标（Graphics 剪影，替代系统 emoji；颜色由调用方注入 Graphics） */
const NAV_PAINTERS: Record<string, (g: Graphics) => void> = {
  // 房子：三角顶 + 墙体
  house: (g) => {
    g.moveTo(-9.5, 1)
    g.lineTo(0, -9)
    g.lineTo(9.5, 1)
    g.close()
    g.fill()
    g.roundRect(-6.5, 1, 13, 10, 1.5)
    g.fill()
  },
  // 加号：两根圆头粗条交叉
  plus: (g) => {
    g.roundRect(-9, -2.6, 18, 5.2, 2.6)
    g.fill()
    g.roundRect(-2.6, -9, 5.2, 18, 2.6)
    g.fill()
  },
  // 人像：圆头 + 半圆肩
  person: (g) => {
    g.circle(0, -3.5, 4.4)
    g.fill()
    g.moveTo(-8.5, 10)
    g.arc(0, 10, 8.5, Math.PI, 0, true)
    g.close()
    g.fill()
  },
  // 柱状图：三根高低柱（战绩）
  bars: (g) => {
    g.roundRect(-9, -1, 5, 9, 1.5)
    g.fill()
    g.roundRect(-2.5, -6, 5, 14, 1.5)
    g.fill()
    g.roundRect(4, -10, 5, 18, 1.5)
    g.fill()
  },
  // 刷新：270° 圆弧 + 箭头
  refresh: (g) => {
    g.lineWidth = 3
    g.arc(0, 0, 8, Math.PI * 0.35, Math.PI * 1.75, false)
    g.stroke()
    g.moveTo(8.9, -2.5)
    g.lineTo(3.9, -3.9)
    g.lineTo(7.5, -7.5)
    g.close()
    g.fill()
  },
}

/** 圆钮底：深色圆面 + 金描边（无素材帧时的回退画法） */
function circleBase(host: Node, r = 20): Graphics {
  const g = host.addComponent(Graphics)
  g.fillColor = new Color(24, 30, 42, 170)
  g.circle(0, 0, r)
  g.fill()
  g.lineWidth = 2
  g.strokeColor = THEME.gold
  g.circle(0, 0, r)
  g.stroke()
  return g
}

/** 在宿主的独立子节点里画一个 NAV_PAINTERS 图标（scale 便于在小/大圆钮里复用） */
function paintIcon(host: Node, painter: (g: Graphics) => void, color: Color, scale = 1): Node {
  const n = createNode('gicon', host, 26, 26)
  n.setScale(scale, scale, 1)
  const g = n.addComponent(Graphics)
  g.fillColor = color
  g.strokeColor = color
  g.lineWidth = 2.5
  painter(g)
  return n
}

/**
 * 登录后的大厅（1280×720，按最终效果图 image.png 实测几何 1:1 还原）：
 * 效果图整图铺底，再叠效果图直裁元素（playerBar2 玩家牌 / nav 导航整列 /
 * btnCreate·btnQuick 底部双钮 / mascot 吉祥物 / 行首金锁），全部与背景里的
 * 原件逐像素重合消重。绘制顺序同效果图叠放：面板 → 玩家牌/导航/圆钮/底部钮/吉祥物。
 */
export class Lobby {
  readonly node: Node
  private readonly handlers: LobbyHandlers
  private readonly contentRooms: Node
  private readonly contentRecord: Node
  private readonly rows: RowView[] = []
  private readonly navItems: Array<{ node: Node; redraw: () => void }> = []
  private navSel: boolean[] = [true, false, false, false]
  private navHasElem = false
  private navDark0: Node | null = null // 选中非首页签时压暗帧里烧死的金页签1
  private navRing: Node | null = null // 选中页签金圈（外辉光 + 内亮线）
  private readonly searchBox: EditBox
  private readonly nameLabels: Array<(s: string) => void> = []
  private soundFace: Node | null = null
  private soundSlash: Node | null = null
  private soundGlyph: ReturnType<typeof createIcon> | null = null
  private readonly emptyHint!: Node
  private recName!: ReturnType<typeof createLabel>
  private recStats!: ReturnType<typeof createLabel>
  private tab: LobbyTab = 'rooms'
  private rooms: RoomInfo[] = []
  private account: { name: string; won: number; played: number } | null = null
  private muted = false

  constructor(parent: Node, handlers: LobbyHandlers) {
    this.handlers = handlers
    this.node = createNode('lobby', parent, 1280, 720)

    this.buildBg()

    // ---------- 中央大面板：房间表格 / 战绩页 二选一 ----------
    // 效果图 [97,100,1640,868] → 1181×588 @ cocos(25,−10)
    const panel = attachHomeUiSliced(this.node, 'panel', 90, 90, 1181, 588)
    panel.setPosition(25, -10)
    if (!homeFrame('panel')) {
      drawGlassPanel(panel.addComponent(Graphics), 1181, 588, 26)
    }
    this.contentRooms = createNode('contentRooms', panel)
    this.contentRecord = createNode('contentRecord', panel)
    this.contentRecord.active = false

    // 面板右缘竹卷轴（效果图原图 x1489..1673,y123..831 → 局部 (545,5)，141×542）。
    // 背景虽已是效果图整图，但面板素材盖住了卷轴在面板内的部分 → 直裁帧盖回去
    attachElem(panel, 'scroll', 141, 542).setPosition(545, 5)

    // 标题「德州扑克♠」（效果图金像素 x103..586,y165..190 → 局部 (−402,237)，383×34）
    attachElem(this.contentRooms, 'title', 383, 34).setPosition(-402, 237)

    // 搜索胶囊（效果图原图 x1037..1317,y157..214 → 局部 (236,229)，214×44）。
    // 直裁帧自带左侧金放大镜；占位文字已擦除，EditBox 从图标右侧起排
    const searchHost = attachElem(this.contentRooms, 'search', 214, 44)
    searchHost.setPosition(236, 229)
    if (!elemFrame('search')) {
      const fallback = attachHomeUiSliced(this.contentRooms, 'searchStrip', 112, 40, 214, 44)
      fallback.setPosition(236, 229)
      if (!homeFrame('searchStrip')) {
        drawGlassPanel(searchHost.addComponent(Graphics), 214, 44, 16)
      }
    }
    const editNode = createNode('edit', searchHost, 140, 32)
    editNode.setPosition(30, 0)
    this.searchBox = editNode.addComponent(EditBox)
    this.searchBox.maxLength = 12
    const ph = createLabel(editNode, '搜索房间或ID', 13, new Color(205, 175, 125))
    ph.node.setPosition(-70, 0)
    ph.node.anchorX = 0
    const tl = createLabel(editNode, '', 13, new Color(240, 220, 185))
    tl.node.setPosition(-70, 0)
    tl.node.anchorX = 0
    this.searchBox.placeholderLabel = ph
    this.searchBox.textLabel = tl
    for (const name of ['PLACEHOLDER_LABEL', 'TEXT_LABEL']) {
      const orphan = editNode.getChildByName(name)
      if (orphan && orphan !== ph.node && orphan !== tl.node) {
        orphan.destroy()
        orphan.removeFromParent()
      }
    }
    editNode.on('editing-did-ended', () => this.refreshRows())

    // 刷新大圆钮（效果图亮团原图 x1358..1492,y126..256 → 局部 (425,224)，103×100）
    const refresh = attachElem(this.contentRooms, 'refresh', 103, 100)
    refresh.setPosition(425, 224)
    if (!elemFrame('refresh')) {
      circleBase(refresh, 48)
      paintIcon(refresh, NAV_PAINTERS.refresh, THEME.goldBright, 1.15)
    }
    refresh.on(Node.EventType.TOUCH_END, () => {
      tween(refresh).to(0.16, { angle: 360 }).call(() => refresh.setRotationFromEuler(0, 0, 0)).start()
      handlers.onRefresh()
    })

    // 表头：深色金边条（headStrip 三段拉伸）+ 暖米列名（五列全部居中，同效果图）
    const headStrip = attachHomeUiSliced(this.contentRooms, 'headStrip', 70, 70, ROW_W, 24)
    headStrip.setPosition(ROW_X, HEAD_Y)
    if (!homeFrame('headStrip')) {
      const hg = headStrip.addComponent(Graphics)
      hg.fillColor = new Color(18, 26, 30, 150)
      hg.roundRect(-ROW_W / 2, -12, ROW_W, 24, 8)
      hg.fill()
      hg.lineWidth = 1
      hg.strokeColor = new Color(217, 164, 65, 90)
      hg.roundRect(-ROW_W / 2, -12, ROW_W, 24, 8)
      hg.stroke()
    }
    const headers: Array<[string, number]> = [
      ['房间号', COLS.id],
      ['房间名称', COLS.name],
      ['底注', COLS.blind],
      ['人数', COLS.humans],
      ['状态', COLS.state],
    ]
    headers.forEach(([text, x]) => {
      const h = createLabel(this.contentRooms, text, 15, HEAD_INK)
      h.node.setPosition(x + ROW_X, HEAD_Y)
    })

    // 8 行缓存（setRooms 只重填不重建；首行中心面板局部 y=137、步距 42）
    for (let i = 0; i < ROW_COUNT; i++) {
      this.rows.push(new RowView(this.contentRooms, ROW_TOP - i * ROW_STEP, (id) => handlers.onJoinRoom(id)))
    }

    // 空列表提示（落在行区中央）
    this.emptyHint = createNode('emptyHint', this.contentRooms, 800, 56)
    this.emptyHint.setPosition(ROW_X, -10)
    const eg = this.emptyHint.addComponent(Graphics)
    eg.fillColor = new Color(26, 68, 44, 185)
    eg.roundRect(-400, -28, 800, 56, 14)
    eg.fill()
    eg.lineWidth = 1.5
    eg.strokeColor = THEME.gold
    eg.roundRect(-400, -28, 800, 56, 14)
    eg.stroke()
    const emptyText = createLabel(this.emptyHint, '还没有房间 — 点下方「创建房间」，开始你的游戏之旅', 15, THEME.textBright, true)
    emptyText.node.setPosition(0, 0)

    // 战绩页
    this.buildRecordPage()

    // ---------- 玩家信息牌（画在面板之后 → 牌底压住面板左上角，同效果图叠放） ----------
    this.buildTopBar()

    // ---------- 左导航（画在面板之后 → 压住面板左缘，同效果图叠放） ----------
    this.buildNav()

    // ---------- 右上四圆钮（效果图压在面板顶缘上 → 必须画在面板之后） ----------
    this.buildRoundButtons()

    // ---------- 底部大按钮：整钮直裁自带文字（绿原图[544,796,322×82]→246×63@(−100.4,−280.7)；
    // 金原图[895,798,328×80]→251×61@(170.6,−281.3)），按压白色闪光叠层 ----------
    this.mkBigBtn('btnCreate', 246, 63, -100.4, -280.7, 16, () => handlers.onCreateRoom(), () => {
      const b = createButton(this.node, '创建房间', 220, 56, shade(THEME.call, 1.35), 18)
      b.node.setPosition(-100, -280)
      return b.node
    })
    this.mkBigBtn('btnQuick', 251, 61, 170.6, -281.3, 16, () => this.quickJoin(), () => {
      const b = createButton(this.node, '快速加入', 300, 56, shade(THEME.raise, 1.15), 18)
      b.node.setPosition(178, -281)
      return b.node
    })

    // 乌龟吉祥物（原图 [1455,660,185,155] → 142×119 @ (543.5,−204.5)，带暗底余量
    // 与面板同色隐形；整块盖回背景里的原件，消除旧版错位重影）
    const mascot = attachElem(this.node, 'mascot', 142, 119)
    mascot.setPosition(543.5, -204.5)
    if (!elemFrame('mascot') && homeFrame('mascotTurtle')) {
      attachHomeUi(this.node, 'mascotTurtle', 130, 115).setPosition(543.5, -204.5)
    }
  }

  /** 底部大钮：直裁整钮 + 按压闪光（白 70% 圆角罩，按下 230 → 松开 0.28s 淡出） */
  private mkBigBtn(
    key: 'btnCreate' | 'btnQuick',
    w: number,
    h: number,
    x: number,
    y: number,
    r: number,
    onTap: () => void,
    fallback: () => Node,
  ): void {
    const host = attachElem(this.node, key, w, h)
    host.setPosition(x, y)
    if (!elemFrame(key)) {
      fallback()
    }
    const flash = createNode('flash', host, w - 6, h - 8)
    const fg = flash.addComponent(Graphics)
    fg.fillColor = new Color(255, 255, 255, 70)
    fg.roundRect(-(w - 6) / 2, -(h - 8) / 2, w - 6, h - 8, r)
    fg.fill()
    const fo = flash.addComponent(UIOpacity)
    fo.opacity = 0
    host.on(Node.EventType.TOUCH_START, () => {
      Tween.stopAllByTarget(flash)
      fo.opacity = 230
    })
    const fade = (): void => {
      Tween.stopAllByTarget(flash)
      tween(fo).to(0.28, { opacity: 0 }).start()
    }
    host.on(Node.EventType.TOUCH_END, () => {
      fade()
      onTap()
    })
    host.on(Node.EventType.TOUCH_CANCEL, () => fade())
  }

  /** 背景铺满可见区（fitHeight 下手机可见宽 1450，按 view.getVisibleSize 兜满） */
  private buildBg(): void {
    const vis = view.getVisibleSize()
    // 首选：效果图整图直接铺底（背景与效果图逐像素同源）；
    // 退一级用雪碧图 bg 素材；再退深绿渐变。不做整体压暗——效果图本身已是黄昏暖调
    const bg = attachLobbyBg(this.node, vis.width, vis.height)
    bg.setPosition(0, 0)
    if (!lobbyBgFrame()) {
      const art = homeFrame('bg')
      if (art) {
        const n = createNode('bgArt', this.node, vis.width, vis.height)
        const sp = n.addComponent(Sprite)
        sp.type = Sprite.Type.SIMPLE
        sp.sizeMode = Sprite.SizeMode.CUSTOM
        sp.spriteFrame = art
      } else {
        const g = bg.addComponent(Graphics)
        g.fillColor = shade(THEME.feltRim, 0.55)
        g.rect(-vis.width / 2, -vis.height / 2, vis.width, vis.height)
        g.fill()
      }
    }
  }

  private buildTopBar(): void {
    // 整牌直裁（原图 [40,18,345,112] → 264×86 @ (−477.3,303.4)）：金环乌龟头像 +
    // 米色牌 + 右侧纹样 + 金币图标全烧在帧里；静态「德州王」与金币数字已擦成动态位。
    // 动态字色取效果图实测：名字白 (247,240,225)、金币数金 (218,174,85)
    const bar = attachElem(this.node, 'playerBar2', 264, 86)
    bar.setPosition(-477.3, 303.4)
    if (!elemFrame('playerBar2')) {
      const fb = attachHomeUiSliced(this.node, 'playerBar', 145, 42, 375, 84)
      fb.setPosition(-441, 312)
      if (!homeFrame('playerBar')) {
        drawGlassPanel(fb.addComponent(Graphics), 375, 84, 34)
      }
    }
    const name = createLabel(this.node, '游客', 16, new Color(247, 240, 225), true)
    name.node.setPosition(-518, 316)
    name.node.anchorX = 0
    const coins = createLabel(this.node, '0', 14, new Color(218, 174, 85), true)
    coins.node.setPosition(-499, 280)
    coins.node.anchorX = 0
    this.nameLabels.push(
      (s: string) => {
        name.string = s
        // 名字随长度缩字号，长名不撞右侧纹样（牌面可容 ~110px）
        name.fontSize = s.length <= 4 ? 16 : s.length <= 6 ? 13 : 12
      },
      (s: string) => (coins.string = s),
    )
  }

  /** 顶栏四圆钮：声音 / 全屏 / 战绩 / 退出。v26 实测效果图顶栏圆钮中心
   * 原图 x1301/1391/1481/1571,y55 → 画布 (356,425,494,563)×y318、直径 46，
   * 直裁帧（深蓝底金圈金图标）优先，雪碧图帧次之，代码画兜底 */
  private buildRoundButtons(): void {
    const mkIconBtn = (x: number, name: string, draw: (host: Node) => void, onTap: () => void): Node => {
      const node = createNode(name, this.node, 46, 46)
      node.setPosition(x, 318)
      draw(node)
      node.on(Node.EventType.TOUCH_END, () => {
        Tween.stopAllByTarget(node)
        tween(node)
          .to(0.12, { scale: new Vec3(0.9, 0.9, 1) })
          .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start()
        onTap()
      })
      return node
    }
    mkIconBtn(356, 'btnSound', (host) => {
      if (elemFrame('mBtnSound')) {
        this.soundFace = attachElem(host, 'mBtnSound', 46, 46)
        this.soundSlash = createNode('muteSlash', host, 46, 46)
        const sg = this.soundSlash.addComponent(Graphics)
        sg.lineWidth = 3.5
        sg.strokeColor = new Color(255, 96, 82)
        sg.moveTo(-13, 13)
        sg.lineTo(13, -13)
        sg.stroke()
        this.soundSlash.active = false
      } else if (homeFrame('roundSound')) {
        this.soundFace = attachHomeUi(host, 'roundSound', 46, 46)
        this.soundSlash = createNode('muteSlash', host, 46, 46)
        const sg = this.soundSlash.addComponent(Graphics)
        sg.lineWidth = 3.5
        sg.strokeColor = new Color(255, 96, 82)
        sg.moveTo(-13, 13)
        sg.lineTo(13, -13)
        sg.stroke()
        this.soundSlash.active = false
      } else {
        circleBase(host, 22)
        this.soundGlyph = createIcon(host, ICON.volumeOn, 20, THEME.goldBright)
      }
    }, () => {
      this.muted = this.handlers.onSound()
      this.setMuted(this.muted)
    })
    mkIconBtn(425, 'btnFull', (host) => {
      if (elemFrame('mBtnFull')) {
        attachElem(host, 'mBtnFull', 46, 46)
      } else if (homeFrame('roundExpand')) {
        attachHomeUi(host, 'roundExpand', 46, 46)
      } else {
        circleBase(host, 22)
        createIcon(host, ICON.expand, 17, THEME.goldBright)
      }
    }, () => this.handlers.onFullscreen())
    mkIconBtn(494, 'btnRecord', (host) => {
      if (elemFrame('mBtnRecord')) {
        attachElem(host, 'mBtnRecord', 46, 46)
      } else if (homeFrame('roundTrophy')) {
        attachHomeUi(host, 'roundTrophy', 46, 46)
      } else {
        circleBase(host, 22)
        paintIcon(host, NAV_PAINTERS.bars, THEME.goldBright)
      }
    }, () => this.setTab('record'))
    mkIconBtn(563, 'btnExit', (host) => {
      if (elemFrame('mBtnExit')) {
        attachElem(host, 'mBtnExit', 46, 46)
      } else if (homeFrame('roundExit')) {
        attachHomeUi(host, 'roundExit', 46, 46)
      } else {
        // 退出 = 开门走人：门板 + 门把 + 向外箭头
        const g = circleBase(host, 22)
        g.lineWidth = 2.6
        g.strokeColor = THEME.goldBright
        g.fillColor = THEME.goldBright
        g.roundRect(-10, -11, 12, 22, 2)
        g.stroke()
        g.circle(-1.5, 0, 1.3)
        g.fill()
        g.moveTo(2, 0)
        g.lineTo(10.5, 0)
        g.stroke()
        g.moveTo(7, 3.6)
        g.lineTo(11.6, 0)
        g.lineTo(7, -3.6)
        g.close()
        g.fill()
      }
    }, () => this.handlers.onExitAccount())
  }

  private buildNav(): void {
    // 整列直裁（原图 [65,205,255,385] → 195×295 @ (−492.6,55.7)）：金选中页签1 +
    // 深色连排页签2-4（含分隔线）全烧在帧里，整列压在面板左缘上同效果图叠放。
    // 选中态：非 0 页签 = 金圈高亮 + 帧里金页签1 压暗；页签帧缺失回退旧 Graphics 药丸
    attachElem(this.node, 'nav', 195, 295).setPosition(-492.6, 55.7)
    this.navHasElem = !!elemFrame('nav')
    if (this.navHasElem) {
      this.navDark0 = createNode('navDark0', this.node, 180, 60)
      this.navDark0.setPosition(-494.1, NAV_YS[0])
      const dg = this.navDark0.addComponent(Graphics)
      dg.fillColor = new Color(13, 20, 26, 185)
      dg.roundRect(-90, -30, 180, 60, 12)
      dg.fill()
      this.navDark0.active = false
      this.navRing = createNode('navRing', this.node, 186, 66)
      const rg = this.navRing.addComponent(Graphics)
      rg.lineWidth = 6
      rg.strokeColor = new Color(232, 190, 96, 40)
      rg.roundRect(-93, -33, 186, 66, 13)
      rg.stroke()
      rg.lineWidth = 2.5
      rg.strokeColor = THEME.goldBright
      rg.roundRect(-91, -31, 182, 62, 12)
      rg.stroke()
      this.navRing.active = false
    }
    const items: Array<{ icon: string; label: string; action: () => void }> = [
      { icon: 'house', label: '房间列表', action: () => this.setTab('rooms') },
      { icon: 'plus', label: '创建房间', action: () => this.handlers.onCreateRoom() },
      { icon: 'person', label: '我的房间', action: () => this.setTab('mine') },
      { icon: 'bars', label: '战绩记录', action: () => this.setTab('record') },
    ]
    this.navSel = [true, false, false, false]
    items.forEach((it, i) => {
      if (this.navHasElem) {
        // 命中区（图文烧在整列帧里，透明 Graphics 垫底保命中）
        const node = createNode('navHit', this.node, 180, 62)
        node.setPosition(-494.1, NAV_YS[i])
        const hg = node.addComponent(Graphics)
        hg.fillColor = new Color(255, 255, 255, 0)
        hg.roundRect(-90, -31, 180, 62, 12)
        hg.fill()
        node.on(Node.EventType.TOUCH_END, () => {
          // 创建房间是动作不是页签：点完仍回到列表页
          const isAction = i === 1
          this.navSel.forEach((_, j) => (this.navSel[j] = isAction ? j === 0 : j === i))
          this.applyNavSel()
          it.action()
        })
        this.navItems.push({ node, redraw: () => undefined })
        return
      }
      const node = createNode('nav', this.node, 95, 60)
      node.setPosition(-586, 169 - i * 75)
      const g = node.addComponent(Graphics)
      const icon = createNode('navIcon', node, 24, 24)
      icon.setPosition(-30, 0)
      const ig = icon.addComponent(Graphics)
      const label = createLabel(node, it.label, 12, THEME.textBright, true)
      label.node.setPosition(-14, 0)
      label.node.anchorX = 0
      const redraw = (): void => {
        const on = this.navSel[i]
        g.clear()
        g.fillColor = on ? THEME.gold : new Color(16, 24, 30, 175)
        g.roundRect(-47.5, -30, 95, 60, 16)
        g.fill()
        g.lineWidth = on ? 2 : 1
        g.strokeColor = on ? shade(THEME.goldBright, 1.1) : new Color(255, 255, 255, 36)
        g.roundRect(-47.5, -30, 95, 60, 16)
        g.stroke()
        label.color = on ? new Color(74, 52, 20) : THEME.textDim
        ig.clear()
        const c = on ? new Color(74, 52, 20) : THEME.textDim
        ig.fillColor = c
        ig.strokeColor = c
        ig.lineWidth = 2.5
        NAV_PAINTERS[it.icon](ig)
      }
      redraw()
      this.navItems.push({ node, redraw })
      node.on(Node.EventType.TOUCH_END, () => {
        const isAction = i === 1
        this.navSel.forEach((_, j) => (this.navSel[j] = isAction ? j === 0 : j === i))
        this.applyNavSel()
        it.action()
      })
    })
    this.applyNavSel()
  }

  /** 页签选中态应用到直裁帧（金圈 + 默认金页签压暗）与回退药丸 */
  private applyNavSel(): void {
    const active = this.navSel.indexOf(true)
    if (this.navHasElem) {
      if (this.navDark0) {
        this.navDark0.active = active !== 0
      }
      if (this.navRing) {
        this.navRing.active = active > 0
        if (active > 0) {
          this.navRing.setPosition(-494.1, NAV_YS[active])
        }
      }
    }
    this.navItems.forEach((n) => n.redraw())
  }

  private buildRecordPage(): void {
    const title = createLabel(this.contentRecord, '战绩记录', 30, THEME.goldBright, true)
    title.node.setPosition(0, 250)
    const hint = createLabel(this.contentRecord, '账号生涯口径：每打完一手记 1 手，赢家再记 1 胜', 14, THEME.textDim)
    hint.node.setPosition(0, 218)
    this.recName = createLabel(this.contentRecord, '游客（战绩不保存）', 26, THEME.textBright, true)
    this.recName.node.setPosition(0, 120)
    this.recStats = createLabel(this.contentRecord, '登录 / 注册后这里显示生涯战绩', 20, THEME.goldBright, true)
    this.recStats.node.setPosition(0, 55)
    const back = createGlassButton(this.contentRecord, '返回房间列表', 200, 48, 18, THEME.textBright)
    back.node.setPosition(0, -100)
    back.node.on(Node.EventType.TOUCH_END, () => this.setTab('rooms'))
  }

  // ---------- 对外接口 ----------

  show(): void {
    this.node.active = true
  }

  hide(): void {
    this.node.active = false
  }

  setAccount(name: string, won: number, played: number): void {
    this.account = { name, won, played }
    if (this.nameLabels.length) {
      this.nameLabels[0](name)
      // 金币数直显胜场数（牌面烧死的金币图标旁）
      this.nameLabels[1](`${won}`)
    }
    this.renderRecord()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.soundFace) {
      if (this.soundSlash) {
        this.soundSlash.active = muted
      }
      const sp = this.soundFace.getComponent(Sprite)
      if (sp) {
        sp.color = muted ? new Color(150, 155, 165) : Color.WHITE
      }
    } else if (this.soundGlyph) {
      setIconChar(this.soundGlyph, muted ? ICON.volumeOff : ICON.volumeOn, muted ? THEME.textDim : THEME.goldBright)
    }
  }

  setRooms(rooms: RoomInfo[]): void {
    this.rooms = rooms
    this.refreshRows()
  }

  setTab(tab: LobbyTab): void {
    this.tab = tab
    this.contentRooms.active = tab !== 'record'
    this.contentRecord.active = tab === 'record'
    // 页签高亮与当前页同步（创建房间是动作项，保持列表页选中）
    const idx = tab === 'rooms' ? 0 : tab === 'mine' ? 2 : 3
    this.navSel.forEach((_, j) => (this.navSel[j] = j === idx))
    this.applyNavSel()
    this.refreshRows()
  }

  /** 快速加入：挑第一个没满的房；全满或没有房就建房 */
  private quickJoin(): void {
    const target = this.rooms.find((r) => r.humans < r.seats)
    if (target) {
      this.handlers.onJoinRoom(target.id)
    } else {
      this.handlers.onCreateRoom()
    }
  }

  private filtered(): RoomInfo[] {
    let list = this.rooms
    if (this.tab === 'mine') {
      list = list.filter((r) => r.mine)
    }
    const q = (this.searchBox?.string ?? '').trim().toLowerCase()
    if (q) {
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q))
    }
    return list
  }

  private refreshRows(): void {
    const list = this.filtered()
    this.rows.forEach((row, i) => row.fill(list[i] ?? null))
    this.emptyHint.active = list.length === 0
  }

  private renderRecord(): void {
    if (!this.recName || !this.recStats) {
      return
    }
    if (this.account) {
      const { name, won, played } = this.account
      const rate = played > 0 ? Math.round((won / played) * 100) : 0
      this.recName.string = name
      this.recStats.string = `总手数 ${played} · 胜 ${won} · 胜率 ${rate}%`
    } else {
      this.recName.string = '游客（战绩不保存）'
      this.recStats.string = '登录 / 注册后这里显示生涯战绩'
    }
  }
}

/**
 * 一行房间：效果图口径 v27——无条底（暗面板直排文字 + 上缘极淡分隔线）+
 * 行首金锁贴片 + 白字五列（房间号粗体居中）+ 直裁「加入」胶囊（内置文字已擦，
 * 代码动态画；满员整帧压灰 + 白字「已满」）。整行可点（点行 = 加入）。
 */
class RowView {
  readonly node: Node
  private readonly idL: ReturnType<typeof createLabel>
  private readonly nameL: ReturnType<typeof createLabel>
  private readonly blindL: ReturnType<typeof createLabel>
  private readonly humansL: ReturnType<typeof createLabel>
  private readonly stateL: ReturnType<typeof createLabel>
  private readonly joinOverlay: Node
  private readonly joinLabel: ReturnType<typeof createLabel>
  private readonly joinFallback?: { label: { string: string }; node: Node }
  private roomId = ''

  constructor(parent: Node, y: number, onJoin: (id: string) => void) {
    this.node = createNode('row', parent, ROW_W, ROW_H)
    this.node.setPosition(ROW_X, y)
    const g = this.node.addComponent(Graphics)
    g.lineWidth = 1
    g.strokeColor = new Color(255, 244, 220, 16)
    g.moveTo(-ROW_W / 2 + 10, ROW_H / 2 - 1)
    g.lineTo(ROW_W / 2 - 10, ROW_H / 2 - 1)
    g.stroke()
    // 行首金锁（效果图每行一枚，房间号左侧；原图行2 锁 [374,343,400,375] → 23×27）
    if (elemFrame('lock')) {
      attachElem(this.node, 'lock', 23, 27).setPosition(COLS.lock, 0)
    }
    this.idL = createLabel(this.node, '', 16, THEME.textBright, true)
    this.idL.node.setPosition(COLS.id, 0)
    this.nameL = createLabel(this.node, '', 16, THEME.textBright)
    this.nameL.node.setPosition(COLS.name, 0)
    this.blindL = createLabel(this.node, '', 16, THEME.textBright)
    this.blindL.node.setPosition(COLS.blind, 0)
    this.humansL = createLabel(this.node, '', 16, THEME.textBright)
    this.humansL.node.setPosition(COLS.humans, 0)
    this.stateL = createLabel(this.node, '', 16, THEME.textBright)
    this.stateL.node.setPosition(COLS.state, 0)
    if (elemFrame('join')) {
      // 效果图直裁加入胶囊（原图 136×44 → 103×32 等比；内置「加入」已擦成动态位）
      this.joinOverlay = attachElem(this.node, 'join', 103, 32)
      this.joinOverlay.setPosition(COLS.join, 0)
      this.joinLabel = createLabel(this.node, '', 16, new Color(64, 44, 14), true)
      this.joinLabel.node.setPosition(COLS.join, 0)
    } else if (homeFrame('btnJoin')) {
      this.joinOverlay = attachHomeUi(this.node, 'btnJoin', 115, 32)
      this.joinOverlay.setPosition(COLS.join, 0)
      this.joinLabel = createLabel(this.node, '', 16, new Color(64, 44, 14), true)
      this.joinLabel.node.setPosition(COLS.join, 0)
    } else {
      const b = createGlassButton(this.node, '加入', 100, 28, 13, THEME.goldBright)
      b.node.setPosition(COLS.join, 0)
      this.joinFallback = b
      this.joinLabel = b.label
      this.joinOverlay = createNode('noOverlay', this.node, 0, 0)
    }
    // 整行可点（点行 = 加入），比只点小按钮的手感好
    this.node.on(Node.EventType.TOUCH_END, () => {
      if (this.roomId) {
        onJoin(this.roomId)
      }
    })
  }

  fill(r: RoomInfo | null): void {
    this.node.active = !!r
    if (!r) {
      this.roomId = ''
      return
    }
    this.roomId = r.id
    this.idL.string = r.id
    this.nameL.string = r.name
    // 底注列按效果图口径显示单个数字（10/25/…，非 10/20 区间；数值测量：行1=「10」窄1+宽0）
    this.blindL.string = `${r.smallBlind}`
    this.humansL.string = `${r.humans}/${r.seats}`
    const full = r.humans >= r.seats
    this.stateL.string = full ? '已满' : r.inHand ? '游戏中' : '等待中'
    this.stateL.color = full ? THEME.textDim : THEME.textBright
    if (this.joinFallback) {
      this.joinFallback.label.string = full ? '已满' : '加入'
    } else {
      this.joinLabel.string = full ? '已满' : '加入'
      this.joinLabel.color = full ? THEME.textBright : new Color(64, 44, 14)
      // 满员把胶囊整体压灰（贴图帧在子节点上，须向下找）
      const sp = this.joinOverlay.getComponentInChildren(Sprite)
      if (sp) {
        sp.color = full ? new Color(150, 150, 150) : Color.WHITE
      }
    }
  }
}
