import { Color, EditBox, Graphics, Node, Sprite, Tween, tween, Vec3 } from "cc";
import { RoomInfo } from "../net/Protocol";
import { attachHomeUi, homeFrame } from "./HomeUi";
import { createIcon, ICON, setIconChar } from "./IconFont";
import {
  createButton,
  createGlassButton,
  createLabel,
  createNode,
  drawGlassPanel,
  drawLockGlyph,
  shade,
  THEME,
} from "./Theme";
export type LobbyTab = "rooms" | "mine" | "record";

export interface LobbyHandlers {
  /** 点某行的加入（或行本身） */
  onJoinRoom: (roomId: string) => void;
  /** 创建房间（底部大按钮 / 左导航第二项 / 快速加入无房可进时的兜底） */
  onCreateRoom: () => void;
  /** 手动刷新 */
  onRefresh: () => void;
  /** 退出账号：回登录弹窗 */
  onExitAccount: () => void;
  /** 切静音，返回切换后的静音态（音效 + BGM 由 app 统一持有） */
  onSound: () => boolean;
  /** 全屏切换（app 侧走 Boot.toggleFullscreen） */
  onFullscreen: () => void;
}

/** 表格六列的列心横坐标（行宽 690；左端 -345 起 33px 处留给锁图标） */
const COLS = {
  id: -235,
  name: -105,
  blind: 18,
  humans: 135,
  state: 215,
  act: 269,
};
const ROW_TOP = 110;
const ROW_STEP = 52;
const ROW_COUNT = 7;

/** 导航/圆钮小图标（Graphics 剪影，替代系统 emoji；颜色由调用方注入 Graphics） */
const NAV_PAINTERS: Record<string, (g: Graphics) => void> = {
  // 房子：三角顶 + 墙体
  house: (g) => {
    g.moveTo(-9.5, 1);
    g.lineTo(0, -9);
    g.lineTo(9.5, 1);
    g.close();
    g.fill();
    g.roundRect(-6.5, 1, 13, 10, 1.5);
    g.fill();
  },
  // 加号：两根圆头粗条交叉
  plus: (g) => {
    g.roundRect(-9, -2.6, 18, 5.2, 2.6);
    g.fill();
    g.roundRect(-2.6, -9, 5.2, 18, 2.6);
    g.fill();
  },
  // 人像：圆头 + 半圆肩
  person: (g) => {
    g.circle(0, -3.5, 4.4);
    g.fill();
    g.moveTo(-8.5, 10);
    g.arc(0, 10, 8.5, Math.PI, 0, true);
    g.close();
    g.fill();
  },
  // 柱状图：三根高低柱（战绩）
  bars: (g) => {
    g.roundRect(-9, -1, 5, 9, 1.5);
    g.fill();
    g.roundRect(-2.5, -6, 5, 14, 1.5);
    g.fill();
    g.roundRect(4, -10, 5, 18, 1.5);
    g.fill();
  },
  // 刷新：270° 圆弧 + 箭头（手绘，替代素材圆钮）
  refresh: (g) => {
    g.lineWidth = 3;
    g.arc(0, 0, 8, Math.PI * 0.35, Math.PI * 1.75, false);
    g.stroke();
    g.moveTo(8.9, -2.5);
    g.lineTo(3.9, -3.9);
    g.lineTo(7.5, -7.5);
    g.close();
    g.fill();
  },
  // 放大镜：圆环 + 斜柄（搜索框左端）
  search: (g) => {
    g.lineWidth = 2.6;
    g.circle(-2.5, 2.5, 6.5);
    g.stroke();
    g.lineWidth = 3.2;
    g.moveTo(2.5, -2.5);
    g.lineTo(8, -8);
    g.stroke();
  },
};

/** 手绘面板：与左导航同族配色（墨绿底 #10261C + 金边 + 内侧白高光 + 下部渐暗）。
 *  用户要求中央房间列表区的背景 / 搜索框 / 刷新钮不再用雪碧图元素 */
function drawNavPanel(g: Graphics, w: number, h: number, r: number, fillAlpha = 205): void {
  g.clear();
  g.fillColor = new Color(16, 38, 28, fillAlpha);
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill();
  g.fillColor = new Color(6, 12, 9, 70);
  g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h / 4, Math.max(4, r / 2));
  g.fill();
  g.lineWidth = 1;
  g.strokeColor = new Color(255, 255, 255, 26);
  g.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, Math.max(4, r - 3));
  g.stroke();
  g.lineWidth = 2;
  g.strokeColor = THEME.gold;
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.stroke();
}

/** 圆钮底：深色圆面 + 金描边（无素材帧时的回退画法），r 默认 20 */
function circleBase(host: Node, r = 20): Graphics {
  const g = host.addComponent(Graphics);
  g.fillColor = new Color(24, 30, 42, 170);
  g.circle(0, 0, r);
  g.fill();
  g.lineWidth = 2;
  g.strokeColor = THEME.gold;
  g.circle(0, 0, r);
  g.stroke();
  return g;
}

/** 在宿主的独立子节点里画一个 NAV_PAINTERS 图标（x/y 为图标中心偏移） */
function paintIcon(
  host: Node,
  painter: (g: Graphics) => void,
  color: Color,
  x = 0,
  y = 0,
): void {
  const n = createNode("gicon", host, 26, 26);
  n.setPosition(x, y);
  const g = n.addComponent(Graphics);
  g.fillColor = color;
  g.strokeColor = color;
  g.lineWidth = 2.5;
  painter(g);
}

/** 标题黑桃：Graphics 贝塞尔剪影（金色），替代文字 emoji ♠ */
function drawSpade(g: Graphics, size: number, color: Color): void {
  const s = size / 22;
  g.fillColor = color;
  // 桃身：上双瓣 + 下收尖
  g.moveTo(0, -3 * s);
  g.bezierCurveTo(-9 * s, 2 * s, -9.5 * s, 10 * s, -4 * s, 10 * s);
  g.bezierCurveTo(-1.5 * s, 10 * s, 0, 7.5 * s, 0, 5 * s);
  g.bezierCurveTo(0, 7.5 * s, 1.5 * s, 10 * s, 4 * s, 10 * s);
  g.bezierCurveTo(9.5 * s, 10 * s, 9 * s, 2 * s, 0, -3 * s);
  g.close();
  g.fill();
  // 桃柄：上窄下宽的梯形
  g.moveTo(-1.6 * s, -4 * s);
  g.lineTo(1.6 * s, -4 * s);
  g.lineTo(4.8 * s, -11 * s);
  g.lineTo(-4.8 * s, -11 * s);
  g.close();
  g.fill();
}

/**
 * 登录后的大厅（1280×720，按用户首页效果图布局）：
 * 池塘夜景背景 + 顶栏（头像/昵称/战绩 + 右上 4 圆钮）+ 左导航 4 项 +
 * 中央房间表格（搜索 / 刷新 / 6 列 8 行缓存行）+ 底部 创建房间 / 快速加入。
 * 素材取 home-ui.webp 雪碧图，任一帧缺失回退 Theme 代码绘制。
 * 快速加入不发协议：客户端挑第一个没满的房加入，空则建房。
 */
export class Lobby {
  readonly node: Node;
  private readonly handlers: LobbyHandlers;
  private readonly contentRooms: Node;
  private readonly contentRecord: Node;
  private readonly rows: RowView[] = [];
  private readonly navItems: Array<{ node: Node; redraw: () => void }> = [];
  private navSel: boolean[] = [true, false, false, false];
  private readonly searchBox: EditBox;
  private readonly countLabel: { string: (s: string) => void };
  private readonly nameLabels: Array<(s: string) => void> = [];
  private soundFace: Node | null = null;
  private soundSlash: Node | null = null;
  private soundGlyph: ReturnType<typeof createIcon> | null = null;
  private readonly emptyHint!: Node;
  private recName!: ReturnType<typeof createLabel>;
  private recStats!: ReturnType<typeof createLabel>;
  private tab: LobbyTab = "rooms";
  private rooms: RoomInfo[] = [];
  private account: { name: string; won: number; played: number } | null = null;
  private muted = false;

  constructor(parent: Node, handlers: LobbyHandlers) {
    this.handlers = handlers;
    this.node = createNode("lobby", parent, 1280, 720);

    this.buildBg();
    this.buildTopBar();
    this.buildNav();

    // ---------- 中央面板：房间表格 / 战绩页 二选一 ----------
    // 手绘面板（用户要求不再用雪碧图元素）：748×528 横向居中于「左导航右缘 ~
    // 屏幕右缘」之间（cocos x=104），纵向落在顶栏圆钮下缘与底部大钮上缘之间
    // （y=15 → 279..-249），不遮顶栏四圆钮、不压底部按钮
    const panel = createNode("panel", this.node, 748, 528);
    panel.setPosition(104, 15);
    drawNavPanel(panel.addComponent(Graphics), 748, 528, 22);
    this.contentRooms = createNode("contentRooms", panel);
    this.contentRecord = createNode("contentRecord", panel);
    this.contentRecord.active = false;

    const title = createLabel(
      this.contentRooms,
      "德州扑克",
      28,
      THEME.goldBright,
      true,
    );
    title.node.setPosition(-270, 228);
    title.node.anchorX = 0;
    const sub = createLabel(
      this.contentRooms,
      "公开房间 · 点「加入」直接进桌（满员自动观战）",
      13,
      THEME.textDim,
    );
    sub.node.setPosition(-270, 200);
    sub.node.anchorX = 0;

    // 搜索 + 刷新 + 计数（手绘：墨绿玻璃感搜索框 + 左端放大镜 + 金圈刷新圆钮）
    const searchHost = createNode("searchBox", this.contentRooms, 300, 44);
    searchHost.setPosition(136, 164);
    drawNavPanel(searchHost.addComponent(Graphics), 300, 44, 12, 190);
    paintIcon(searchHost, NAV_PAINTERS.search, THEME.goldBright, -126, 0);
    const editNode = createNode("edit", searchHost, 240, 40);
    editNode.setPosition(24, 0);
    this.searchBox = editNode.addComponent(EditBox);
    this.searchBox.maxLength = 12;
    const ph = createLabel(editNode, "搜索房间号 / 房名", 15, THEME.textDim);
    ph.node.setPosition(-108, 0);
    ph.node.anchorX = 0;
    const tl = createLabel(editNode, "", 15, THEME.textBright);
    tl.node.setPosition(-108, 0);
    tl.node.anchorX = 0;
    this.searchBox.placeholderLabel = ph;
    this.searchBox.textLabel = tl;
    for (const name of ["PLACEHOLDER_LABEL", "TEXT_LABEL"]) {
      const orphan = editNode.getChildByName(name);
      if (orphan && orphan !== ph.node && orphan !== tl.node) {
        orphan.destroy();
        orphan.removeFromParent();
      }
    }
    editNode.on("editing-did-ended", () => this.refreshRows());

    const refresh = createNode("btnRefresh", this.contentRooms, 44, 44);
    refresh.setPosition(290, 164);
    circleBase(refresh, 20);
    paintIcon(refresh, NAV_PAINTERS.refresh, THEME.goldBright);
    refresh.on(Node.EventType.TOUCH_END, () => {
      tween(refresh)
        .to(0.16, { angle: 360 })
        .call(() => refresh.setRotationFromEuler(0, 0, 0))
        .start();
      handlers.onRefresh();
    });
    const count = createLabel(this.contentRooms, "", 13, THEME.textDim);
    count.node.setPosition(-180, 164);
    this.countLabel = { string: (s: string) => (count.string = s) };

    // 表头
    const headY = 124;
    const headers: Array<[string, number]> = [
      ["房间号", COLS.id],
      ["房间名称", COLS.name],
      ["底注", COLS.blind],
      ["人数", COLS.humans],
      ["状态", COLS.state],
      ["操作", COLS.act],
    ];
    headers.forEach(([text, x]) => {
      // 效果图表头是浅金字；textDim 在深底上发灰，对比不够
      const h = createLabel(this.contentRooms, text, 14, THEME.gold, true);
      h.node.setPosition(x, headY);
    });

    // 8 行缓存（setRooms 只重填不重建）
    for (let i = 0; i < ROW_COUNT; i++) {
      this.rows.push(
        new RowView(this.contentRooms, ROW_TOP - i * ROW_STEP, (id) =>
          handlers.onJoinRoom(id),
        ),
      );
    }

    // 空列表提示：效果图里的绿色横幅（bannerGreen）+ 引导文案，落在行区下方
    this.emptyHint = createNode("emptyHint", this.contentRooms, 420, 76);
    this.emptyHint.setPosition(0, -180);
    if (homeFrame("bannerGreen")) {
      attachHomeUi(this.emptyHint, "bannerGreen", 420, 76);
    } else {
      const eg = this.emptyHint.addComponent(Graphics);
      eg.fillColor = new Color(26, 68, 44, 185);
      eg.roundRect(-210, -38, 420, 76, 16);
      eg.fill();
      eg.lineWidth = 1.5;
      eg.strokeColor = THEME.gold;
      eg.roundRect(-210, -38, 420, 76, 16);
      eg.stroke();
    }
    const emptyText = createLabel(
      this.emptyHint,
      "还没有房间 — 点下方「创建房间」，开始你的游戏之旅",
      16,
      THEME.textBright,
      true,
    );
    emptyText.node.setPosition(0, 0);

    // 战绩页
    this.buildRecordPage();

    // 底部：创建房间 + 快速加入（效果图里两钮贴着面板下缘，文案烧在素材图上不叠字）
    const create = attachHomeUi(this.node, "btnCreate", 300, 74);
    create.setPosition(-160, -300);
    if (!homeFrame("btnCreate")) {
      const b = createButton(
        this.node,
        "创建房间",
        280,
        66,
        shade(THEME.call, 1.35),
        22,
      );
      b.node.setPosition(-160, -300);
    }
    create.on(Node.EventType.TOUCH_END, () => handlers.onCreateRoom());
    const quick = attachHomeUi(this.node, "btnQuick", 284, 74);
    quick.setPosition(168, -300);
    if (!homeFrame("btnQuick")) {
      const b = createButton(
        this.node,
        "快速加入",
        264,
        66,
        shade(THEME.raise, 1.15),
        22,
      );
      b.node.setPosition(168, -300);
    }
    quick.on(Node.EventType.TOUCH_END, () => this.quickJoin());

    // 吉祥物点缀（效果图在右下角、挨着快速加入；缺图静默跳过）
    if (homeFrame("mascot")) {
      attachHomeUi(this.node, "mascot", 116, 110).setPosition(560, -296);
    }
  }

  private buildBg(): void {
    const bg = attachHomeUi(this.node, "bg", 1280, 720);
    bg.setPosition(0, 0);
    if (!homeFrame("bg")) {
      const g = bg.addComponent(Graphics);
      g.fillColor = shade(THEME.feltRim, 0.55);
      g.rect(-640, -360, 1280, 720);
      g.fill();
      g.fillColor = new Color(8, 11, 18, 120);
      g.rect(-640, -360, 1280, 720);
      g.fill();
    }
    // 轻压暗：保留效果图黄昏暖调（文字对比靠深绿面板自身，不靠整体压黑）
    const dim = createNode("bgDim", this.node, 1280, 720);
    const dg = dim.addComponent(Graphics);
    dg.fillColor = new Color(10, 13, 22, 46);
    dg.rect(-640, -360, 1280, 720);
    dg.fill();
  }

  private buildTopBar(): void {
    // 左：玩家信息条。素材里已烧死「金环乌龟头像 + 金币图标」（dx0..140 环、
    // dx388..410 金币），严禁再叠头像——旧版叠了 avatarRing+turtle 变双头像。
    // 尺寸按效果图：303×108（缩到 1280 画布 ≈ 232×83）。
    const bar = attachHomeUi(this.node, "playerBar", 232, 83);
    bar.setPosition(-492, 303);
    if (!homeFrame("playerBar")) {
      drawGlassPanel(bar.addComponent(Graphics), 232, 83, 30);
    }
    const name = createLabel(bar, "游客", 16, THEME.textBright, true);
    name.node.setPosition(-14, 16);
    name.node.anchorX = 0;
    const stat = createLabel(bar, "登录后保存战绩", 14, THEME.goldBright);
    stat.node.setPosition(88, -16);
    stat.node.anchorX = 1;
    this.nameLabels.push(
      (s: string) => (name.string = s),
      (s: string) => (stat.string = s),
    );

    // 右：声音 / 全屏 / 战绩 / 退出。位置按效果图四钮圆心（×0.7655 落到
    // 1280 画布：x=371/434/496/559、y≈310、直径 46），不再贴死右边缘。
    const mkIconBtn = (
      x: number,
      name: string,
      draw: (host: Node) => void,
      onTap: () => void,
    ): Node => {
      const node = createNode(name, this.node, 46, 46);
      node.setPosition(x, 310);
      draw(node);
      node.on(Node.EventType.TOUCH_END, () => {
        Tween.stopAllByTarget(node);
        tween(node)
          .to(0.12, { scale: new Vec3(0.9, 0.9, 1) })
          .to(0.18, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
          .start();
        onTap();
      });
      return node;
    };
    mkIconBtn(
      370,
      "btnSound",
      (host) => {
        if (homeFrame("iconSound")) {
          // 素材帧自带金环 + 手绘喇叭；静音时叠红斜杠并整体调灰
          this.soundFace = attachHomeUi(host, "iconSound", 46, 46);
          this.soundSlash = createNode("muteSlash", host, 46, 46);
          const sg = this.soundSlash.addComponent(Graphics);
          sg.lineWidth = 3.5;
          sg.strokeColor = new Color(255, 96, 82);
          sg.moveTo(-13, 13);
          sg.lineTo(13, -13);
          sg.stroke();
          this.soundSlash.active = false;
        } else {
          circleBase(host, 21);
          this.soundGlyph = createIcon(
            host,
            ICON.volumeOn,
            19,
            THEME.goldBright,
          );
        }
      },
      () => {
        this.muted = this.handlers.onSound();
        this.setMuted(this.muted);
      },
    );
    mkIconBtn(
      433,
      "btnFull",
      (host) => {
        if (homeFrame("iconFullscreen")) {
          attachHomeUi(host, "iconFullscreen", 46, 46);
        } else {
          circleBase(host, 21);
          createIcon(host, ICON.expand, 16, THEME.goldBright);
        }
      },
      () => this.handlers.onFullscreen(),
    );
    mkIconBtn(
      495,
      "btnRecord",
      (host) => {
        circleBase(host, 21);
        paintIcon(host, NAV_PAINTERS.bars, THEME.goldBright);
      },
      () => this.setTab("record"),
    );
    mkIconBtn(
      558,
      "btnExit",
      (host) => {
        // 退出 = 开门走人：门板 + 门把 + 向外箭头（电源符号太抽象，被吐槽看不懂）
        const g = circleBase(host, 21);
        g.lineWidth = 2.6;
        g.strokeColor = THEME.goldBright;
        g.fillColor = THEME.goldBright;
        // 门框（左开）
        g.roundRect(-10, -11, 12, 22, 2);
        g.stroke();
        // 门把
        g.circle(-1.5, 0, 1.3);
        g.fill();
        // 向外箭头
        g.moveTo(2, 0);
        g.lineTo(10.5, 0);
        g.stroke();
        g.moveTo(7, 3.6);
        g.lineTo(11.6, 0);
        g.lineTo(7, -3.6);
        g.close();
        g.fill();
      },
      () => this.handlers.onExitAccount(),
    );
  }

  private buildNav(): void {
    // 背板：效果图左栏是一块带金边的墨绿板，先垫底再摆导航项
    const navBg = createNode("navBg", this.node, 178, 274);
    navBg.setPosition(-520, 66);
    const ng = navBg.addComponent(Graphics);
    ng.fillColor = new Color(16, 38, 28, 178);
    ng.roundRect(-89, -137, 178, 274, 18);
    ng.fill();
    ng.lineWidth = 1.5;
    ng.strokeColor = THEME.gold;
    ng.roundRect(-89, -137, 178, 274, 18);
    ng.stroke();

    const items: Array<{ icon: string; label: string; action: () => void }> = [
      { icon: "house", label: "房间列表", action: () => this.setTab("rooms") },
      {
        icon: "plus",
        label: "创建房间",
        action: () => this.handlers.onCreateRoom(),
      },
      { icon: "person", label: "我的房间", action: () => this.setTab("mine") },
      { icon: "bars", label: "战绩记录", action: () => this.setTab("record") },
    ];
    this.navSel = [true, false, false, false];
    items.forEach((it, i) => {
      const node = createNode("nav", this.node, 150, 52);
      node.setPosition(-520, 165 - i * 66);
      const g = node.addComponent(Graphics);
      const icon = createNode("navIcon", node, 26, 26);
      icon.setPosition(-44, 0);
      const ig = icon.addComponent(Graphics);
      const label = createLabel(node, it.label, 15, THEME.textBright, true);
      label.node.setPosition(11, 0);
      const redraw = (): void => {
        const on = this.navSel[i];
        g.clear();
        g.fillColor = on
          ? new Color(217, 164, 65, 52)
          : new Color(20, 25, 36, 150);
        g.roundRect(-72, -24, 144, 48, 16);
        g.fill();
        g.lineWidth = on ? 2 : 1;
        g.strokeColor = on ? THEME.gold : new Color(255, 255, 255, 30);
        g.roundRect(-72, -24, 144, 48, 16);
        g.stroke();
        label.color = on ? THEME.goldBright : THEME.textDim;
        ig.clear();
        const c = on ? THEME.goldBright : THEME.textDim;
        ig.fillColor = c;
        ig.strokeColor = c;
        ig.lineWidth = 2.5;
        NAV_PAINTERS[it.icon](ig);
      };
      redraw();
      this.navItems.push({ node, redraw });
      node.on(Node.EventType.TOUCH_END, () => {
        // 创建房间是动作不是页签：点完仍回到列表页
        const isAction = i === 1;
        this.navSel.forEach(
          (_, j) => (this.navSel[j] = isAction ? j === 0 : j === i),
        );
        this.navItems.forEach((n) => n.redraw());
        it.action();
      });
    });
  }

  private buildRecordPage(): void {
    const title = createLabel(
      this.contentRecord,
      "战绩记录",
      30,
      THEME.goldBright,
      true,
    );
    title.node.setPosition(0, 236);
    const hint = createLabel(
      this.contentRecord,
      "账号生涯口径：每打完一手记 1 手，赢家再记 1 胜",
      14,
      THEME.textDim,
    );
    hint.node.setPosition(0, 204);
    this.recName = createLabel(
      this.contentRecord,
      "游客（战绩不保存）",
      26,
      THEME.textBright,
      true,
    );
    this.recName.node.setPosition(0, 120);
    this.recStats = createLabel(
      this.contentRecord,
      "登录 / 注册后这里显示生涯战绩",
      20,
      THEME.goldBright,
      true,
    );
    this.recStats.node.setPosition(0, 60);
    const back = createGlassButton(
      this.contentRecord,
      "返回房间列表",
      200,
      48,
      18,
      THEME.textBright,
    );
    back.node.setPosition(0, -60);
    back.node.on(Node.EventType.TOUCH_END, () => this.setTab("rooms"));
  }

  // ---------- 对外接口 ----------

  show(): void {
    this.node.active = true;
  }

  hide(): void {
    this.node.active = false;
  }

  setAccount(name: string, won: number, played: number): void {
    this.account = { name, won, played };
    if (this.nameLabels.length) {
      this.nameLabels[0](name);
      this.nameLabels[1](`生涯 胜 ${won} · 手 ${played}`);
    }
    this.renderRecord();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.soundFace) {
      if (this.soundSlash) {
        this.soundSlash.active = muted;
      }
      const sp = this.soundFace.getComponent(Sprite);
      if (sp) {
        sp.color = muted ? new Color(150, 155, 165) : Color.WHITE;
      }
    } else if (this.soundGlyph) {
      setIconChar(
        this.soundGlyph,
        muted ? ICON.volumeOff : ICON.volumeOn,
        muted ? THEME.textDim : THEME.goldBright,
      );
    }
  }

  setRooms(rooms: RoomInfo[]): void {
    this.rooms = rooms;
    this.refreshRows();
  }

  setTab(tab: LobbyTab): void {
    this.tab = tab;
    this.contentRooms.active = tab !== "record";
    this.contentRecord.active = tab === "record";
    // 页签高亮与当前页同步（创建房间是动作项，保持列表页选中）
    const idx = tab === "rooms" ? 0 : tab === "mine" ? 2 : 3;
    this.navSel.forEach((_, j) => (this.navSel[j] = j === idx));
    this.navItems.forEach((n) => n.redraw());
    this.refreshRows();
  }

  /** 快速加入：挑第一个没满的房；全满或没有房就建房 */
  private quickJoin(): void {
    const target = this.rooms.find((r) => r.humans < r.seats);
    if (target) {
      this.handlers.onJoinRoom(target.id);
    } else {
      this.handlers.onCreateRoom();
    }
  }

  private filtered(): RoomInfo[] {
    let list = this.rooms;
    if (this.tab === "mine") {
      list = list.filter((r) => r.mine);
    }
    const q = (this.searchBox?.string ?? "").trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) => r.name.toLowerCase().includes(q) || r.id.includes(q),
      );
    }
    return list;
  }

  private refreshRows(): void {
    const list = this.filtered();
    this.rows.forEach((row, i) => row.fill(list[i] ?? null));
    this.emptyHint.active = list.length === 0;
    this.countLabel.string(
      this.tab === "mine"
        ? `我的房间 ${list.length} 间`
        : `共 ${this.rooms.length} 间${list.length > ROW_COUNT ? `，显示前 ${ROW_COUNT} 间` : ""}`,
    );
  }

  private renderRecord(): void {
    if (!this.recName || !this.recStats) {
      return;
    }
    if (this.account) {
      const { name, won, played } = this.account;
      const rate = played > 0 ? Math.round((won / played) * 100) : 0;
      this.recName.string = name;
      this.recStats.string = `总手数 ${played} · 胜 ${won} · 胜率 ${rate}%`;
    } else {
      this.recName.string = "游客（战绩不保存）";
      this.recStats.string = "登录 / 注册后这里显示生涯战绩";
    }
  }
}

/**
 * 一行房间（手绘，与面板 / 导航同族配色）：墨绿圆角底条 + 六列文字 +
 * 左端挂锁（仅密码房显示）+ 右端金底「加入」胶囊（满员灰底「已满」）。
 * 整行可点。fill(null) 整行隐藏。
 */
class RowView {
  readonly node: Node;
  private readonly idL: ReturnType<typeof createLabel>;
  private readonly nameL: ReturnType<typeof createLabel>;
  private readonly blindL: ReturnType<typeof createLabel>;
  private readonly humansL: ReturnType<typeof createLabel>;
  private readonly stateL: ReturnType<typeof createLabel>;
  private readonly lockNode: Node;
  private readonly joinG: Graphics;
  private readonly joinLabel: ReturnType<typeof createLabel>;
  private roomId = "";

  constructor(parent: Node, y: number, onJoin: (id: string) => void) {
    this.node = createNode("row", parent, 690, 50);
    this.node.setPosition(0, y);
    const g = this.node.addComponent(Graphics);
    g.fillColor = new Color(22, 46, 34, 165);
    g.roundRect(-345, -25, 690, 50, 14);
    g.fill();
    g.lineWidth = 1;
    g.strokeColor = new Color(255, 255, 255, 26);
    g.roundRect(-345, -25, 690, 50, 14);
    g.stroke();
    // 挂锁图标：密码房才显示（金色剪影）
    this.lockNode = createNode("lockIcon", this.node, 26, 26);
    this.lockNode.setPosition(-312, 0);
    const lg = this.lockNode.addComponent(Graphics);
    lg.fillColor = THEME.goldBright;
    lg.strokeColor = THEME.goldBright;
    drawLockGlyph(lg);
    this.lockNode.active = false;
    // 房间号用亮白粗体：旧版 textDim 灰字压在深绿底上对比不足
    this.idL = createLabel(this.node, "", 15, THEME.textBright, true);
    this.idL.node.setPosition(COLS.id, 0);
    this.nameL = createLabel(this.node, "", 16, THEME.textBright, true);
    this.nameL.node.setPosition(COLS.name, 0);
    this.blindL = createLabel(this.node, "", 15, THEME.textBright);
    this.blindL.node.setPosition(COLS.blind, 0);
    this.humansL = createLabel(this.node, "", 15, THEME.textBright);
    this.humansL.node.setPosition(COLS.humans, 0);
    this.stateL = createLabel(this.node, "", 15, THEME.textBright);
    this.stateL.node.setPosition(COLS.state, 0);
    // 加入胶囊（手绘金底深字，满员换灰底白字）
    const join = createNode("joinBtn", this.node, 104, 36);
    join.setPosition(COLS.act, 0);
    this.joinG = join.addComponent(Graphics);
    this.joinLabel = createLabel(join, "", 15, new Color(64, 44, 14), true);
    // 整行可点（点行 = 加入），比只点小按钮的手感好
    this.node.on(Node.EventType.TOUCH_END, () => {
      if (this.roomId) {
        onJoin(this.roomId);
      }
    });
  }

  fill(r: RoomInfo | null): void {
    this.node.active = !!r;
    if (!r) {
      this.roomId = "";
      return;
    }
    this.roomId = r.id;
    this.idL.string = r.id;
    this.nameL.string = r.name;
    this.blindL.string = `${r.smallBlind}/${r.bigBlind}`;
    this.humansL.string = `${r.humans}/${r.seats}`;
    const full = r.humans >= r.seats;
    this.stateL.string = full ? "已满" : r.inHand ? "游戏中" : "等待中";
    this.stateL.color = full
      ? THEME.textDim
      : r.inHand
        ? shade(THEME.call, 1.5)
        : THEME.textBright;
    this.lockNode.active = !!r.locked;
    this.joinG.clear();
    this.joinG.fillColor = full ? new Color(70, 78, 92, 190) : THEME.gold;
    this.joinG.roundRect(-52, -18, 104, 36, 18);
    this.joinG.fill();
    if (!full) {
      // 金面顶部高光一条，呼应导航选中态
      this.joinG.fillColor = new Color(255, 255, 255, 46);
      this.joinG.roundRect(-44, 1, 88, 12, 6);
      this.joinG.fill();
    }
    this.joinLabel.string = full ? "已满" : "加入";
    this.joinLabel.color = full ? THEME.textBright : new Color(64, 44, 14);
  }
}
