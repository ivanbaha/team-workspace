import { maskString } from './mask-string.util';

/**
 * Headers whose values carry credentials or session material.
 *
 * Masking beats omitting: a request that failed authentication is far easier to diagnose when you
 * can see that an `Authorization` header was present and what shape it had.
 */
const SENSITIVE_HEADER_NAMES = new Set<string>([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-amzn-oidc-data',
  'x-amzn-oidc-accesstoken',
]);

/** Body field names whose values carry credentials. */
const SENSITIVE_BODY_PARAM_NAMES = [
  'client_secret',
  'client_id',
  'password',
  'passwordhash',
  'refresh_token',
  'access_token',
  'assertion',
  'code',
];

/**
 * Query param names masked in logged URLs.
 *
 * Deliberately narrower than the body list. `code` and `client_id` are omitted because business
 * identifiers (`?code=DE`, `?client_id=acme`) use those names far more often than OAuth does, and
 * masking them would obscure the very request being debugged.
 */
const SENSITIVE_QUERY_PARAM_NAMES = [
  'client_secret',
  'password',
  'refresh_token',
  'access_token',
  'id_token',
  'token',
  'assertion',
  'secret',
  'api_key',
  'apikey',
];

const SENSITIVE_BODY_PARAM_REGEXES = buildParamRegexes(SENSITIVE_BODY_PARAM_NAMES);
const SENSITIVE_QUERY_PARAM_REGEXES = buildParamRegexes(SENSITIVE_QUERY_PARAM_NAMES);

function buildParamRegexes(names: string[]): RegExp[] {
  return names.map((name) => new RegExp(`(^|&)(${name})=([^&]*)`, 'gi'));
}

function maskUrlEncoded(input: string, regexes: RegExp[]): string {
  let masked = input;
  for (const regex of regexes) {
    masked = masked.replace(regex, (_match, prefix: string, name: string, value: string) => {
      return `${prefix}${name}=${maskString(value) ?? ''}`;
    });
  }
  return masked;
}

function maskHeaderValue(lowerName: string, value: string): string {
  if (lowerName === 'authorization' || lowerName === 'proxy-authorization') {
    // Keep the scheme readable — "Basic where Bearer was expected" is a real and common bug.
    const match = /^(Bearer|Basic)\s+(.+)$/i.exec(value);
    if (match) return `${match[1]} ${maskString(match[2]) ?? ''}`;
  }
  return maskString(value) ?? value;
}

/**
 * Copies headers with sensitive values masked. Name matching is case-insensitive; array values
 * (`set-cookie`) are masked element by element.
 */
export function maskHeadersForLog(headers?: Record<string, unknown>): Record<string, unknown> {
  if (!headers) return {};

  const out: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!SENSITIVE_HEADER_NAMES.has(lower) || rawValue == null || rawValue === '') {
      out[key] = rawValue;
      continue;
    }

    out[key] = Array.isArray(rawValue)
      ? rawValue.map((entry) => maskHeaderValue(lower, String(entry)))
      : maskHeaderValue(lower, String(rawValue));
  }
  return out;
}

/**
 * Copies a request or response body with sensitive fields masked.
 *
 * - URL-encoded strings: known credential params are masked.
 * - Plain objects: known credential fields are masked **at the top level only**. Walking an
 *   arbitrary payload runs on every request, and secrets nested three levels deep are a code smell
 *   worth fixing rather than a case worth paying for on the hot path.
 * - Everything else is returned unchanged.
 */
export function maskBodyForLog(body: unknown): unknown {
  if (body == null) return body;

  if (typeof body === 'string') {
    return maskUrlEncoded(body, SENSITIVE_BODY_PARAM_REGEXES);
  }

  if (typeof body === 'object' && !Buffer.isBuffer(body) && !Array.isArray(body)) {
    const masked: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const key of Object.keys(masked)) {
      if (!SENSITIVE_BODY_PARAM_NAMES.includes(key.toLowerCase())) continue;
      const value = masked[key];
      if (value == null) continue;
      masked[key] = maskString(typeof value === 'string' ? value : String(value)) ?? '';
    }
    return masked;
  }

  return body;
}

/** Returns the URL with credential-bearing query values masked. The path is left untouched. */
export function maskUrlForLog(url?: string): string {
  if (!url) return '';

  const separatorIndex = url.indexOf('?');
  if (separatorIndex === -1) return url;

  const path = url.slice(0, separatorIndex);
  const query = url.slice(separatorIndex + 1);
  return `${path}?${maskUrlEncoded(query, SENSITIVE_QUERY_PARAM_REGEXES)}`;
}
