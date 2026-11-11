// Official Kubernetes community icons (Apache-2.0), bundled locally in public/icons so Docker works offline.
const MAP: Record<string, string> = {
  Namespace: 'ns', Pod: 'pod', Deployment: 'deploy', ReplicaSet: 'rs', ReplicationController: 'rs', StatefulSet: 'sts', DaemonSet: 'ds',
  Job: 'job', CronJob: 'cronjob', Service: 'svc', Endpoints: 'ep', Ingress: 'ing', ConfigMap: 'cm', Secret: 'secret',
  PersistentVolumeClaim: 'pvc', PersistentVolume: 'pv', StorageClass: 'sc', ServiceAccount: 'sa', Role: 'role', ClusterRole: 'c-role',
  RoleBinding: 'rb', ClusterRoleBinding: 'crb', HorizontalPodAutoscaler: 'hpa', NetworkPolicy: 'netpol', ResourceQuota: 'quota',
  LimitRange: 'limits', CustomResourceDefinition: 'crd', PodSecurityPolicy: 'psp',
}
export const iconFor = (kind: string): string | null =>
  MAP[kind] ? `${import.meta.env.BASE_URL}icons/${MAP[kind]}.svg` : null
export const KNOWN_KINDS = new Set(Object.keys(MAP))
