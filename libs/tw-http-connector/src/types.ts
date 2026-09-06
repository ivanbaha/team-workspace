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
  /** Overrides the module-level `userAgent` for this call. Rarely needed. */
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
   * an edge in a trace.** It must equal the name this service logs under (`DEPLOYMENT_NAME`) or
   * every call it makes will appear in traces as an orphaned root.
   */
  userAgent: string;

  /**
   * Inbound header names forwarded onto outbound calls by the request-scoped connector.
   *
   * The trace id is deliberately **not** in this list — it has its own dedicated path that cannot be
   * switched off by reconfiguring header forwarding.
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
   * Log every outbound request and response at `silly`, with credentials masked.
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
