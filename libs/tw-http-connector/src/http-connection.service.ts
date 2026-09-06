import { HttpException, Inject, Injectable } from '@nestjs/common';
import { maskBodyForLog, maskHeadersForLog, maskUrlForLog } from '@tw/logger';
import { TRACE_ID_HEADER } from '@tw/tracing';
import { HC_LOGGER } from './constants';
import { errorToString } from './utils';

import type { ITraceLogger } from '@tw/logger';
import type { ConnectOptions, HttpResponse } from './types';
import { HttpConnectionOptions } from './types';

const METHODS_WITH_BODY = ['POST', 'PUT', 'PATCH'];

/**
 * The process-wide outbound HTTP client.
 *
 * Built on native `fetch`. It does the actual work — header assembly, retries, timeouts, response
 * parsing, error mapping — and it is a singleton, so it is deliberately **request-agnostic**: it
 * never reads an ambient trace id. A caller either passes `traceId`, or passes an `x-trace-id`
 * header, or the call goes out untraced.
 *
 * That strictness is the point. Inside a request handler, inject
 * {@link RequestScopedHttpConnectionService} instead — it inherits the id from the request. Use
 * this class directly for work that has no request: cron ticks, queue consumers, bootstrap.
 */
@Injectable()
export class HttpConnectionService {
  constructor(
    private readonly options: HttpConnectionOptions,
    @Inject(HC_LOGGER) private readonly logger: ITraceLogger,
  ) {}

  /**
   * Performs an outbound HTTP request.
   *
   * @throws {HttpException} On a non-2xx response, carrying the upstream status and parsed body, so
   *   a failing dependency surfaces to the caller as that dependency's status rather than a 500.
   */
  async connect<RT = unknown, DT = undefined, B extends boolean = false>(
    params: ConnectOptions<B, DT>,
  ): Promise<B extends true ? HttpResponse<RT> : RT> {
    const { url, method: rawMethod, traceId: explicitTraceId, fullResponse, responseType, timeout, ...rest } = params;

    const href = url instanceof URL ? url.toString() : url;
    const method = rawMethod.toUpperCase();
    const traceId = explicitTraceId ?? this.getHeader(rest.headers, TRACE_ID_HEADER);

    const headers = this.buildHeaders(rest.headers, rest.userAgent, traceId, method, rest.data);
    const body = this.buildBody(method, rest.data);
    const requestUrl = this.buildUrl(href, rest.params);

    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(timeout ?? this.options.timeout),
    };

    if (this.options.verboseLogs) {
      this.logger.silly(
        JSON.stringify({
          direction: 'request',
          url: maskUrlForLog(requestUrl),
          method,
          headers: maskHeadersForLog(headers),
          ...(body !== undefined ? { body: maskBodyForLog(body) } : {}),
        }),
        'HttpConnectionService.connect',
        traceId,
      );
    }

    let response: Response;
    try {
      response = await this.fetchWithRetry(requestUrl, init, traceId);
    } catch (error) {
      this.logger.error(
        `Request to ${maskUrlForLog(requestUrl)} failed: ${errorToString(error)}`,
        error instanceof Error ? error.stack : undefined,
        'HttpConnectionService.connect',
        traceId,
      );
      // 504: the upstream never answered. Distinguishable from an upstream that answered with 500.
      throw new HttpException(`Upstream request failed: ${errorToString(error)}`, 504);
    }

    const data = await this.parseResponseBody(response, responseType);

    if (this.options.verboseLogs) {
      this.logger.silly(
        JSON.stringify({
          direction: 'response',
          url: maskUrlForLog(requestUrl),
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type'),
        }),
        'HttpConnectionService.connect',
        traceId,
      );
    }

    if (!response.ok) throw new HttpException((data as never) ?? response.statusText, response.status);

    if (fullResponse) {
      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: this.headersToRecord(response.headers),
      } as B extends true ? HttpResponse<RT> : RT;
    }

    return data as B extends true ? HttpResponse<RT> : RT;
  }

  /*************************************************************************
   *                           PRIVATE METHODS                             *
   ************************************************************************/

  /**
   * Assembles the outgoing headers.
   *
   * Two of these lines are the entire outbound half of the tracing system: the trace id is written
   * last so it always wins, and every other casing variant is deleted first so exactly one
   * `x-trace-id` reaches the wire. A request carrying both `X-Trace-Id` and `x-trace-id` is a
   * request whose downstream service picks one at random.
   */
  private buildHeaders(
    incoming: Record<string, string> | undefined,
    userAgent: string | undefined,
    traceId: string | undefined,
    method: string,
    data: unknown,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      // Sent on every call. Without it the receiving service records `caller: "node"` and the edge
      // it would have contributed to the trace is lost.
      'User-Agent': userAgent ?? this.options.userAgent,
      ...incoming,
    };

    if (traceId) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === TRACE_ID_HEADER) delete headers[key];
      }
      headers[TRACE_ID_HEADER] = traceId;
    }

    if (METHODS_WITH_BODY.includes(method)) {
      if (!this.getHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    } else if (data === undefined) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-type') delete headers[key];
      }
    }

    return headers;
  }

  private buildBody(method: string, data: unknown): string | undefined {
    if (!METHODS_WITH_BODY.includes(method)) return undefined;
    const payload = data ?? {};
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  }

  private buildUrl(href: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) return href;

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      // Omitting null/undefined rather than serialising them as "undefined" — an accidental
      // `?status=undefined` is a filter the upstream will honour, and a confusing bug.
      if (value === undefined || value === null) continue;
      search.append(key, ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : JSON.stringify(value));
    }

    const query = search.toString();
    if (!query) return href;
    return `${href}${href.includes('?') ? '&' : '?'}${query}`;
  }

  /**
   * Retries transport failures and 5xx responses with exponential backoff.
   *
   * 4xx is never retried: the upstream understood the request and rejected it, so sending it again
   * only multiplies the load while it is already unhappy.
   */
  private async fetchWithRetry(url: string, init: RequestInit, traceId?: string): Promise<Response> {
    const attempts = this.options.retry ? this.options.retryAttempts : 0;
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt <= attempts; attempt++) {
      if (attempt > 0) {
        const delay = this.options.retryDelay * 2 ** (attempt - 1);
        this.logger.warn(
          `Retrying ${init.method} ${maskUrlForLog(url)} (attempt ${attempt}/${attempts}) after ${delay}ms`,
          'HttpConnectionService.fetchWithRetry',
          traceId,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const response = await fetch(url, init);
        if (response.status < 500) return response;
        lastResponse = response;
      } catch (error) {
        if (attempt === attempts) throw error;
      }
    }

    if (lastResponse) return lastResponse;
    throw new Error(`Request to ${url} failed after ${attempts + 1} attempt(s)`);
  }

  private async parseResponseBody(response: Response, responseType?: 'json' | 'text' | 'arraybuffer'): Promise<unknown> {
    if (responseType === 'arraybuffer') return Buffer.from(await response.arrayBuffer());

    // Read as text once — a Response body can only be consumed a single time, so trying JSON first
    // and falling back would leave nothing to fall back to.
    const text = await response.text().catch(() => '');
    if (!text) return null;
    if (responseType === 'text') return text;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private headersToRecord(headers: Headers): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    headers.forEach((value, key) => (out[key] = value));

    const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === 'function') {
      const cookies = getSetCookie.call(headers);
      if (cookies.length > 1) out['set-cookie'] = cookies;
    }
    return out;
  }

  /** Case-insensitive header lookup, for headers a caller assembled by hand. */
  private getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
    if (!headers) return undefined;

    const target = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === target) return headers[key];
    }
    return undefined;
  }
}
