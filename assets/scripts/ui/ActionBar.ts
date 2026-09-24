import { Node, Tween, tween, UIOpacity, Vec3 } from "cc";
import { Act, ActKind, LegalActs } from "../core/Types";
import {
  createGlassButton,
  createNode,
  SimpleButton,
  THEME,
  withOutline,
} from "./Theme";
import { createImageButton, ImageButton } from "./UiRes";

/** 加注档位（前三档在加注按钮上方的小条里切换，第四档「全下」是独立大按钮） */
const TIER_LABELS = ["最小", "½池", "满池"];
const TIER_COUNT = 4;
/** 底部操作排位置（按效果图测量：按钮行中心 y≈-288） */
const BASE_Y = -288;
const HIDDEN_Y = -334;
/** 档位小条相对操作条的局部位置（加注按钮正上方） */
const TIER_X = 214;
const TIER_Y = 52;

/** 下注上下文：单机取自引擎，联机取自服务器快照 */
export interface BetContext {
  currentBet: number;
  pot: number;
}

/**
 * 底部操作条：图片素材大按钮（弃牌红 / 过牌·跟注绿 / 加注金 / 全下橙）。
 * 加注按钮上方有「最小 / ½池 / 满池」档位小条，点击换档后按加注钮出价；
 * 全下为独立按钮，四档加注玩法与旧版一致。
 * 仅在轮到玩家时显示，其余时间隐藏且不响应点击。
 */
export class ActionBar {
  readonly node: Node;
  private readonly opacity: UIOpacity;
  private readonly foldBtn: ImageButton;
  private readonly checkCallBtn: ImageButton;
  private readonly raiseBtn: ImageButton;
  private readonly allinBtn: ImageButton;
  private readonly pills: SimpleButton[] = [];
  private readonly tierHost: Node;
  private legal: LegalActs | null = null;
  private targets: number[] = [];
  private tier = 0;
  private onAct: ((act: Act) => void) | null = null;

  constructor(parent: Node) {
    this.node = createNode("actionBar", parent);
    this.node.setPosition(0, BASE_Y);
    this.opacity = this.node.addComponent(UIOpacity);
    this.opacity.opacity = 0;
    this.node.active = false;

    this.foldBtn = createImageButton(
      this.node,
      "btn-fold",
      "弃牌",
      176,
      56,
      22,
    );
    withOutline(this.foldBtn.label);
    this.foldBtn.node.setPosition(-201, 0);
    this.foldBtn.node.on(Node.EventType.TOUCH_END, () =>
      this.emit({ kind: ActKind.Fold }),
    );

    this.checkCallBtn = createImageButton(
      this.node,
      "btn-call",
      "过牌",
      196,
      56,
      22,
    );
    withOutline(this.checkCallBtn.label);
    // 文字右移避开图内烘焙图标（偏移值按实际效果手调）
    this.checkCallBtn.label.node.setPosition(15, 0);
    this.checkCallBtn.node.setPosition(4, 0);
    this.checkCallBtn.node.on(Node.EventType.TOUCH_END, () =>
      this.emitCheckCall(),
    );

    this.tierHost = createNode("tiers", this.node);
    this.tierHost.setPosition(TIER_X, TIER_Y);
    TIER_LABELS.forEach((text, i) => {
      const pill = createGlassButton(
        this.tierHost,
        text,
        56,
        26,
        13,
        THEME.textDim,
      );
      pill.node.setPosition((i - 1) * 64, 0);
      pill.node.on(Node.EventType.TOUCH_END, () => this.selectTier(i));
      this.pills.push(pill);
    });

    // 金底按钮配深色字（不用白字描边），文字居中避开图内自带的上下箭头
    this.raiseBtn = createImageButton(
      this.node,
      "btn-raise",
      "加注",
      216,
      56,
      22,
      THEME.inkBlack,
    );
    this.raiseBtn.node.setPosition(TIER_X, 0);
    this.raiseBtn.node.on(Node.EventType.TOUCH_END, () => {
      if (this.legal && this.targets[this.tier] !== undefined) {
        this.emit({ kind: ActKind.Raise, raiseTo: this.targets[this.tier] });
      }
    });

    this.allinBtn = createImageButton(
      this.node,
      "btn-allin",
      "全下",
      210,
      56,
      22,
    );
    withOutline(this.allinBtn.label);
    this.allinBtn.node.setPosition(439, 0);
    this.allinBtn.node.on(Node.EventType.TOUCH_END, () => {
      if (this.legal && this.targets[TIER_COUNT - 1] !== undefined) {
        this.emit({
          kind: ActKind.Raise,
          raiseTo: this.targets[TIER_COUNT - 1],
        });
      }
    });
  }

  /** 轮到玩家：传入合法动作与下注上下文（用于估算档位金额） */
  show(legal: LegalActs, ctx: BetContext, onAct: (act: Act) => void): void {
    this.legal = legal;
    this.onAct = onAct;
    this.checkCallBtn.label.string = legal.canCheck
      ? "过牌"
      : `跟注 ${legal.callAmount}`;
    const canRaise = legal.canRaise;
    this.tierHost.active = canRaise;
    this.raiseBtn.node.active = canRaise;
    // 翻牌前三张未发：梭哈按钮收起（引擎同时在规则层拒绝主动全下）
    this.allinBtn.node.active = canRaise && legal.canAllIn;
    if (canRaise) {
      this.refreshTiers(legal, ctx);
      this.selectTier(0);
    }
    this.node.active = true;
    Tween.stopAllByTarget(this.node);
    Tween.stopAllByTarget(this.opacity);
    this.node.setPosition(0, HIDDEN_Y);
    this.opacity.opacity = 0;
    tween(this.opacity).to(0.22, { opacity: 255 }).start();
    tween(this.node)
      .to(0.22, { position: new Vec3(0, BASE_Y, 0) }, { easing: "quadOut" })
      .start();
  }

  hide(): void {
    this.onAct = null;
    Tween.stopAllByTarget(this.opacity);
    tween(this.opacity)
      .to(0.18, { opacity: 0 })
      .call(() => {
        if (this.opacity.opacity === 0) {
          this.node.active = false;
        }
      })
      .start();
  }

  /** 计算四档加注目标额（以「本轮总投入加注到」口径，½池/满池为简化估算） */
  private refreshTiers(legal: LegalActs, ctx: BetContext): void {
    const afterCall = ctx.pot + legal.callAmount;
    const tier = (frac: number): number =>
      Math.max(
        legal.raiseMinTo,
        Math.min(
          legal.raiseMaxTo,
          ctx.currentBet + Math.round(afterCall * frac),
        ),
      );
    this.targets = [legal.raiseMinTo, tier(0.5), tier(1), legal.raiseMaxTo];
    this.pills.forEach((pill, i) => {
      // 与全下相同的档位没有意义，收起对应小档
      pill.node.active = this.targets[i] < legal.raiseMaxTo;
    });
  }

  /** 切换加注档位：高亮小条并刷新加注按钮金额 */
  private selectTier(i: number): void {
    if (!this.pills[i] || !this.pills[i].node.active) {
      i = this.pills.findIndex((p) => p.node.active);
      if (i < 0) {
        return;
      }
    }
    this.tier = i;
    this.pills.forEach((pill, k) => {
      pill.label.color = k === i ? THEME.goldBright : THEME.textDim;
      Tween.stopAllByTarget(pill.node);
      tween(pill.node)
        .to(
          0.2,
          { scale: new Vec3(k === i ? 1.06 : 1, k === i ? 1.06 : 1, 1) },
          { easing: "quadOut" },
        )
        .start();
    });
    const target = this.targets[i];
    this.raiseBtn.label.string =
      target !== undefined ? `加注 ${target}` : "加注";
  }

  private emitCheckCall(): void {
    if (!this.legal) {
      return;
    }
    this.emit(
      this.legal.canCheck ? { kind: ActKind.Check } : { kind: ActKind.Call },
    );
  }

  private emit(act: Act): void {
    if (this.onAct) {
      this.onAct(act);
    }
  }
}
