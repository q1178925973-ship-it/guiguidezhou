import { Color, EventTouch, Graphics, Label, Node, Tween, tween, Vec3 } from "cc";
import { toggleFullscreen, FullscreenResult } from "./Boot";
import { createLabel, createNode, THEME } from "./Theme";

/** 触控区尺寸：视觉圆钮 44，命中区放大到 76x64（手机横屏下约 42x35 CSS 像素才够指尖点按） */
const HIT_W = 76;
const HIT_H = 64;
/** Chrome 退出全屏后约 1 秒内会拒绝再次进入：被拒后隔 1.3 秒自动重试一次（仍在手势激活窗口内） */
const RETRY_MS = 1300;

/**
 * 右上角全屏切换圆钮（与音效钮同款深底金圈样式）：
 * 点击进入 / 退出全屏；图标随全屏状态切换（全屏中带 X 表示点击将退出）；
 * 被浏览器拒绝时自动重试一次，仍失败则在按钮上方给出文字提示，不让用户「点了没反应」。
 */
export function createFullscreenToggle(parent: Node): Node {
  const node = createNode("fullscreenToggle", parent, 44, 44);
  // 视觉位置沿用原右上角；触控区中心上移避让下方的重置对局按钮（局部坐标 (-4,16)）
  node.setPosition(510, 280);
  const g = node.addComponent(Graphics);
  let hint: Label | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const isFull = (): boolean => {
    if (typeof document === "undefined") {
      return false;
    }
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    return !!(document.fullscreenElement || doc.webkitFullscreenElement);
  };

  const draw = (): void => {
    const full = isFull();
    g.clear();
    g.fillColor = new Color(24, 30, 42, 170);
    g.circle(0, 0, 20);
    g.fill();
    g.lineWidth = 2;
    g.strokeColor = THEME.gold;
    g.circle(0, 0, 20);
    g.stroke();
    // 四角括号 = 全屏图标；全屏中再叠加中心 X 表示「点击将退出」
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
    if (full) {
      g.lineWidth = 2.2;
      g.strokeColor = THEME.inkRed;
      g.moveTo(-4.5, 4.5);
      g.lineTo(4.5, -4.5);
      g.moveTo(-4.5, -4.5);
      g.lineTo(4.5, 4.5);
      g.stroke();
    }
  };

  const showHint = (text: string): void => {
    if (!hint) {
      hint = createLabel(node, "", 14, THEME.textBright, true);
      hint.node.setPosition(0, -40);
    }
    hint.string = text;
    hint.node.active = true;
    if (hintTimer) {
      clearTimeout(hintTimer);
    }
    hintTimer = setTimeout(() => {
      hintTimer = null;
      if (hint?.isValid) {
        hint.node.active = false;
      }
    }, 2600);
  };

  const onOutcome = (r: FullscreenResult): void => {
    if (r === "unsupported") {
      showHint("此浏览器不支持网页全屏");
      return;
    }
    if (r === "rejected" && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void toggleFullscreen().then((again) => {
          if (again !== "ok") {
            showHint(again === "unsupported" ? "此浏览器不支持网页全屏" : "浏览器未允许全屏，请稍后再点");
          }
        });
      }, RETRY_MS);
    }
  };

  draw();
  if (typeof document !== "undefined") {
    const sync = (): void => {
      if (node.isValid) {
        draw();
      }
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
  }

  // 隐形放大触控区（向上偏移避让重置按钮）：拦截事件不让下层节点重复收到
  const hit = createNode("hit", node, HIT_W, HIT_H);
  hit.setPosition(-4, 16);
  hit.on(Node.EventType.TOUCH_END, (ev: EventTouch) => {
    ev.propagationStopped = true;
    Tween.stopAllByTarget(node);
    tween(node)
      .to(0.15, { scale: new Vec3(0.9, 0.9, 1) })
      .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
      .start();
    void toggleFullscreen().then(onOutcome);
  });
  return node;
}
