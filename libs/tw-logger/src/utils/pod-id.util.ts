/**
 * Extracts the replica-identifying part of a Kubernetes pod name.
 *
 * The full pod name repeats the service name on every log line, which is pure noise once
 * `serviceName` is already a field. What is left — the ReplicaSet hash and the pod suffix — is the
 * part that answers "was this all one replica, or did the request bounce between two?".
 *
 * @example
 * extractPodId('orders-service-b4799cf77-8t452', 'orders-service') // 'b4799cf77-8t452'
 * extractPodId('events-57f49b8975-8s2g2', 'events-forwarder')      // '57f49b8975-8s2g2'
 *
 * @param podName - Value of `POD_NAME`. Absent outside a container.
 * @param serviceName - Name to strip as a prefix.
 * @returns The pod id, or `undefined` when there is no pod name.
 */
export function extractPodId(podName: string | undefined, serviceName: string): string | undefined {
  if (!podName) return undefined;

  if (podName.startsWith(serviceName + '-')) {
    return podName.slice(serviceName.length + 1);
  }

  // The pod name does not start with the service name — usually a Helm release named differently
  // from the service. The last two dash-separated segments are the ReplicaSet hash and the suffix.
  const segments = podName.split('-');
  if (segments.length >= 2) return segments.slice(-2).join('-');

  return podName;
}
