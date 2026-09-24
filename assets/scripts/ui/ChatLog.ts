import {
  EditBox,
  EventTouch,
  Graphics,
  Mask,
  Node,
  RichText,
  Tween,
  tween,
  UIOpacity,
  UITransform,
  Vec3,
} from "cc";
import { createLabel, createNode, drawGlassPanel, THEME } from "./Theme";
import { attachImage, uiFrame } from "./UiRes";

/** 面板尺寸与素材横图等比（~1.43:1） */
const W = 280;
const H = 196;
/** 最多保留的历史条数与单行高度（消息区约 3 行） */
const MAX_LINES = 50;
const ROW_H = 34;

/**
 * 左下角牌桌聊天面板（素材图底）：金边深绿面板，
 * 顶部标题胶囊、中部消息视口（可拖动滚动）、底部输入行（回车或点纸飞机发送）。
 * 行的可见性由 relayout 手动控制 + 视口 Mask 像素级裁剪双保险。
 */
export class ChatLog {
  readonly node: Node;
  private readonly viewport: Node;
  private readonly linesHost: Node;
  private readonly barG: Graphics;
  /** 消息视口的中心与高度（面板局部坐标；按素材图内区域比例映射） */
  private readonly viewCY = 7;
  private readonly viewH = Math.round(H * 0.51);
  private scroll = 0;

  constructor(parent: Node, pos: Vec3, onSend: (text: string) => void) {
    this.node = createNode("chatLog", parent, W, H);
    this.node.setPosition(pos);
    // 素材面板打底；缺图回退磨砂玻璃
    if (uiFrame("chat-panel")) {
      attachImage(this.node, "chat-panel", W, H);
    } else {
      drawGlassPanel(this.node.addComponent(Graphics), W, H, 14);
    }
    // 标题：贴面板顶边、水平略偏左（按用户标注截图：箭头指向面板顶边 x≈-560=面板局部 -82 一带）
    const title = createLabel(
      this.node,
      "牌桌聊天",
      13,
      THEME.textBright,
      true,
    );
    title.node.setPosition(-80, 79);
    // 消息视口（图内 21%~72% 区域）
    this.viewport = createNode("viewport", this.node, W - 24, this.viewH);
    this.viewport.setPosition(0, this.viewCY, 0);
    this.viewport.addComponent(Mask).type = Mask.Type.RECT;
    this.linesHost = createNode("lines", this.viewport);
    this.barG = createNode("bar", this.node).addComponent(Graphics);
    this.viewport.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
      // 手指往下滑（dy 为负）翻看更早的历史：内容跟随手指方向
      this.scrollTo(this.scroll - e.getUIDelta().y);
    });
    this.buildInputRow(onSend);
  }

  /** 底部输入行（素材实测：输入槽内开口 x 4.3%-67.3%、y 75.5%-93.6%，中心 (-40,-66)；纸飞机中心 (81,-66)） */
  private buildInputRow(onSend: (text: string) => void): void {
    const editNode = createNode("edit", this.node, 168, 26);
    editNode.setPosition(-40, -66);
    const eb = editNode.addComponent(EditBox);
    eb.maxLength = 60;
    const ph = createLabel(editNode, "说点什么…", 12, THEME.textDim);
    ph.node.setPosition(-80, 0);
    ph.node.anchorX = 0;
    const tl = createLabel(editNode, "", 20, THEME.textBright);
    tl.node.setPosition(-80, -8);
    tl.node.anchorX = 0;
    eb.placeholderLabel = ph;
    eb.textLabel = tl;
    // 清掉 EditBox 组件自建的默认占位/文本子节点（否则叠显引擎默认的 "label" 字样）
    for (const name of ["PLACEHOLDER_LABEL", "TEXT_LABEL"]) {
      const orphan = editNode.getChildByName(name);
      if (orphan && orphan !== ph.node && orphan !== tl.node) {
        orphan.destroy();
        orphan.removeFromParent();
      }
    }
    const submit = (): void => {
      const text = eb.string.trim().slice(0, 60);
      if (text) {
        onSend(text);
      }
      eb.string = "";
    };
    editNode.on(EditBox.EDITING_DID_ENDED, submit);
    // 发送：图内右侧纸飞机图标位置放透明触摸区
    const send = createNode("send", this.node, 50, 26);
    send.setPosition(82, -66);
    send.on(Node.EventType.TOUCH_END, submit);
  }

  /** 追加一条发言（说话人金色高亮），滚到底部显示 */
  push(speaker: string, text: string): void {
    const trimmed = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    const line = createNode("line", this.linesHost);
    const textNode = createNode("text", line);
    textNode.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    textNode.setPosition(-this.viewW() / 2 + 8, 0);
    const rt = textNode.addComponent(RichText);
    rt.fontSize = 12;
    rt.maxWidth = this.viewW() - 16;
    rt.string = `<color=#f5c469><b>${speaker}</b></color>  <color=#dcd8cc>${trimmed}</color>`;
    const op = line.addComponent(UIOpacity);
    op.opacity = 0;
    Tween.stopAllByTarget(op);
    tween(op).to(0.25, { opacity: 255 }).start();
    // 超上限移除最旧一条（destroy 延迟到帧末，需同步摘出节点）
    if (this.linesHost.children.length > MAX_LINES) {
      const oldest = this.linesHost.children[0];
      oldest.destroy();
      oldest.removeFromParent();
    }
    // 新消息贴视口底部：滚回最底（scroll = 0 为底部对齐）
    this.scrollTo(0);
  }

  private viewW(): number {
    return W - 24;
  }

  private scrollTo(target: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll(), target));
    this.relayout();
  }

  /**
   * 重排所有行（底部对齐）：最新一条（i = n-1）贴视口底，更早的依次向上堆叠，
   * scroll 为向下翻看历史的距离（0 = 贴底，maxScroll = 最旧一条到顶）。
   */
  private relayout(): void {
    const n = this.linesHost.children.length;
    this.linesHost.children.forEach((line, i) => {
      const y = -this.viewH / 2 + ROW_H / 2 + (n - 1 - i) * ROW_H - this.scroll;
      line.setPosition(0, y, 0);
      line.active =
        y > -this.viewH / 2 - ROW_H / 2 && y < this.viewH / 2 + ROW_H / 2;
    });
    this.drawBar();
  }

  private maxScroll(): number {
    return Math.max(0, this.linesHost.children.length * ROW_H - this.viewH);
  }

  /** 右侧滚动条（贴消息视口右缘）：拇指高度/位置按可见比例计算 */
  private drawBar(): void {
    this.barG.clear();
    const contentH = this.linesHost.children.length * ROW_H;
    if (contentH <= this.viewH) {
      return;
    }
    const thumbH = Math.max(24, (this.viewH / contentH) * this.viewH);
    const ratio = this.maxScroll() > 0 ? this.scroll / this.maxScroll() : 0;
    // scroll=0（在底部）时拇指贴底，翻到顶时拇指到顶
    const cy =
      this.viewCY - this.viewH / 2 + thumbH / 2 + ratio * (this.viewH - thumbH);
    this.barG.fillColor = THEME.textDim;
    this.barG.roundRect(this.viewW() / 2 - 8, cy - thumbH / 2, 3, thumbH, 1.5);
    this.barG.fill();
  }
}
