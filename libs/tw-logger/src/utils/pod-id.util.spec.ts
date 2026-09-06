import { extractPodId } from './pod-id.util';

describe('extractPodId', () => {
  it('strips the service name prefix', () => {
    expect(extractPodId('orders-service-b4799cf77-8t452', 'orders-service')).toBe('b4799cf77-8t452');
  });

  it('falls back to the last two segments when the pod is named after something else', () => {
    expect(extractPodId('events-57f49b8975-8s2g2', 'events-forwarder')).toBe('57f49b8975-8s2g2');
  });

  it('returns undefined outside a container', () => {
    expect(extractPodId(undefined, 'orders-service')).toBeUndefined();
  });

  it('returns a single-segment pod name unchanged', () => {
    expect(extractPodId('local', 'orders-service')).toBe('local');
  });
});
