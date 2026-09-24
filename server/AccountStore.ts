import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { DatabaseSync } from 'node:sqlite'

/**
 * 账号存储：用户名（支持中文）+ scrypt 加盐哈希密码 + 生涯胜负数。
 * 密码绝不落明文；登录成功发一次性随机 token（仅存内存，重启后需重新登录）。
 * sqlite 文件按需创建，selftest 传 ':memory:' 隔离。
 */

export interface Account {
  name: string
  won: number
  played: number
}

const NAME_MAX = 8
const PASS_MAX = 24

export class AccountStore {
  private readonly db: DatabaseSync
  /** token → 用户名（内存态：服务重启即失效，客户端自动回落账密登录） */
  private readonly tokens = new Map<string, string>()

  constructor(dbPath: string) {
    const file = dbPath === ':memory:' ? ':memory:' : resolve(dbPath)
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true })
    }
    this.db = new DatabaseSync(file)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        name TEXT PRIMARY KEY,
        pass TEXT NOT NULL,
        won INTEGER NOT NULL DEFAULT 0,
        played INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
      )
    `)
  }

  /** 注册：用户名 1~8 个字符（按码点）、密码 1~24 个字符；重名拒绝 */
  register(rawName: string, rawPass: string): { ok: true; account: Account; token: string } | { ok: false; msg: string } {
    const name = sanitizeName(rawName)
    const pass = String(rawPass ?? '').trim()
    if (!name) {
      return { ok: false, msg: '用户名不能为空' }
    }
    if ([...name].length > NAME_MAX) {
      return { ok: false, msg: `用户名最多 ${NAME_MAX} 个字` }
    }
    if (!pass) {
      return { ok: false, msg: '密码不能为空' }
    }
    if ([...pass].length > PASS_MAX) {
      return { ok: false, msg: `密码最多 ${PASS_MAX} 个字符` }
    }
    if (this.getAccount(name)) {
      return { ok: false, msg: '用户名已被注册' }
    }
    this.db
      .prepare('INSERT INTO accounts (name, pass, won, played, createdAt) VALUES (?, ?, 0, 0, ?)')
      .run(name, hashPass(pass), Date.now())
    return { ok: true, account: { name, won: 0, played: 0 }, token: this.issueToken(name) }
  }

  /** 账密登录：timingSafeEqual 防时序侧信道 */
  login(rawName: string, rawPass: string): { ok: true; account: Account; token: string } | { ok: false; msg: string } {
    const name = sanitizeName(rawName)
    const row = this.db.prepare('SELECT name, pass, won, played FROM accounts WHERE name = ?').get(name) as
      | { name: string; pass: string; won: number; played: number }
      | undefined
    // 无此账号也做一次同开销哈希，避免「响应快慢」泄露账号是否存在
    const expect = row ? row.pass : hashPass('decoy')
    if (!row || !verifyPass(String(rawPass ?? ''), expect)) {
      return { ok: false, msg: '用户名或密码不正确' }
    }
    return {
      ok: true,
      account: { name: row.name, won: row.won, played: row.played },
      token: this.issueToken(name),
    }
  }

  /** token 续登（自动登录 / 断线找回） */
  loginByToken(token: string): { ok: true; account: Account; token: string } | { ok: false; msg: string } {
    const name = this.tokens.get(String(token ?? ''))
    if (!name) {
      return { ok: false, msg: '登录已过期，请重新登录' }
    }
    const row = this.db.prepare('SELECT name, won, played FROM accounts WHERE name = ?').get(name) as
      | { name: string; won: number; played: number }
      | undefined
    if (!row) {
      this.tokens.delete(token)
      return { ok: false, msg: '账号不存在' }
    }
    return { ok: true, account: { name: row.name, won: row.won, played: row.played }, token }
  }

  getAccount(name: string): Account | null {
    const row = this.db.prepare('SELECT name, won, played FROM accounts WHERE name = ?').get(sanitizeName(name)) as
      | { name: string; won: number; played: number }
      | undefined
    return row ? { name: row.name, won: row.won, played: row.played } : null
  }

  /** 局末累计生涯战绩（账号座位每手 played+1，赢家 won+1） */
  addStats(name: string, won: number, played: number): void {
    if (won === 0 && played === 0) {
      return
    }
    this.db
      .prepare('UPDATE accounts SET won = won + ?, played = played + ? WHERE name = ?')
      .run(won, played, name)
  }

  private issueToken(name: string): string {
    // 每次登录换新 token（旧 token 自然作废，等同单点登录）
    for (const [t, n] of this.tokens) {
      if (n === name) {
        this.tokens.delete(t)
      }
    }
    const token = randomBytes(24).toString('hex')
    this.tokens.set(token, name)
    return token
  }
}

// ---------- 纯函数 ----------

/** 名字清洗：去首尾空白、按码点截断（避免劈开中文代理对） */
function sanitizeName(raw: string): string {
  return [...String(raw ?? '').replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('')
}

/** scrypt 加盐哈希，格式 salt:hash（hex） */
function hashPass(pass: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pass, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPass(pass: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) {
    return false
  }
  const actual = scryptSync(pass, salt, 64)
  const expect = Buffer.from(hash, 'hex')
  return actual.length === expect.length && timingSafeEqual(actual, expect)
}
