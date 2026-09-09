import { Injectable } from '@nestjs/common';

import type { ModuleMetadata, Provider } from '@nestjs/common';
import type { ITraceLogger } from '@tw/logger';
import type { HC_LOGGER } from './constants';

export type Method =
  | 'get' | 'GET'
  | 'post' | 'POST'
  | 'put' | 'PUT'
  | 'patch' | 'PATCH'
  | 'delete' | 'DELETE'
  | 'head' | 'HEAD'
  | 'options' | 'OPTIONS';

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string | string[]>;
}

export type ConnectOptions<B = boolean, D = undefined> = {
  url: string | URL;
  method: Method;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  /** Return the full `HttpResponse` envelope rather than just the parsed body. */
  fullResponse?: B;
  /**
   * Trace id for this call.
   *
   * Set it explicitly only when there is no inbound request to inherit from — a cron tick, a queue
   * consumer, a retry scheduled after the response was sent. Inside a request handler,
   * `RequestScopedHttpConnectionService` fills it in.
   */
  traceId?: string;
  /**
   * Overrides the module-level `userAgent` for this call.
   *
   * **This breaks the trace edge for that call** — the receiving service records what is sent here
   * as `caller`, so a value that is not this service's name makes the call an orphaned root. The
   * one legitimate use is a third-party API that demands a specific identity and is not part of our
   * traces anyway. Never reach for it to call another service of ours.
   *
   * Setting `user-agent` through `headers` does nothing: the connector writes the contract headers
   * last and strips every other casing variant first.
   */
  userAgent?: string;
  responseType?: 'json' | 'text' | 'arraybuffer';
  /** Milliseconds before the request is aborted and a 504 is thrown. */
  timeout?: number;
} & (D extends undefined ? { data?: unknown } : { data: D });

export interface IHttpConnectionOptions {
  /**
   * Provider for the logger the connector logs through. Must use the `HC_LOGGER` token.
   *
   * @example { provide: HC_LOGGER, useExisting: LoggerService }
   */
  logger: Provider<ITraceLogger> & { provide: typeof HC_LOGGER };

  /**
   * Identity sent as `User-Agent` on every outbound call.
   *
   * **This is what the receiving service records as `caller`, so it is the only thing that creates
   * an edge in a trace.** `x-trace-id` groups a trace's log lines; this is what turns them into a
   * call graph. It must equal the name this service logs under (`DEPLOYMENT_NAME`) or every call it
   * makes will appear in traces as an orphaned root — while each individual log line still reads as
   * perfectly correct.
   *
   * Required, and **validated at registration**: `forRoot()` throws on a missing, non-string or
   * blank value rather than letting the service boot and ship `User-Agent: "undefined"`.
   */
  userAgent: string;

  /**
   * Inbound header names forwarded onto outbound calls by the request-scoped connector.
   *
   * Neither contract header may appear here, and `forRoot()` throws if one does. Both have their
   * own dedicated, unconditional path, so forwarding them as well would put the inbound value in
   * the same header the connector writes its own into — the caller's `Mozilla/5.0…` competing with
   * this service's identity — and correlation cannot be switched off by reconfiguring forwarding.
   *
   * @default ['accept-language']
   */
  forwardHeaders?: string[];

  /** @default true */
  retry?: boolean;
  /** @default 2 */
  retryAttempts?: number;
  /** @default 300 — grows exponentially per attempt */
  retryDelay?: number;
  /** Milliseconds before a request is aborted, unless overridden per call. @default 15000 */
  timeout?: number;
  /**
   * Add a detailed record of every outbound request and response at `verbose`, with credentials
   * masked — headers, and the body where there is one.
   *
   * This controls the *detailed* pair only. A compact `request.out` / `response.in` pair is written
   * at `info` on every call regardless, because it is the caller's own statement that the call
   * happened: the callee's matching record exists only if the callee logs at all.
   *
   * @default true
   */
  verboseLogs?: boolean;
  /** @default true */
  isGlobal?: boolean;
}

export interface HttpConnectionAsyncMetadata extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: never[]) => IHttpConnectionOptions | Promise<IHttpConnectionOptions>;
  inject?: unknown[];
}

/** Resolved options, with defaults applied. Injected as a value provider. */
@Injectable()
export class HttpConnectionOptions implements IHttpConnectionOptions {
  logger!: IHttpConnectionOptions['logger'];
  userAgent!: string;
  forwardHeaders: string[] = ['accept-language'];
  retry = true;
  retryAttempts = 2;
  retryDelay = 300;
  timeout = 15_000;
  verboseLogs = true;
  isGlobal = true;
}
