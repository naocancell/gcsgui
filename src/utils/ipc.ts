import { invoke } from '@tauri-apps/api/core'
import { logger } from './logger'

/**
 * 结构化领域错误标准属性接口
 */
export interface AppError {
  /** 5 位标准化业务错误码 */
  code: number
  /** 领域分类 (System, Comms, Uplink, GIS, etc.) */
  category: string
  /** 面向操作员的错误描述 */
  message: string
  /** 详细堆栈或技术详情 */
  detail?: string
  /** 是否属于可恢复性错误 */
  recoverable: boolean
}

/**
 * 继承自 Error 的结构化异常类
 * 保障 instanceof Error 为 true，且字符串拼接时输出可读的错误文本，避免 [object Object]
 */
export class AppCustomError extends Error implements AppError {
  readonly code: number
  readonly category: string
  readonly detail?: string
  readonly recoverable: boolean

  constructor(appError: AppError) {
    super(appError.message)
    this.name = 'AppError'
    this.code = appError.code
    this.category = appError.category
    this.detail = appError.detail
    this.recoverable = appError.recoverable
    Object.setPrototypeOf(this, new.target.prototype)
  }

  override toString(): string {
    if (this.code === 10001 && this.category === 'IPC') {
      return `[IPC] ${this.message}`
    }
    return `[E${this.code}:${this.category}] ${this.message}`
  }
}

function safeStringify(val: unknown): string {
  try {
    return typeof val === 'string' ? val : JSON.stringify(val)
  } catch {
    return String(val)
  }
}

/**
 * 将任意未知异常归一化为标准的 AppCustomError 实例
 */
export function normalizeAppError(cmd: string, err: unknown): AppCustomError {
  if (err instanceof AppCustomError) {
    return err
  }

  if (err && typeof err === 'object') {
    const candidate = err as Partial<AppError>
    if (typeof candidate.code === 'number' && typeof candidate.message === 'string') {
      return new AppCustomError({
        code: candidate.code,
        category: candidate.category || 'IPC',
        message: candidate.message,
        detail: candidate.detail,
        recoverable: candidate.recoverable !== false,
      })
    }
    if (err instanceof Error) {
      return new AppCustomError({
        code: 10001,
        category: 'Client',
        message: err.message,
        detail: err.stack,
        recoverable: true,
      })
    }
  }

  const msg = safeStringify(err)
  return new AppCustomError({
    code: 10001,
    category: 'IPC',
    message: msg || `调用后端命令 ${cmd} 失败`,
    recoverable: true,
  })
}

export interface InvokeOptions {
  /** 是否静默处理（不自动记录日志，适合上层自主控制或后台非致命查询） */
  silent?: boolean
}

/**
 * 安全 IPC 调用门面
 * - 拦截后端错误并归一化为 AppCustomError
 * - 非 silent 模式下记录 logger.error
 * - 确保抛出标准 Error 实例，阻断 [object Object] 坏死提示
 */
export async function invokeSafe<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (err: unknown) {
    const appError = normalizeAppError(cmd, err)
    if (!options?.silent) {
      logger.error(`[IPC:${cmd}] 调用失败 ${appError.toString()}`, appError)
    }
    throw appError
  }
}

export default invokeSafe
