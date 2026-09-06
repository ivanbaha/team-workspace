import { resolveRequestLoggingMode } from './resolve-request-logging';

describe('resolveRequestLoggingMode', () => {
  it('defaults to compact, so tracing works with no configuration at all', () => {
    expect(resolveRequestLoggingMode(undefined, undefined)).toBe('compact');
    expect(resolveRequestLoggingMode(undefined, 'info')).toBe('compact');
  });

  it('upgrades to full when the level is silly', () => {
    expect(resolveRequestLoggingMode(undefined, 'silly')).toBe('full');
  });

  it('lets an explicit mode win over the level', () => {
    expect(resolveRequestLoggingMode('off', 'silly')).toBe('off');
    expect(resolveRequestLoggingMode('full', 'info')).toBe('full');
  });

  it('ignores an unrecognised mode rather than failing to start', () => {
    expect(resolveRequestLoggingMode('verbose-ish', 'info')).toBe('compact');
  });
});
