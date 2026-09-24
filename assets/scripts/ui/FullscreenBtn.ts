import { Color, Graphics, Node, Tween, tween, Vec3 } from "cc";
import { toggleFullscreen } from "./Boot";
import { createNode, THEME } from "./Theme";

/**
 * 右上角全屏切换圆钮（与音效钮同款深底金圈样式）：
 * 点击进入 / 退出全屏；移动端进入时顺带锁定横屏（Boot.toggleFullscreen 内处理）。
 */
export function createFullscreenToggle(parent: Node): Node {
  const node = createNode("fullscreenToggle", parent, 44, 44);
  node.setPosition(510, 280);
  const g = node.addComponent(Graphics);
  // 四角括号 = 全屏展开图标（进入 / 退出共用一个图标，状态由系统 UI 表达）
  const draw = (): void => {
    g.clear();
    g.fillColor = new Color(24, 30, 42, 170);
    g.circle(0, 0, 20);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = THEME.gold;
    g.circle(0, 0, 20);
    g.stroke();
    g.lineWidth = 2.4;
    g.strokeColor = THEME.goldBright;
    const c = 10;
    const arm = 6;
    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    corners.forEach(([sx, sy]) => {
      g.moveTo(sx * c, sy * (c - arm));
      g.lineTo(sx * c, sy * c);
      g.lineTo(sx * (c - arm), sy * c);
      g.stroke();
    });
  };
  draw();
  node.on(Node.EventType.TOUCH_END, () => {
    toggleFullscreen();
    Tween.stopAllByTarget(node);
    tween(node)
      .to(0.15, { scale: new Vec3(0.9, 0.9, 1) })
      .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
      .start();
  });
  return node;
}
