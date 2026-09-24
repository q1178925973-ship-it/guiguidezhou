import { Color, EditBox, Graphics, Label, Node, tween, Vec3 } from "cc";
import {
  createGlassButton,
  createLabel,
  createNode,
  drawGlassPanel,
  THEME,
} from "./Theme";

const PANEL_W = 480;
const PANEL_H = 430;
const BOX_W = 360;

/** 提交类型：账密登录 / 注册 / 游客直接进桌 */
export type AuthKind = "login" | "register" | "guest";

/**
 * 联机入口弹窗：注册 / 登录账号（用户名支持中文 + 密码），或游客进入。
 * 认证失败由外部调 showError() 在弹窗内提示，弹窗保持打开可重试。
 */
export class AccountDialog {
  readonly node: Node;
  private readonly panel: Node;
  private readonly nameBox: EditBox;
  private readonly passBox: EditBox;
  private readonly errorLabel: Label;
  private busy = false;

  constructor(parent: Node, onAuth: (kind: AuthKind, name: string, pass: string) => void) {
    this.node = createNode("accountDialog", parent);
    // 半透明遮罩：聚焦注意力（认证完成前不关闭）
    const mask = createNode("mask", this.node, 1280, 720);
    const mg = mask.addComponent(Graphics);
    mg.fillColor = new Color(10, 13, 20, 150);
    mg.rect(-640, -360, 1280, 720);
    mg.fill();

    this.panel = createNode("panel", this.node, PANEL_W, PANEL_H);
    drawGlassPanel(this.panel.addComponent(Graphics), PANEL_W, PANEL_H, 26);
    this.panel.setScale(0.7, 0.7, 1);
    tween(this.panel)
      .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: "backOut" })
      .start();

    const title = createLabel(this.panel, "德州扑克 · 联机对局", 30, THEME.goldBright, true);
    title.node.setPosition(0, 168);
    const desc = createLabel(this.panel, "注册或登录后胜负战绩永久保存，掉线重登可找回座位", 15, THEME.textDim);
    desc.node.setPosition(0, 130);

    this.nameBox = this.buildBox("用户名（支持中文）", false, 66);
    this.passBox = this.buildBox("密码", true, 0);

    this.errorLabel = createLabel(this.panel, "", 14, THEME.inkRed);
    this.errorLabel.node.setPosition(0, -46);
    this.errorLabel.node.active = false;

    const submit = (kind: AuthKind): void => {
      if (this.busy) {
        return;
      }
      const name = this.nameBox.string.trim();
      const pass = this.passBox.string;
      if (kind !== "guest" && (!name || !pass)) {
        this.showError(kind === "login" ? "请输入用户名和密码" : "请设置用户名和密码");
        return;
      }
      this.busy = true;
      onAuth(kind, name, pass);
    };
    // 不绑回车提交：web 上 EDITING_RETURN / DID_ENDED 都会被输入法确认、点击失焦误触发，
    // 抢在按钮前误发 login；账号场景动作有登录/注册两个，只靠按钮显式选择
    const loginBtn = createGlassButton(this.panel, "登录", 168, 50, 22, THEME.goldBright);
    loginBtn.node.setPosition(-96, -104);
    loginBtn.node.on(Node.EventType.TOUCH_END, () => submit("login"));
    const regBtn = createGlassButton(this.panel, "注册", 168, 50, 22, THEME.textBright);
    regBtn.node.setPosition(96, -104);
    regBtn.node.on(Node.EventType.TOUCH_END, () => submit("register"));
    // 游客入口：不建账号直接进桌（战绩不保存）
    const guest = createNode("guestZone", this.panel, 260, 34);
    guest.setPosition(0, -158);
    const gl = createLabel(guest, "游客进入（战绩不保存）", 14, THEME.textDim);
    gl.node.setPosition(0, 0);
    guest.on(Node.EventType.TOUCH_END, () => submit("guest"));
  }

  /** 输入框：玻璃底节点 + 透明 EditBox 子节点（密码框走 InputFlag.PASSWORD） */
  private buildBox(placeholder: string, password: boolean, y: number): EditBox {
    const host = createNode("boxHost", this.panel, BOX_W, 52);
    host.setPosition(0, y);
    drawGlassPanel(host.addComponent(Graphics), BOX_W, 52, 12);
    const editNode = createNode("edit", host, BOX_W - 16, 44);
    const eb = editNode.addComponent(EditBox);
    eb.maxLength = 24;
    if (password) {
      eb.inputFlag = EditBox.InputFlag.PASSWORD;
    }
    const ph = createLabel(editNode, placeholder, 18, THEME.textDim);
    ph.node.setPosition(-(BOX_W - 16) / 2 + 16, 0);
    ph.node.anchorX = 0;
    const tl = createLabel(editNode, "", 18, THEME.textBright);
    tl.node.setPosition(-(BOX_W - 16) / 2 + 16, 0);
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
    return eb;
  }

  /** 认证进行中：锁提交（外部等待 auth-ok / auth-err 再解锁） */
  setBusy(on: boolean): void {
    this.busy = on;
    if (!on) {
      this.errorLabel.node.active = false;
    }
  }

  showError(msg: string): void {
    this.busy = false;
    this.errorLabel.string = msg;
    this.errorLabel.node.active = true;
  }

  /** 预填用户名（本地记住的上次登录名） */
  prefill(name: string): void {
    if (name) {
      this.nameBox.string = name;
    }
  }

  hide(): void {
    this.node.removeFromParent();
    this.node.destroy();
  }
}
