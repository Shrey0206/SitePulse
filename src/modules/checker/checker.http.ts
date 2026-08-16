export interface CheckResult {
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
}

export interface CheckableMonitor {
  url: string;
  timeoutSeconds: number;
  expectedStatus: number;
}

export async function performHttpCheck(monitor: CheckableMonitor): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), monitor.timeoutSeconds * 1000);
  const start = performance.now();

  try {
    const response = await fetch(monitor.url, { signal: controller.signal, redirect: 'follow' });
    const responseTimeMs = Math.round(performance.now() - start);
    return {
      success: response.status === monitor.expectedStatus,
      statusCode: response.status,
      responseTimeMs,
      error: null,
    };
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = isAbort ? 'Request timed out' : err instanceof Error ? err.message : 'Unknown error';
    return { success: false, statusCode: null, responseTimeMs, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
