import { BotBrain } from '../core/BotBrain'
import { GameEngine } from '../core/GameEngine'
import { Act, ActKind, Phase } from '../core/Types'
import { DEEPSEEK_KEY, DEEPSEEK_MODEL, DEEPSEEK_URL } from './DeepSeekKey.local'
import { Persona, personaOf, pickLine, lineKeyOf } from './Personas'

/** 机器人决策结果：动作 + 一句台词 */
export interface BotDecision {
  act: Act
  say: string
}

const PHASE_NAMES: Partial<Record<Phase, string>> = {
  [Phase.Preflop]: '翻牌前',
  [Phase.Flop]: '翻牌',
  [Phase.Turn]: '转牌',
  [Phase.River]: '河牌',
}

const pick = pickLine

/** 服务器（Node）可用环境变量注入 key，避免写进仓库与浏览器构建产物 */
function envDeepseekKey(): string {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env.DEEPSEEK_API_KEY || ''
    }
  } catch {
    // 浏览器等无 process 环境：忽略
  }
  return ''
}

export interface AiAdvisorOpts {
  /** 单次请求超时（毫秒） */
  timeoutMs?: number
  /** 失败重试次数 */
  retries?: number
}

/**
 * 机器人军师：优先问 DeepSeek（决策 + 台词一次返回），
 * 失败（断网 / 超时 / 返回不合法）自动降级本地 BotBrain + 台词池。
 * key 优先取 DeepSeekKey.local（浏览器端），服务器端可用 DEEPSEEK_API_KEY 环境变量覆盖。
 */
export class AiAdvisor {
  private warned = false
  private readonly timeoutMs: number
  private readonly retries: number

  constructor(opts: AiAdvisorOpts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 8000
    this.retries = opts.retries ?? 1
  }

  /** persona 缺省按单机座位人设；联机服务器按座位名传入 */
  async decide(engine: GameEngine, botId: number, persona: Persona = personaOf(botId)): Promise<BotDecision> {
    try {
      const content = await this.chat(persona, buildPrompt(engine, botId))
      const data = extractJson(content)
      const act = sanitizeAct(data, engine, botId)
      const say = typeof data.say === 'string' ? data.say.slice(0, 24) : ''
      return { act, say: say || pick(persona.lines[lineKeyOf(act)]) }
    } catch (err) {
      if (!this.warned) {
        this.warned = true
        console.warn('[AI] DeepSeek 调用失败，机器人已降级为本地决策：', err)
      }
      const act = new BotBrain().decide(engine, botId)
      return { act, say: pick(persona.lines[lineKeyOf(act)]) }
    }
  }

  /** 带超时的对话请求，失败按配置重试 */
  private async chat(persona: Persona, prompt: string): Promise<string> {
    const key = DEEPSEEK_KEY || envDeepseekKey()
    if (!key) {
      throw new Error('未配置 DeepSeek key（本地见 ai/DeepSeekKey.local.ts，服务器可设 DEEPSEEK_API_KEY），直接使用本地决策')
    }
    let lastErr: unknown = null
    for (let i = 0; i <= this.retries; i++) {
      try {
        return await this.chatOnce(persona, prompt, key)
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr
  }

  private async chatOnce(persona: Persona, prompt: string, key: string): Promise<string> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: persona.system },
            { role: 'user', content: prompt },
          ],
          temperature: 0.9,
          max_tokens: 120,
        }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const content = json.choices?.[0]?.message?.content
      if (!content) {
        throw new Error('空响应')
      }
      return content
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 组装当前局面提示词 */
function buildPrompt(engine: GameEngine, botId: number): string {
  const me = engine.byId(botId)!
  const legal = engine.getLegalActs(botId)
  const pot = engine.potAmount + engine.players.reduce((s, p) => s + p.betRound, 0)
  const opponents = engine.players
    .filter((p) => p.id !== botId)
    .map((p) => `${p.name}(筹码${p.chips} 本轮下注${p.betRound}${p.folded ? ' 已弃牌' : ''}${p.allIn ? ' 全下' : ''})`)
    .join('；')
  const options = [
    '弃牌',
    legal.canCheck ? '过牌' : `跟注 ${legal.callAmount}`,
    legal.canRaise ? `加注到 ${legal.raiseMinTo} ~ ${legal.raiseMaxTo}（raiseTo 在此区间）` : '（本回合不能加注）',
  ]
  return [
    `德州扑克单局局面（阶段：${PHASE_NAMES[engine.phase] ?? engine.phase}）`,
    `我的底牌：${me.hole.map((c) => c.toString()).join(' ')}`,
    `公共牌：${engine.community.map((c) => c.toString()).join(' ') || '（还没发）'}`,
    `我的筹码：${me.chips}，本轮已下注：${me.betRound}，当前最高注：${engine.currentBet}，底池：${pot}`,
    `对手：${opponents}`,
    `可选动作：${options.join('；')}`,
    '请决策并只输出 JSON：{"action":"fold|check|call|raise","raiseTo":整数,"say":"台词"}（台词不要用 emoji 和颜文字）',
  ].join('\n')
}

/** 从模型回复里抠出 JSON（容忍代码围栏/多余文字） */
function extractJson(content: string): Record<string, unknown> {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('回复中没有 JSON')
  }
  return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>
}

/** 把模型动作清洗成引擎一定接受的合法动作 */
function sanitizeAct(data: Record<string, unknown>, engine: GameEngine, botId: number): Act {
  const legal = engine.getLegalActs(botId)
  const a = String(data.action ?? '').toLowerCase()
  if ((a === 'raise' || a === 'bet') && legal.canRaise) {
    const t = Math.round(Number(data.raiseTo))
    if (Number.isFinite(t)) {
      return {
        kind: ActKind.Raise,
        raiseTo: Math.max(legal.raiseMinTo, Math.min(legal.raiseMaxTo, t)),
      }
    }
    return { kind: ActKind.Raise, raiseTo: legal.raiseMinTo }
  }
  if (a === 'call') {
    return legal.canCheck ? { kind: ActKind.Check } : { kind: ActKind.Call }
  }
  if (a === 'check') {
    return legal.canCheck ? { kind: ActKind.Check } : { kind: ActKind.Call }
  }
  if (a === 'fold') {
    return { kind: ActKind.Fold }
  }
  // 无法理解时交给本地决策兜底
  return new BotBrain().decide(engine, botId)
}
