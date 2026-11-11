export const SAMPLE = `# KubeKin sample: a small web app. Edit the YAML on the left and watch the map change.
apiVersion: v1
kind: Namespace
metadata:
  name: shop
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web
  namespace: shop
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
  namespace: shop
data:
  LOG_LEVEL: info
---
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: shop
type: Opaque
stringData:
  password: change-me
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      serviceAccountName: web
      containers:
        - name: web
          image: nginx:1.27
          envFrom:
            - configMapRef: { name: web-config }
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef: { name: db-credentials, key: password }
          volumeMounts:
            - { name: data, mountPath: /data }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: web-data }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: web-data
  namespace: shop
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: fast
  resources: { requests: { storage: 1Gi } }
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: shop
spec:
  selector: { app: web }
  ports: [{ port: 80 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: shop
spec:
  ingressClassName: nginx
  tls:
    - secretName: web-tls
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: web, port: { number: 80 } }
          - path: /api
            pathType: Prefix
            backend:
              service: { name: api, port: { number: 8080 } }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
  namespace: shop
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: web }
  minReplicas: 2
  maxReplicas: 6
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: web-tls
  namespace: shop
spec:
  secretName: web-tls
  issuerRef: { name: letsencrypt, kind: ClusterIssuer }
  dnsNames: [shop.example.com]
`
