/**
 * 启动体验辅助（仅 web 平台生效，编辑器 / 原生安全跳过）：
 * - 注入编辑框 DOM 样式：Cocos 网页端聚焦编辑时显示的就是原生 input/textarea 覆盖层，
 *   文字颜色必须可见（引擎会把它内联成标签色，此处统一暖白），
 *   背景压成透明避免白色色块；触屏设备 font-size 固定 16px 防止 iOS 聚焦时自动放大页面。
 * - 移动端首次触摸尝试全屏并锁定横屏：浏览器安全策略要求两者必须由用户手势触发，
 *   这是网页游戏通行的「进游戏自动全屏横屏」做法（iOS Safari 不支持则静默跳过）。
 * - 启动遮罩：等资源真正就绪后再隐藏，避免露出代码绘制的兜底桌面。
 */

/** 只改视觉属性；宽高 / 定位由引擎内联样式管理，不能覆盖 */
const BOOT_CSS = [
  'canvas{touch-action:manipulation}',
  // 引擎聚焦编辑时挂载的原生 input/textarea 不带任何内联背景，
  // 白色块全部来自浏览器 UA 默认样式：此处对全文档所有输入控件做无死角覆盖
  'input,textarea{',
  'background:transparent!important;',
  'background-color:transparent!important;',
  'background-image:none!important;',
  'color:#f5f0dc!important;',
  'caret-color:transparent!important;',
  'border:none!important;',
  'outline:none!important;',
  'box-shadow:none!important;',
  'text-shadow:none!important;',
  'border-radius:0!important;',
  'resize:none!important;',
  '-webkit-appearance:none!important;',
  'appearance:none!important;',
  // 引擎聚焦时挂载的原生输入框会被浏览器画上默认滚动条（白底轨道 + 上下箭头），
  // 多行框引擎还内联了 overflowY:scroll：overflow:hidden!important 优先级高于内联样式可一并压掉，
  // scrollbar-width 兜底 Firefox，-ms-overflow-style 兜底旧 Edge
  'overflow:hidden!important;',
  'scrollbar-width:none!important;',
  '-ms-overflow-style:none!important;',
  '}',
  'input::-webkit-scrollbar,textarea::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}',
  'input::-webkit-inner-spin-button,input::-webkit-outer-spin-button{-webkit-appearance:none!important;margin:0!important}',
  'input::placeholder,textarea::placeholder{color:transparent!important}',
  'input::selection,textarea::selection{background:rgba(245,196,105,.35)!important}',
  '@media (pointer:coarse){input,textarea{font-size:16px!important}}',
].join('')

/** 网页环境注入样式与首次触摸全屏；非 web 环境无操作 */
export function setupBootDom(): void {
  if (typeof document === 'undefined') {
    return
  }
  const style = document.createElement('style')
  style.textContent = BOOT_CSS
  document.head.appendChild(style)
  // 移动端首次触摸：进全屏并锁横屏（浏览器要求两者都必须由用户手势触发）
  document.addEventListener('touchend', enterFullscreen, { once: true, passive: true })
}

/** 全屏操作结果：ok 成功；unsupported 浏览器无此能力（如 iPhone）；rejected 被浏览器拒绝 */
export type FullscreenResult = 'ok' | 'unsupported' | 'rejected'

/** 进全屏，成功后（移动端）锁定横屏；结果返回给调用方做提示，不再无声吞错 */
export async function enterFullscreen(): Promise<FullscreenResult> {
  if (typeof document === 'undefined') {
    return 'unsupported'
  }
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void
  }
  if (typeof el.requestFullscreen !== 'function' && typeof el.webkitRequestFullscreen !== 'function') {
    return 'unsupported'
  }
  try {
    const req = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.()
    await Promise.resolve(req)
    lockLandscape()
    return 'ok'
  } catch (e) {
    console.warn('[fullscreen] 进入全屏被拒：', e)
    return 'rejected'
  }
}

/** 退出全屏；结果返回给调用方做提示 */
export async function exitFullscreen(): Promise<FullscreenResult> {
  if (typeof document === 'undefined') {
    return 'unsupported'
  }
  const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void }
  if (typeof doc.exitFullscreen !== 'function' && typeof doc.webkitExitFullscreen !== 'function') {
    return 'unsupported'
  }
  try {
    const req = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.()
    await Promise.resolve(req)
    return 'ok'
  } catch (e) {
    console.warn('[fullscreen] 退出全屏被拒：', e)
    return 'rejected'
  }
}

/** 全屏切换（右上角按钮用）：当前全屏则退出，否则进入 */
export async function toggleFullscreen(): Promise<FullscreenResult> {
  if (typeof document === 'undefined') {
    return 'unsupported'
  }
  const doc = document as Document & { webkitFullscreenElement?: Element | null }
  return document.fullscreenElement || doc.webkitFullscreenElement ? exitFullscreen() : enterFullscreen()
}

/** 锁横屏：仅 Android Chrome 等支持（且需在全屏态），iOS Safari 无此能力静默跳过 */
function lockLandscape(): void {
  if (typeof screen === 'undefined' || !screen.orientation) {
    return
  }
  const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
  try {
    so.lock?.('landscape').catch(() => undefined)
  } catch {
    // 静默
  }
}

/** 隐藏 web 构建的启动遮罩（index.html 注入；编辑器 / 原生无此函数，安全跳过） */
export function hideBootSplash(): void {
  if (typeof window === 'undefined') {
    return
  }
  ;(window as unknown as { __hideBootSplash?: () => void }).__hideBootSplash?.()
}

/**
 * 等待资源就绪：全部 resolve 或超过 fallbackMs（网络极慢 / 资源缺失）后放行，
 * 保证游戏永远不会被卡死在遮罩后面；任何 rejection 都按就绪处理（各资源自带降级）。
 */
export function settle(promises: Promise<unknown>[], fallbackMs = 30000): Promise<void> {
  return Promise.race([
    Promise.all(promises).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, fallbackMs)),
  ])
}
