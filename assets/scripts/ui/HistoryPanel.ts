import { Color, EventTouch, Graphics, Label, Node, Sprite, SpriteFrame, tween, UITransform, Vec3 } from "cc";
import { Card } from "../core/Card";
import { CardJ, HandRecordJ } from "../net/Protocol";
import { frameOfCard } from "./CardFaces";
import { createGlassButton, createLabel, createNode, drawGlassPanel, THEME } from "./Theme";

/** 悬浮框尺寸（Fit Height 720 设计坐标）；一页 1 手整块展示，牌统一做大保证手机可读 */
const PANEL_W = 760;
const PANEL_H = 560;
const PAGE_SIZE = 1;
const BLOCK_H = 430;
const BLOCK_W = PANEL_W - 48;
/** 牌尺寸与间距（公共牌 / 赢家底牌 / 其余玩家底牌统一） */
const CARD_W = 50;
const CARD_H = 70;
const CARD_PITCH = 55;
/** 赢家组并排上限（三人平分以内；更多极其罕见，末位显示「等」计数） */
const MAX_WINNER_GROUPS = 3;
/** 其余玩家每行组数：两行 8 槽，满员 8 人桌也全员亮牌，不再出现「等 N 人」 */
const OTHERS_PER_ROW = 4;

/** 一张小牌：优先雪碧图，缺图回退白底圆角 + 点数花色文字 */
function miniCard(parent: Node, c: CardJ, x: number, y: number, w: number, h: number): void {
  const n = createNode("mini", parent, w, h);
  n.setPosition(x, y);
  const card = new Card(c.r, c.s);
  const frame = frameOfCard(card);
  if (frame) {
    const sp = n.addComponent(Sprite);
    sp.type = Sprite.Type.SIMPLE;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = frame as SpriteFrame;
    return;
  }
  const g = n.addComponent(Graphics);
  g.fillColor = new Color(245, 240, 220, 255);
  g.roundRect(-w / 2, -h / 2, w, h, 4);
  g.fill();
  const color = card.isRed ? THEME.inkRed : THEME.inkBlack;
  const fs = Math.round(w * 0.34);
  for (const [txt, dy] of [[card.rankLabel, h * 0.18], [card.suitLabel, -h * 0.18]] as const) {
    createLabel(n, txt, fs, color, true).node.setPosition(0, dy);
  }
}

/** 名字截断（名字在牌正上方，超长名截 4 字） */
const clipName = (name: string): string => (name.length > 4 ? `${name.slice(0, 4)}…` : name);

/**
 * 对局记录悬浮框：分页展示当前对局的历史手牌——
 * 每手一整块：结算标题（与局末横幅同口径）+ 公共牌 + 赢家底牌 + 其余玩家底牌（复盘，同尺寸大牌）；
 * 点遮罩或「关闭」收起，上一页 / 下一页翻页（手机上比拖动滚动好点）。
 */
export class HistoryPanel {
  readonly node: Node;
  private readonly listHost: Node;
  private readonly pageLabel: Label;
  private hands: HandRecordJ[] = [];
  private page = 0;
  private readonly whenClose: () => void;

  constructor(parent: Node, onClose: () => void) {
    this.whenClose = onClose;
    this.node = createNode("historyPanel", parent);
    // 全屏遮罩：点面板外关闭（面板本体拦截事件，落在面板内的触摸不会到这里）
    const mask = createNode("mask", this.node, 1280, 720);
    mask.addComponent(Graphics).fillColor = new Color(8, 11, 18, 150);
    const mg = mask.getComponent(Graphics)!;
    mg.fillRect(-640, -360, 1280, 720);
    mask.on(Node.EventType.TOUCH_END, () => this.close());

    const panel = createNode("panel", this.node, PANEL_W, PANEL_H);
    drawGlassPanel(panel.addComponent(Graphics), PANEL_W, PANEL_H, 22);
    // 面板本体吞掉触摸：避免点在面板空白处被当成「点遮罩关闭」
    panel.on(Node.EventType.TOUCH_END, (ev: EventTouch) => { ev.propagationStopped = true; });

    const title = createLabel(panel, "对局记录", 24, THEME.goldBright, true);
    title.node.setPosition(0, 252);
    const closeBtn = createGlassButton(panel, "关闭", 76, 32, 15);
    closeBtn.node.setPosition(322, 252);
    closeBtn.node.on(Node.EventType.TOUCH_END, () => this.close());

    this.listHost = createNode("list", panel, BLOCK_W, BLOCK_H * PAGE_SIZE);
    this.listHost.setPosition(0, 16);
    const prev = createGlassButton(panel, "上一页", 84, 32, 14);
    prev.node.setPosition(-120, -246);
    prev.node.on(Node.EventType.TOUCH_END, () => this.turn(-1));
    this.pageLabel = createLabel(panel, "", 13, THEME.textDim);
    this.pageLabel.node.setPosition(0, -246);
    const next = createGlassButton(panel, "下一页", 84, 32, 14);
    next.node.setPosition(120, -246);
    next.node.on(Node.EventType.TOUCH_END, () => this.turn(1));

    panel.setScale(0.82, 0.82, 1);
    tween(panel).to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" }).start();
  }

  /** 展示记录（最新在前），回到第一页 */
  show(hands: HandRecordJ[]): void {
    this.hands = hands;
    this.page = 0;
    this.render();
  }

  /** 销毁悬浮框（destroy 是帧末生效，同步摘下节点避免残留拦截触摸） */
  hide(): void {
    this.node.removeFromParent();
    this.node.destroy();
  }

  /** 关闭：销毁自身并通知调用方清引用（此前漏绑这里导致面板关不掉） */
  private close(): void {
    this.hide();
    this.whenClose();
  }

  private turn(delta: number): void {
    const pages = Math.max(1, Math.ceil(this.hands.length / PAGE_SIZE));
    const next = Math.min(pages - 1, Math.max(0, this.page + delta));
    if (next !== this.page) {
      this.page = next;
      this.render();
    }
  }

  private render(): void {
    for (const child of [...this.listHost.children]) {
      child.destroy();
      child.removeFromParent();
    }
    if (this.hands.length === 0) {
      createLabel(this.listHost, "还没有打完的手牌", 16, THEME.textDim).node.setPosition(0, 0);
    } else {
      this.hands.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE).forEach((h, i) => {
        this.buildBlock(h, (BLOCK_H * PAGE_SIZE) / 2 - BLOCK_H / 2 - i * BLOCK_H);
      });
    }
    const pages = Math.max(1, Math.ceil(this.hands.length / PAGE_SIZE));
    this.pageLabel.string = this.hands.length ? `${this.page + 1}/${pages} 页 · 共 ${this.hands.length} 手` : "共 0 手";
  }

  /**
   * 一手记录区块（自上而下）：标题 / 明细 / 主牌行（公共牌 + 赢家底牌）/ 其余玩家行。
   * 全部牌同尺寸，名字放在各自牌正上方，互不遮挡。
   */
  private buildBlock(h: HandRecordJ, y: number): void {
    const block = createNode("hand", this.listHost, BLOCK_W, BLOCK_H - 10);
    block.setPosition(0, y);
    const g = block.addComponent(Graphics);
    g.fillColor = new Color(14, 19, 30, 170);
    g.roundRect(-BLOCK_W / 2, -(BLOCK_H - 10) / 2, BLOCK_W, BLOCK_H - 10, 12);
    g.fill();
    g.lineWidth = 1;
    g.strokeColor = THEME.gold;
    g.roundRect(-BLOCK_W / 2, -(BLOCK_H - 10) / 2, BLOCK_W, BLOCK_H - 10, 12);
    g.stroke();

    const left = -BLOCK_W / 2 + 14;
    const leftLabel = (text: string, size: number, color: Color, bold: boolean, x: number, y: number): void => {
      const label = createLabel(block, text, size, color, bold);
      label.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
      label.node.setPosition(x, y);
    };
    leftLabel(`第 ${h.handNo} 手 · ${h.title}`, 17, THEME.goldBright, true, left, 192);
    const detailRaw = h.lines.join("；");
    leftLabel(detailRaw.length > 52 ? `${detailRaw.slice(0, 52)}…` : detailRaw, 12, THEME.textDim, false, left, 174);

    // 主牌行：左公共牌 + 竖分隔线 + 右赢家底牌（名字在各自牌正上方）
    createLabel(block, "公共牌", 11, THEME.textDim).node.setPosition(-220, 150);
    const mainY = 108;
    h.community.forEach((c, i) => miniCard(block, c, -330 + i * CARD_PITCH, mainY, CARD_W, CARD_H));
    g.strokeColor = new Color(255, 255, 255, 55);
    g.moveTo(-62, 70);
    g.lineTo(-62, 146);
    g.stroke();

    const groups = [{ xs: -2.5, nameX: 25 }, { xs: 132.5, nameX: 160 }, { xs: 267.5, nameX: 295 }];
    h.winners.slice(0, MAX_WINNER_GROUPS).forEach((w, i) => {
      createLabel(block, clipName(w.name), 11, THEME.goldBright, true).node.setPosition(groups[i].nameX, 150);
      w.hole.forEach((c, j) => miniCard(block, c, groups[i].xs + j * CARD_PITCH, mainY, CARD_W, CARD_H));
    });
    if (h.winners.length > MAX_WINNER_GROUPS) {
      createLabel(block, `等 ${h.winners.length - MAX_WINNER_GROUPS} 人`, 11, THEME.goldBright, true).node.setPosition(335, 150);
    }

    // 其余玩家：两行最多 8 组 —— 满员桌也全员亮牌复盘（弃牌者 / 摊牌输家），不再截断
    const others = h.others.slice(0, OTHERS_PER_ROW * 2);
    if (others.length > 0) {
      createLabel(block, "其余玩家", 11, THEME.textDim).node.setPosition(0, 44);
    }
    others.forEach((w, i) => {
      const row = Math.floor(i / OTHERS_PER_ROW);
      const col = i % OTHERS_PER_ROW;
      const rowCount = Math.min(OTHERS_PER_ROW, others.length - row * OTHERS_PER_ROW);
      const center = (col - (rowCount - 1) / 2) * 145;
      const nameY = row === 0 ? 20 : -84;
      const cardY = row === 0 ? -28 : -132;
      createLabel(block, clipName(w.name), 11, THEME.textDim).node.setPosition(center, nameY);
      w.hole.forEach((c, j) => miniCard(block, c, center - 27.5 + j * CARD_PITCH, cardY, CARD_W, CARD_H));
    });
  }
}
