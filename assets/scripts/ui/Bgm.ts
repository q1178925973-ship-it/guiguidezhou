import { AudioClip, AudioSource, Node, assetManager } from 'cc'

/** 操作音效的峰值增益（SoundFx.tone 的默认上限），BGM 固定取它的 20% —— 只做氛围不抢戏 */
const SFX_PEAK_GAIN = 0.07
const BGM_VOLUME = SFX_PEAK_GAIN * 0.2

/**
 * 背景音乐：刻意不放进首包（不拖慢进入游戏的速度），
 * 玩家首次触摸后从部署服务器懒加载 /audio/bgm.mp3 循环播放；
 * 没放音频文件时静默跳过（loadRemote err 分支，不重试不报错）。
 * 与音效共用工具条上的声音开关：静音只是把音量收零，取消静音立即恢复。
 */
export class Bgm {
  private readonly host: Node
  private source: AudioSource | null = null
  private muted = false
  private tried = false

  constructor(host: Node) {
    this.host = host
  }

  /** 首次用户手势时调用（浏览器自动播放策略要求）；重复调用安全 */
  userGesture(): void {
    if (this.tried) {
      return
    }
    this.tried = true
    const url = this.resolveUrl()
    if (!url) {
      return
    }
    assetManager.loadRemote<AudioClip>(url, { ext: '.mp3' }, (err, clip) => {
      if (err || !clip || !this.host.isValid) {
        return
      }
      const src = this.host.addComponent(AudioSource)
      src.clip = clip
      src.loop = true
      src.volume = this.muted ? 0 : BGM_VOLUME
      this.source = src
      src.play()
    })
  }

  /** 声音开关联动（与工具条音效钮共用一个开关） */
  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.source) {
      this.source.volume = muted ? 0 : BGM_VOLUME
    }
  }

  /** 任意部署环境都从同源 /audio/bgm.mp3 加载（本地 server/web/audio 也放着同名文件）；
   *  音频缺失时 loadRemote 走 err 分支静默跳过，编辑器预览无噪音 */
  private resolveUrl(): string | null {
    if (typeof location === 'undefined') {
      return null
    }
    return `${location.origin}/audio/bgm.mp3`
  }
}
