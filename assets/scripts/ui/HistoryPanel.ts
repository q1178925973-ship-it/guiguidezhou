import { Color, EventTouch, Graphics, Label, Node, Sprite, SpriteFrame, tween, UITransform, Vec3 } from "cc";
import { Card } from "../core/Card";
import { CardJ, HandRecordJ } from "../net/Protocol";
import { frameOfCard } from "./CardFaces";
import { createGlassButton, createLabel, createNode, drawGlassPanel, THEME } from "./Theme";

/** 悬浮框尺寸与分页参数（Fit Height 720 下的设计坐标） */
const PANEL_W = 660;
const PANEL_H = 470;
const PAGE_SIZE = 4;
const BLOCK_H = 92;
/** 单手区块宽度 */
const BLOCK_W = PANEL_W - 48;
/** 小牌尺寸与间距 */
const CARD_W = 30;
const CARD_H = 42;
const CARD_PITCH = 35;
/** 最多并排展示的赢家组（平分底池超 2 人极罕见，超出显示「等」） */
const MAX_WINNER_GROUPS = 2;

/** 一张小牌：优先雪碧图，缺图回退白底圆角 + 点数花色文字 */
function miniCard(parent: Node, c: CardJ, x: number, y: number): void {
  const n = createNode("mini", parent, CARD_W, CARD_H);
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
  g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 4);
  g.fill();
  const color = card.isRed ? THEME.inkRed : THEME.inkBlack;
  const rank = createLabel(n, card.rankLabel, 12, color, true);
  rank.node.setPosition(0, 9);
  const suit = createLabel(n, card.suitLabel, 12, color, true);
  suit.node.setPosition(0, -9);
}

/**
 * 对局记录悬浮框：分页展示当前对局的历史手牌——
 * 每手一条：结算标题（与局末横幅同口径）+ 公共牌 + 各赢家底牌；
 * 点遮罩或「关闭」收起，上一页 / 下一页翻页（手机上比拖动滚动好点）。
 */
export class HistoryPanel {
  readonly node: Node;
  private readonly listHost: Node;
  private readonly pageLabel: Label;
  private hands: HandRecordJ[] = [];
  private page = 0;

  constructor(parent: Node, onClose: () => void) {
    this.node = createNode("historyPanel", parent);
    // 全屏遮罩：点面板外关闭（面板本体拦截事件，落在面板内的触摸不会到这里）
    const mask = createNode("mask", this.node, 1280, 720);
    mask.addComponent(Graphics).fillColor = new Color(8, 11, 18, 150);
    const mg = mask.getComponent(Graphics)!;
    mg.fillRect(-640, -360, 1280, 720);
    mask.on(Node.EventType.TOUCH_END, () => onClose());

    const panel = createNode("panel", this.node, PANEL_W, PANEL_H);
    drawGlassPanel(panel.addComponent(Graphics), PANEL_W, PANEL_H, 22);
    // 面板本体吞掉触摸：避免点在面板空白处被当成「点遮罩关闭」
    panel.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
      ev.propagationStopped = true;
    });

    const title = createLabel(panel, "对局记录", 24, THEME.goldBright, true);
    title.node.setPosition(0, 204);
    createGlassButton(panel, "关闭", 76, 32, 15).node.setPosition(262, 204);

    this.listHost = createNode("list", panel, BLOCK_W, BLOCK_H * PAGE_SIZE);
    this.listHost.setPosition(0, 6);
    const prev = createGlassButton(panel, "上一页", 84, 32, 14);
    prev.node.setPosition(-120, -192);
    prev.node.on(Node.EventType.TOUCH_END, () => this.turn(-1));
    this.pageLabel = createLabel(panel, "", 13, THEME.textDim);
    this.pageLabel.node.setPosition(0, -192);
    const next = createGlassButton(panel, "下一页", 84, 32, 14);
    next.node.setPosition(120, -192);
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
      const empty = createLabel(this.listHost, "还没有打完的手牌", 16, THEME.textDim);
      empty.node.setPosition(0, 0);
    } else {
      this.hands.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE).forEach((h, i) => {
        this.buildBlock(h, BLOCK_H * PAGE_SIZE / 2 - BLOCK_H / 2 - i * BLOCK_H);
      });
    }
    const pages = Math.max(1, Math.ceil(this.hands.length / PAGE_SIZE));
    this.pageLabel.string = this.hands.length ? `${this.page + 1}/${pages} 页 · 共 ${this.hands.length} 手` : "共 0 手";
  }

  /** 一手记录区块：标题行 + 明细行 + （公共牌 | 赢家底牌）卡牌行 */
  private buildBlock(h: HandRecordJ, y: number): void {
    const block = createNode("hand", this.listHost, BLOCK_W, BLOCK_H - 8);
    block.setPosition(0, y);
    const g = block.addComponent(Graphics);
    g.fillColor = new Color(14, 19, 30, 170);
    g.roundRect(-BLOCK_W / 2, -(BLOCK_H - 8) / 2, BLOCK_W, BLOCK_H - 8, 12);
    g.fill();
    g.lineWidth = 1;
    g.strokeColor = THEME.gold;
    g.roundRect(-BLOCK_W / 2, -(BLOCK_H - 8) / 2, BLOCK_W, BLOCK_H - 8, 12);
    g.stroke();

    const title = createLabel(block, `第 ${h.handNo} 手 · ${h.title}`, 16, THEME.goldBright, true);
    title.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    title.node.setPosition(-BLOCK_W / 2 + 14, 28);
    const detailRaw = h.lines.join("；");
    const detail = createLabel(block, detailRaw.length > 42 ? `${detailRaw.slice(0, 42)}…` : detailRaw, 11, THEME.textDim);
    detail.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    detail.node.setPosition(-BLOCK_W / 2 + 14, 11);

    // 卡牌行：左侧公共牌，右侧各赢家底牌
    const cardsY = -17;
    const pub = createLabel(block, "公共牌", 11, THEME.textDim);
    pub.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    pub.node.setPosition(-BLOCK_W / 2 + 14, cardsY + 12);
    h.community.forEach((c, i) => miniCard(block, c, -BLOCK_W / 2 + 62 + i * CARD_PITCH, cardsY));
    let x = 8;
    const shown = h.winners.slice(0, MAX_WINNER_GROUPS);
    shown.forEach((w) => {
      const name = createLabel(block, w.name, 12, THEME.textBright, true);
      name.node.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
      name.node.setPosition(x - 6, cardsY);
      w.hole.forEach((c, j) => miniCard(block, c, x + j * CARD_PITCH, cardsY));
      x += 2 * CARD_PITCH + 56;
    });
    if (h.winners.length > MAX_WINNER_GROUPS) {
      const more = createLabel(block, "等", 12, THEME.textDim);
      more.node.setPosition(x + 10, cardsY);
    }
  }
}
