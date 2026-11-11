export type Scope = 'Namespaced' | 'Cluster' | 'Unknown'
export const apiGroup = (version: string) => version.includes('/') ? version.split('/')[0] : ''
export const identity = (group: string, kind: string, namespace: string, name: string) => `${group || 'core'}|${kind}/${namespace}/${name}`
const groups: Record<string,string[]> = {
  '': ['Pod','Service','Endpoints','ConfigMap','Secret','ServiceAccount','PersistentVolumeClaim','PersistentVolume','Namespace','Node','ReplicationController','ResourceQuota','LimitRange'],
  apps: ['Deployment','ReplicaSet','StatefulSet','DaemonSet'], batch: ['Job','CronJob'],
  'networking.k8s.io': ['Ingress','IngressClass','NetworkPolicy'],
  'rbac.authorization.k8s.io': ['Role','ClusterRole','RoleBinding','ClusterRoleBinding'],
  'storage.k8s.io': ['StorageClass','CSIDriver'], autoscaling: ['HorizontalPodAutoscaler'], policy: ['PodDisruptionBudget','PodSecurityPolicy'],
  'apiextensions.k8s.io': ['CustomResourceDefinition'], 'apiregistration.k8s.io': ['APIService'],
  'admissionregistration.k8s.io':['MutatingWebhookConfiguration','ValidatingWebhookConfiguration'],
  'scheduling.k8s.io':['PriorityClass'], 'node.k8s.io':['RuntimeClass'],
  'gateway.networking.k8s.io':['Gateway','GatewayClass','HTTPRoute','GRPCRoute','TLSRoute','TCPRoute'],
  'cert-manager.io':['Certificate','Issuer','ClusterIssuer'],
}
export function knownGroup(kind: string): string | undefined { return Object.keys(groups).find(g => groups[g].includes(kind)) }
const cluster = new Set(['Namespace','Node','PersistentVolume','StorageClass','ClusterRole','ClusterRoleBinding','CustomResourceDefinition','PriorityClass','IngressClass','APIService','ClusterIssuer','MutatingWebhookConfiguration','ValidatingWebhookConfiguration','GatewayClass','CSIDriver','RuntimeClass','PodSecurityPolicy'])
export function knownScope(group:string,kind:string): Scope { return knownGroup(kind) === group ? cluster.has(kind) ? 'Cluster' : 'Namespaced' : 'Unknown' }
