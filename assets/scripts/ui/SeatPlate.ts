import {
  Color,
  Graphics,
  Label,
  Node,
  Tween,
  tween,
  UIOpacity,
  UITransform,
  Vec3,
} from "cc";
import { Player } from "../core/Player";
import { createLabel, createNode, drawGlassPanel, THEME } from "./Theme";
import { createBlindTag, createTurtle } from "./TurtleAvatar";
import { attachImage, uiFrame } from "./UiRes";

/**
 * 玩家横幅：以 player-card.png 为基准（原生 700×218，宽高比 3.211）。
 * 图内自带三个凹槽，显示尺寸必须与原图等比，凹槽才不变形（分数为像素实测）：
 * - 圆形头像槽：金环外缘 x 3..208 / y 3..202 → 圆心宽 15.1% / 高 47.0%，深色内缘直径约 25.2% 宽
 * - 两个牌槽：深绿开口中心在宽 72.8% / 89.1%、高 52.8%，开口约 12% 宽 × 57% 高（y 53..177）；
 *   牌按 14.57% 宽 × 72.48% 高（比开口大）再下沉 5% 落座，底边压过槽底亮色包边
 * 底牌由 SeatView 按 slotLocal 直接落进牌槽；名字 / 筹码 / 胜率 / 胜负
 * 全部排在头像槽与牌槽之间的文字区内，不再溢出横幅。
 */
const HERO_W = 392;
const HERO_H = 122;
const BOT_W = 303;
const BOT_H = 94;
const CIRCLE_X = 0.151;
const CIRCLE_Y = 0.47;
const CIRCLE_D = 0.252;
const SLOT_X = [0.728, 0.891];
const SLOT_Y = 0.5344;
const SLOT_W = 0.1457;
const SLOT_H = 0.7248;
/** 牌在槽内的落座下沉（占横幅高比例）：牌比开口高，底边压过槽底亮色包边、坐进槽里 */
const SLOT_DROP = 0.05;
/** 文字区横向范围（头像槽右缘到牌槽左缘） */
const TEXT_L = 0.335;
const TEXT_R = 0.645;
/** 文字区纵向整体下沉（横幅局部坐标，按视觉效果手调）：hero / bot 分开手调 */
const HERO_TEXT_DROP = 15;
const BOT_TEXT_DROP = 10;

/**
 * 玩家卡片（SeatView 的组成部分）：素材横幅打底，乌龟头像嵌进图内圆槽，
 * 名字 / 筹码 / 胜率 / 胜负统计逐行排在横幅中部文字区；
 * 行动金圈与胜利圈套在头像槽外；翻牌前头像旁挂 SB / BB 小徽章。
 */
export class SeatPlate {
  readonly node: Node;
  readonly plateH: number;
  /** 横幅中心相对两牌槽中点（即座位原点）的偏移：横幅在左、牌槽在横幅右端 */
  readonly plateOffset: Vec3;
  /** 两个牌槽中心（座位坐标系）与槽内尺寸，底牌按此落位 */
  readonly slotLocal: Vec3[];
  readonly slotW: number;
  readonly slotH: number;
  private readonly opacity: UIOpacity;
  private readonly nameLabel: Label;
  private readonly chipsLabel: Label;
  private readonly statsLabel: Label;
  private readonly hintLabel: Label;
  private readonly ring: Node;
  private readonly ringG: Graphics;
  private readonly ringR: number;
  private readonly avatarX: number;
  private readonly avatarD: number;
  private tagSb: Node | null = null;
  private tagBb: Node | null = null;
  private lastHint = "";

  constructor(parent: Node, isHero: boolean, name: string, colorIndex: number) {
    const w = isHero ? HERO_W : BOT_W;
    const h = isHero ? HERO_H : BOT_H;
    this.plateH = h;
    this.node = createNode("plate", parent, w, h);
    // 素材横幅打底；缺图回退磨砂玻璃保证可读
    if (uiFrame("player-card")) {
      attachImage(this.node, "player-card", w, h);
    } else {
      drawGlassPanel(this.node.addComponent(Graphics), w, h, 14);
    }
    this.opacity = this.node.addComponent(UIOpacity);

    // 头像嵌进图内圆槽（略小于槽，露出图里自带的槽边）；缺图回退每座一色的代码乌龟
    this.avatarD = CIRCLE_D * w;
    this.avatarX = (CIRCLE_X - 0.5) * w;
    const avatarY = (CIRCLE_Y - 0.5) * h;
    if (uiFrame("turtle")) {
      // 龟身贴图 alpha 质心偏图像中心右 5.9 / 下 9.2（384px 图），按显示尺寸折算位移让龟身落在圆槽中心
      attachImage(
        this.node,
        "turtle",
        this.avatarD - 10,
        this.avatarD - 10,
      ).setPosition(this.avatarX - 1.4, avatarY + 2.1);
    } else {
      createTurtle(this.node, this.avatarD, colorIndex).setPosition(
        this.avatarX,
        avatarY,
      );
    }
    // 行动 / 胜利圈套在头像槽外
    this.ringR = this.avatarD / 2 + 7;
    this.ring = createNode("ring", this.node);
    this.ring.setPosition(this.avatarX, avatarY);
    this.ringG = this.ring.addComponent(Graphics);
    this.ring.active = false;

    // 牌槽几何：底牌落位与横幅偏移都由素材实测分数推出
    const sx = SLOT_X.map((f) => (f - 0.5) * w);
    const sy = (SLOT_Y - 0.5) * h;
    this.plateOffset = new Vec3(-(sx[0] + sx[1]) / 2, -sy, 0);
    // slotLocal 直接给 SeatView 当座位坐标用，须包含横幅自身的偏移；
    // y 再减 SLOT_DROP 让牌底压过槽底包边（v12 按开口等高缩牌会在槽内露出底条）
    const dropY = SLOT_DROP * h;
    this.slotLocal = [
      new Vec3(this.plateOffset.x + sx[0], this.plateOffset.y + sy - dropY, 0),
      new Vec3(this.plateOffset.x + sx[1], this.plateOffset.y + sy - dropY, 0),
    ];
    this.slotW = SLOT_W * w;
    this.slotH = SLOT_H * h;

    // 文字区：名字 / 筹码 / 胜率 / 胜负逐行居中排在头像与牌槽之间
    const zx = ((TEXT_L + TEXT_R) / 2 - 0.5) * w;
    const zw = (TEXT_R - TEXT_L) * w;
    const drop = isHero ? HERO_TEXT_DROP : BOT_TEXT_DROP;
    const mk = (text: string, size: number, color: Color, y: number): Label => {
      const label = createLabel(this.node, text, size, color, true);
      const ut = label.node.getComponent(UITransform)!;
      ut.setContentSize(zw, size + 8);
      label.node.setPosition(zx, y - drop);
      label.horizontalAlign = Label.HorizontalAlign.CENTER;
      label.overflow = Label.Overflow.SHRINK;
      return label;
    };
    if (isHero) {
      this.nameLabel = mk(name, 13, THEME.textBright, 42);
      this.chipsLabel = mk("0", 12, THEME.goldBright, 23);
      this.hintLabel = mk("", 10, THEME.textBright, 3);
      this.statsLabel = mk("胜 0 · 负 0", 9, THEME.textDim, -17);
    } else {
      this.nameLabel = mk(name, 11, THEME.textBright, 26);
      this.chipsLabel = mk("0", 10, THEME.goldBright, 8);
      this.statsLabel = mk("胜 0 · 负 0", 8, THEME.textDim, -11);
      this.hintLabel = mk("", 10, THEME.textDim, 0);
      this.hintLabel.node.active = false;
    }
  }

  /** 按引擎状态刷新名字 / 筹码 / 统计 / 弃牌置灰 */
  refresh(player: Player): void {
    this.nameLabel.string = player.name;
    this.chipsLabel.string = `${player.chips}`;
    this.statsLabel.string = `胜 ${player.won} · 负 ${Math.max(0, player.played - player.won)}`;
    this.nameLabel.color = player.folded ? THEME.textDim : THEME.textBright;
    this.opacity.opacity = player.folded ? 135 : 255;
  }

  /** 胜率提示行（仅自己的卡片有意义） */
  setHint(text: string): void {
    if (text === this.lastHint) {
      return;
    }
    this.lastHint = text;
    this.hintLabel.string = text;
  }

  /** 当前行动者：头像槽外金色呼吸圈 */
  setActing(on: boolean): void {
    Tween.stopAllByTarget(this.ring);
    this.ring.setScale(1, 1, 1);
    if (!on) {
      this.ring.active = false;
      return;
    }
    this.ring.active = true;
    this.drawRing(THEME.gold, 3);
    const s = 1.07;
    tween(this.ring)
      .to(0.5, { scale: new Vec3(s, s, 1) })
      .to(0.5, { scale: new Vec3(1, 1, 1) })
      .to(0.5, { scale: new Vec3(s, s, 1) })
      .to(0.5, { scale: new Vec3(1, 1, 1) })
      .union()
      .repeatForever()
      .start();
  }

  /** 胜利特效：头像槽外加粗金圈（座位脉冲由 SeatView 负责） */
  showWinRing(): void {
    this.setActing(false);
    this.ring.active = true;
    this.drawRing(THEME.goldBright, 5);
  }

  /** 翻牌前盲注徽章：SB 红 / BB 蓝，贴头像槽右上，其他阶段收起 */
  setBlindTag(kind: "sb" | "bb" | null): void {
    if (!this.tagSb || !this.tagBb) {
      this.tagSb = createBlindTag(this.node, "sb");
      this.tagSb.setScale(1.5, 1.5, 1);
      this.tagSb.setPosition(
        this.avatarX + this.avatarD * 0.52,
        this.plateH / 2 - 5,
      );
      this.tagBb = createBlindTag(this.node, "bb");
      this.tagBb.setScale(1.5, 1.5, 1);
      this.tagBb.setPosition(this.tagSb.position);
    }
    this.tagSb.active = kind === "sb";
    this.tagBb.active = kind === "bb";
  }

  private drawRing(color: Color, lineW: number): void {
    this.ringG.clear();
    this.ringG.lineWidth = lineW;
    this.ringG.strokeColor = color;
    this.ringG.circle(0, 0, this.ringR);
    this.ringG.stroke();
  }
}
