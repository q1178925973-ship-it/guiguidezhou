import { _decorator, Component, DEV, director, Graphics, Node, Vec3 } from "cc";
import { AiAdvisor } from "../ai/AiAdvisor";
import { GameEngine } from "../core/GameEngine";
import { Player } from "../core/Player";
import { ActKind, GameEvent, Phase, PotAward } from "../core/Types";
import { isOnlineMode } from "../net/NetClient";
import { runLogicSelfTests } from "../tests/LogicSelfTest";
import { ActionBar } from "./ActionBar";
import { hideBootSplash, settle, setupBootDom } from "./Boot";
import { createFullscreenToggle } from "./FullscreenBtn";
import { loadCardFaces } from "./CardFaces";
import { ChatLog } from "./ChatLog";
import { CommunityView } from "./CommunityView";
import { EndBar } from "./EndBar";
import { buildHeroHint } from "./HeroHint";
import { loadIconFont } from "./IconFont";
import { MessageBar } from "./MessageBar";
import { OnlineGameApp } from "./OnlineGameApp";
import { createSoundToggle, SoundFx } from "./SoundFx";
import { SeatView } from "./SeatView";
import { describeActOf, PHASE_NAMES, SEAT_LAYOUT } from "./SeatLayout";
import { DECK_POS, TABLE_CENTER, TableView } from "./TableView";
import { attachImage, loadUiRes, uiFrame } from "./UiRes";
import { WinFx } from "./WinFx";
import { createGlassButton, createLabel, createNode, shade, SimpleButton, THEME } from "./Theme";

const { ccclass } = _decorator;

const BOT_NAMES = ["阿宝", "老K", "胖虎"];

/**
 * 游戏入口组件：挂到 Canvas 下的空节点（如 "Game"）即可运行。
 * 负责搭建全部视图、驱动引擎事件流转、调度 AI 行动与换手节奏。
 */
@ccclass("GameApp")
export class GameApp extends Component {
  private engine = new GameEngine();
  private readonly advisor = new AiAdvisor();
  private readonly sfx = new SoundFx();
  /** 每座位最近一次刷新的下注额（收池动画的起飞依据） */
  private lastBets: number[] = [];
  /** AI 台词：动作事件到达前暂存，随行动气泡一起展示 */
  private readonly pendingSay = new Map<number, string>();
  private readonly seats: SeatView[] = [];
  private community!: CommunityView;
  private actionBar!: ActionBar;
  private endBar!: EndBar;
  private messages!: MessageBar;
  private chatLog!: ChatLog;
  private winFx!: WinFx;
  private dealerMark!: Node;
  private tableView!: TableView;
  /** 主动亮牌按钮（自己的手牌旁，一手一次） */
  private showBtn!: SimpleButton;

  onLoad(): void {
    this.ensureUnderCanvas();
    // 联机模式：入口直接移交给联机组件（名字弹窗 → 连接服务器 → 快照渲染）
    if (isOnlineMode()) {
      this.node.addComponent(OnlineGameApp);
      this.destroy();
      return;
    }
    if (DEV) {
      runLogicSelfTests();
    }
    setupBootDom();
    // 关键顺序：UI 素材异步加载，必须等帧缓存就绪后再构建界面，
    // 否则 uiFrame() 全部取不到、界面整体回退成代码绘制的兜底样式
    this.tableView = new TableView(this.node);
    settle([loadCardFaces(), loadIconFont(), loadUiRes(), this.tableView.ready]).then(() => {
      this.buildUi();
      hideBootSplash();
      this.startMatch();
    });
  }

  /** 2D UI 必须位于 Canvas 层级下，挂错位置时自动纠正 */
  private ensureUnderCanvas(): void {
    const canvas = director.getScene()?.getChildByName("Canvas");
    if (!canvas) {
      console.warn("场景中未找到 Canvas，请把 Game 节点挂到 Canvas 下");
      return;
    }
    let cur: Node | null = this.node;
    while (cur && cur !== canvas) {
      cur = cur.parent;
    }
    if (!cur) {
      this.node.setParent(canvas);
    }
  }

  private startMatch(): void {
    this.engine = new GameEngine();
    this.engine.on((ev) => this.onEngineEvent(ev));
    this.engine.addPlayer("你", false);
    BOT_NAMES.forEach((name) => this.engine.addPlayer(name, true));
    this.messages.hideModal();
    this.messages.hideBanner();
    this.engine.startHand();
  }

  private buildUi(): void {
    SEAT_LAYOUT.forEach((s, i) => {
      this.seats.push(
        new SeatView(this.node, i === 0 ? "你" : BOT_NAMES[i - 1], {
          pos: s.pos,
          betOffset: s.bet,
          colorIndex: i,
          faceUp: s.faceUp,
        }),
      );
    });
    this.community = new CommunityView(
      this.node,
      new Vec3(TABLE_CENTER.x, TABLE_CENTER.y, 0),
    );
    // 庄家钮：素材徽章图；缺图回退白圆 + D
    this.dealerMark = attachImage(this.node, "dealer-badge", 40, 40);
    if (!uiFrame("dealer-badge")) {
      const dg = this.dealerMark.addComponent(Graphics);
      dg.fillColor = THEME.textBright;
      dg.circle(0, 0, 16);
      dg.fill();
      createLabel(this.dealerMark, "D", 20, THEME.inkBlack, true);
    }
    this.actionBar = new ActionBar(this.node);
    this.endBar = new EndBar(this.node);
    this.messages = new MessageBar(this.node);
    createSoundToggle(this.node, this.sfx);
    createFullscreenToggle(this.node);
    // 聊天面板（左下角）：单机输入仅进入本地聊天记录
    this.chatLog = new ChatLog(this.node, new Vec3(-478, -232, 0), (text) =>
      this.chatLog.push("你", text),
    );
    // 主动亮牌按钮：手牌左侧，仅局内且未亮过时出现
    this.showBtn = createGlassButton(this.node, "亮牌", 76, 32, 14, shade(THEME.call, 1.55));
    this.showBtn.node.setPosition(-223, -246, 0);
    this.showBtn.node.on(Node.EventType.TOUCH_END, () => this.showMyCards());
    this.showBtn.node.active = false;
    this.winFx = new WinFx(this.node);
  }

  private onEngineEvent(ev: GameEvent): void {
    switch (ev) {
      case "hand-start":
        this.endBar.hide();
        this.winFx.clear();
        this.seats[0].setHint("");
        this.seats.forEach((s) => s.clearHand());
        this.community.reset();
        this.messages.hideBanner();
        this.placeDealerMark();
        this.refreshAll();
        break;
      case "blinds":
        this.refreshAll();
        break;
      case "deal-hole":
        this.seats.forEach((s, i) =>
          s.dealCards(this.engine.players[i].hole, DECK_POS, 0.1 + i * 0.12),
        );
        this.showPhaseLabel();
        this.sfx.deal();
        this.updateHeroHint();
        this.refreshAll();
        break;
      case "street": {
        this.sweepBets();
        this.sfx.flip();
        const dealt = this.engine.phase === Phase.Flop ? 3 : 1;
        const start = this.engine.community.length - dealt;
        this.engine.community.slice(start).forEach((card, k) => {
          this.community.dealCard(card, start + k, DECK_POS, 0.15 + k * 0.2);
        });
        this.showPhaseLabel();
        this.refreshAll();
        this.updateHeroHint();
        break;
      }
      case "act":
        this.onAct();
        break;
      case "turn":
        this.onTurn();
        break;
      case "showdown":
        this.sweepBets();
        this.seats.forEach((s, i) => {
          if (this.engine.players[i].inHand) {
            s.revealCards();
          }
        });
        break;
      case "hand-end":
        this.onHandEnd();
        break;
    }
  }

  private showPhaseLabel(): void {
    const name = PHASE_NAMES[this.engine.phase] ?? "";
    this.messages.showPhase(`第 ${this.engine.handNo} 手 · ${name}`);
  }

  private onAct(): void {
    const last = this.engine.lastAction;
    if (last) {
      if (last.act.kind === ActKind.Call || last.act.kind === ActKind.Raise) {
        this.sfx.chip();
      }
      const say = this.pendingSay.get(last.playerId) ?? "";
      this.pendingSay.delete(last.playerId);
      const actor = this.engine.byId(last.playerId)!;
      const full = `${describeActOf(last.act, actor)}${say ? `「${say}」` : ""}`;
      this.seats[last.playerId].showAction(full);
      // 机器人发言进入左下角聊天记录
      if (actor.isBot) {
        this.chatLog.push(actor.name, full);
      }
      // 弃牌者稍后翻开底牌，让玩家看到他弃了什么
      if (last.act.kind === ActKind.Fold) {
        const id = last.playerId;
        this.scheduleOnce(() => {
          if (this.engine.players[id]?.folded) {
            this.seats[id].revealCards();
          }
        }, 0.4);
      }
    }
    this.refreshAll();
    this.updateHeroHint();
  }

  private onTurn(): void {
    this.refreshAll();
    const cur = this.engine.actingPlayer;
    if (!cur) {
      return;
    }
    if (cur.isBot) {
      this.actionBar.hide();
      const botId = cur.id;
      const handNo = this.engine.handNo;
      this.seats[botId].showAction("思考中…");
      this.advisor.decide(this.engine, botId).then((d) => {
        // 行动权已转移（重开/新局）时丢弃过期结果
        const acting = this.engine.actingPlayer;
        if (!acting || acting.id !== botId || this.engine.handNo !== handNo) {
          return;
        }
        if (d.say) {
          this.pendingSay.set(botId, d.say);
        }
        this.engine.act(botId, d.act);
      });
    } else {
      const heroId = cur.id;
      const pot = this.engine.potAmount + this.engine.players.reduce((s, p) => s + p.betRound, 0);
      this.actionBar.show(this.engine.getLegalActs(heroId), { currentBet: this.engine.currentBet, pot }, (a) =>
        this.engine.act(heroId, a),
      );
    }
  }

  private onHandEnd(): void {
    this.refreshAll();
    // 局末翻开所有还在手中的底牌（弃牌者已在弃牌时翻开）
    this.engine.players.forEach((p, i) => {
      if (p.inHand) {
        this.seats[i].revealCards();
      }
    });
    const winners = new Set<number>();
    this.engine.lastAwards.forEach((a) =>
      a.winners.forEach((w) => winners.add(w.id)),
    );
    winners.forEach((id) => this.seats[id].showWin());
    if (winners.size > 0) {
      this.sfx.win();
    }
    this.seats[0].setHint("");
    // 结算横幅：单一赢家播报总额；多池不同赢家分开播报（主池归 A，边池归 B），
    // 只有同池并列才写「平分」，避免边池赢家被误读成平分底池
    // 不用 [...winners]（Set）：ES5 构建降级不会展开 Set，用 forEach 收集
    const winNameList: string[] = [];
    winners.forEach((id) => winNameList.push(this.engine.players[id].name));
    const winTotal = this.engine.lastAwards.reduce((s, a) => s + a.amount, 0);
    const potLabel = (a: PotAward): string =>
      a.reason === "fold" ? "底池" : a.potNo === 0 ? "主池" : "边池";
    let bannerTitle: string;
    if (winners.size === 1) {
      bannerTitle = `${winNameList[0]} 赢得 ${winTotal}`;
    } else {
      bannerTitle = this.engine.lastAwards
        .map((a) => {
          const names = a.winners.map((w) => w.name).join("、");
          return a.winners.length > 1
            ? `${potLabel(a)} ${names} 平分`
            : `${potLabel(a)} 归 ${names}`;
        })
        .join("，");
    }
    this.messages.showBanner(
      bannerTitle,
      this.engine.lastAwards.map((a) => {
        const names = a.winners.map((w) => w.name).join("、");
        return `${potLabel(a)} ${a.amount} ${names}${a.handDesc ? `（${a.handDesc}）` : ""}`;
      }),
    );
    // 金币从底池飞向赢家座位并爆开
    winners.forEach((id) =>
      this.winFx.fly(
        new Vec3(TABLE_CENTER.x, TABLE_CENTER.y, 0),
        this.seats[id].node.position.clone(),
        6,
      ),
    );
    if (this.engine.players[0].chips <= 0) {
      // 破产：稍后弹重开窗口
      this.scheduleOnce(
        () =>
          this.messages.showRestart("筹码输光了！", () => this.startMatch()),
        3.4,
      );
    } else {
      // 局末右下角提供「下一局 / 重开」手动控制
      this.endBar.show(() => this.nextHand(), () => this.startMatch());
    }
  }

  /** 续场：玩家破产弹重开，AI 破产自动重新买入 */
  private nextHand(): void {
    if (this.engine.players[0].chips <= 0) {
      this.messages.showRestart("筹码输光了！", () => this.startMatch());
      return;
    }
    this.engine.players.forEach((p) => {
      if (p.isBot && p.chips < this.engine.cfg.bigBlind) {
        p.chips = this.engine.cfg.startChips;
        this.messages.showPhase(
          `${p.name} 重新买入 ${this.engine.cfg.startChips} 筹码`,
        );
      }
    });
    this.engine.startHand();
  }

  private placeDealerMark(): void {
    // 庄家钮放下注筹码旁边（缺省左侧 70）：贴玩家动作区，不挡牌 / 筹码 / 名牌
    const s = SEAT_LAYOUT[this.engine.dealerIndex];
    const off = s.dealer ?? new Vec3(-70, 0, 0);
    this.dealerMark.setPosition(
      s.pos.x + s.bet.x + off.x,
      s.pos.y + s.bet.y + off.y,
      0,
    );
  }

  private refreshAll(): void {
    this.engine.players.forEach((p, i) => this.seats[i].refresh(p));
    const pending = this.engine.players.reduce((s, p) => s + p.betRound, 0);
    this.community.setPot(this.engine.potAmount + pending);
    this.seats.forEach((s, i) => s.setActing(this.engine.actingIndex === i));
    // 翻牌前在头像旁标出小盲 / 大盲座位
    const n = this.engine.players.length;
    const preflop = this.engine.phase === Phase.Preflop;
    const d = this.engine.dealerIndex;
    this.seats.forEach((s, i) => {
      s.setBlindTag(preflop && i === (d + 1) % n ? "sb" : preflop && i === (d + 2) % n ? "bb" : null);
    });
    this.lastBets = this.engine.players.map((p) => p.betRound);
    // 亮牌按钮：局内、已发牌、未亮过才显示
    const hero = this.engine.players[0];
    this.showBtn.node.active =
      !!hero && hero.inHand && !hero.showed && hero.hole.length >= 2 && this.engine.phase !== Phase.HandOver;
  }

  /** 主动亮牌：翻开自己的底牌给全场看（一手一次，不可收回） */
  private showMyCards(): void {
    const hero = this.engine.players[0];
    if (!hero || !hero.inHand || hero.showed || hero.hole.length < 2 || this.engine.phase === Phase.HandOver) {
      return;
    }
    hero.showed = true;
    this.seats[0].revealCards();
    this.seats[0].showAction("亮牌！");
    this.chatLog.push("你", "亮出了底牌");
    this.showBtn.node.active = false;
  }

  /** 收池动画：把上一街各座位下注点的筹码飞向底池（用 lastBets 里尚未清零的值） */
  private sweepBets(): void {
    let any = false;
    this.seats.forEach((s, i) => {
      const amt = this.lastBets[i] ?? 0;
      if (amt > 0) {
        any = true;
        const lay = SEAT_LAYOUT[i];
        this.winFx.flyChips(
          new Vec3(lay.pos.x + lay.bet.x, lay.pos.y + lay.bet.y, 0),
          new Vec3(TABLE_CENTER.x, TABLE_CENTER.y + 40, 0),
          Math.min(5, Math.max(2, Math.round(amt / 40))),
        );
        this.lastBets[i] = 0;
      }
    });
    if (any) {
      this.sfx.chip();
    }
  }

  /** 刷新玩家名牌上的牌型 / 胜率提示：弃牌 / 局末收起 */
  private updateHeroHint(): void {
    const hero = this.engine.players[0];
    if (!hero || !hero.inHand || hero.hole.length < 2) {
      this.seats[0].setHint("");
      return;
    }
    const opponents = this.engine.players.filter((p) => p.isBot && p.inHand).length;
    this.seats[0].setHint(
      buildHeroHint(hero.hole, this.engine.community, Math.max(1, opponents)),
    );
  }
}
