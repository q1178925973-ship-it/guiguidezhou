import { Graphics, Label, Node, Tween, tween, Vec3 } from "cc";
import { Card } from "../core/Card";
import { CardView } from "./CardView";
import { ChipStackView } from "./ChipView";
import { createIcon, ICON } from "./IconFont";
import { createLabel, createNode, drawGlassPanel, SIZE, THEME } from "./Theme";

/** 公共牌区：5 个牌位 + 底池金额与筹码堆显示 */
export class CommunityView {
  readonly node: Node;
  private readonly cardsHost: Node;
  private readonly potLabel: Label;
  private readonly potChips: ChipStackView;

  constructor(parent: Node, pos: Vec3) {
    this.node = createNode("community", parent);
    this.node.setPosition(pos);
    this.cardsHost = createNode("cards", this.node);
    // 底池：磨砂玻璃药丸 + 金币图标 + 亮白数字（浅色桌呢上裸金字看不清）
    const potRow = createNode("potRow", this.node, 240, 44);
    potRow.setPosition(0, SIZE.comCardH / 2 + 38);
    drawGlassPanel(potRow.addComponent(Graphics), 240, 44, 22);
    createIcon(potRow, ICON.coins, 24, THEME.goldBright).node.setPosition(-84, 0);
    this.potLabel = createLabel(potRow, "底池 0", 24, THEME.textBright, true);
    this.potLabel.node.setPosition(18, 0);
    this.potChips = new ChipStackView(this.node, 11, false);
    this.potChips.node.setPosition(-190, SIZE.comCardH / 2 + 38);
  }

  /** 新一手：清空公共牌与底池筹码 */
  reset(): void {
    this.cardsHost.removeAllChildren();
    this.potChips.setAmount(0);
  }

  /** 发第 index 张公共牌（0~4）：先从牌堆飞入再翻面 */
  dealCard(card: Card, index: number, from: Vec3, delay = 0): void {
    const view = new CardView(this.cardsHost, SIZE.comCardW, SIZE.comCardH);
    view.node.setPosition((index - 2) * (SIZE.comCardW + 12), 0);
    view.setCard(card);
    view.dealFrom(from.clone().subtract(this.node.position), delay);
    view.flip(delay + 0.26);
  }

  /** 底池金额（含本轮未收注则由调用方加上） */
  setPot(total: number): void {
    this.potLabel.string = `底池 ${total}`;
    this.potChips.setAmount(total);
    Tween.stopAllByTarget(this.potLabel.node);
    this.potLabel.node.setScale(1.18, 1.18, 1);
    tween(this.potLabel.node)
      .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
      .start();
  }
}
