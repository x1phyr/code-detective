export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export function describeFetchError(error: unknown, url: string): string {
  if (isAbortError(error)) return 'AI 请求已取消或超时。';
  const message = error instanceof Error ? error.message : String(error);
  return `无法连接 AI 服务 ${url}：${message}。请确认本地模型服务已启动。`;
}
