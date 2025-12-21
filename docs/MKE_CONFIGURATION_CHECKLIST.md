# MCP Manager - Production Deployment Configuration Checklist

This document lists **every file and configuration** you need to modify before deploying MCP Manager to an industry-grade MKE (Mirantis Kubernetes Engine) cluster.

---

## Quick Overview

| Category | Files to Modify | Priority |
|----------|-----------------|----------|
| **Bitbucket CI/CD** | 1 file + 4 variables | 🔴 REQUIRED |
| **Secrets** | 1 file (or kubectl commands) | 🔴 REQUIRED |
| **Ingress/DNS** | 1 file | 🔴 REQUIRED |
| **Container Registry** | 5 files | 🔴 REQUIRED |
| **Database** | 1 secret value | 🔴 REQUIRED |
| **ConfigMap** | 1 file | 🟡 RECOMMENDED |
| **Replicas/Resources** | 1 file | 🟡 RECOMMENDED |
| **Network Policies** | 1 file | 🟢 OPTIONAL |

---

## 1️⃣ BITBUCKET PIPELINE VARIABLES (Required)

**Location:** Bitbucket → Repository Settings → Pipelines → Repository Variables

| Variable Name | Example Value | Secured? | Description |
|---------------|---------------|----------|-------------|
| `DOCKER_REGISTRY` | `docker.io` or `registry.your-company.com` | No | Container registry URL |
| `DOCKER_USERNAME` | `your-username` | No | Registry login username |
| `DOCKER_PASSWORD` | `dckr_pat_xxxx` or password | **Yes** | Registry login password |
| `MKE_KUBECONFIG` | `LS0tLS1CRUdJTi...` | **Yes** | Base64-encoded MKE kubeconfig |

### How to Generate MKE_KUBECONFIG:

```bash
# Step 1: Get kubeconfig from MKE
# Option A: Download from MKE Web UI → Admin → Download Client Bundle
# Option B: Extract from existing config

# Step 2: Base64 encode (no line breaks)
cat ~/.kube/mke-config | base64 -w 0

# Step 3: Copy the entire output string
# Step 4: Paste into Bitbucket as MKE_KUBECONFIG variable
```

---

## 2️⃣ KUBERNETES SECRETS (Required)

**File:** `k8s/base/secrets.yaml`

```yaml
# ⚠️ CHANGE ALL VALUES MARKED WITH "CHANGE_ME"

apiVersion: v1
kind: Secret
metadata:
  name: mcp-manager-secrets
  namespace: mcp-manager
type: Opaque
stringData:
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # DATABASE (REQUIRED)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DATABASE_URL: "postgresql://mcp_user:CHANGE_ME@postgres-primary:5432/mcp_manager?sslmode=require"
  #                          ^^^^^^^^ ^^^^^^^^^ ^^^^^^^^^^^^^^^^^
  #                          username password  hostname (or external RDS/Cloud SQL URL)
  
  # For external managed database (AWS RDS, Azure, GCP):
  # DATABASE_URL: "postgresql://mcp_user:MySecurePass@mcp-db.xxxx.us-east-1.rds.amazonaws.com:5432/mcp_manager?sslmode=require"
  
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # JWT SECRET (REQUIRED)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  JWT_SECRET: "CHANGE_ME_generate_a_secure_256_bit_secret"
  # Generate with: openssl rand -base64 32
  
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # OIDC/SSO (REQUIRED for production auth)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OIDC_ISSUER: "https://your-company.okta.com"
  #             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  #             Your Okta/Azure AD/Auth0 issuer URL
  
  OIDC_CLIENT_ID: "mcp-manager-client"
  OIDC_CLIENT_SECRET: "CHANGE_ME"
  
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # GITHUB APP (REQUIRED for Copilot sync)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  GITHUB_APP_ID: "12345"
  #               ^^^^^
  #               From GitHub App settings page after creation
  
  GITHUB_APP_INSTALLATION_ID: "67890"
  #                            ^^^^^
  #                            From URL after installing app on enterprise/org
  
  GITHUB_PRIVATE_KEY: |
    -----BEGIN RSA PRIVATE KEY-----
    CHANGE_ME - paste your GitHub App private key here
    (downloaded as .pem file when creating the app)
    -----END RSA PRIVATE KEY-----
  
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # GITHUB ENTERPRISE URL (REQUIRED if using GitHub Enterprise Server)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  GITHUB_ENTERPRISE_URL: "https://github.your-company.com"
  #                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  #                       Your GitHub Enterprise Server URL (omit for github.com)
  
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # REDIS (OPTIONAL - for caching)
  # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  REDIS_PASSWORD: "CHANGE_ME"
```

### Alternative: Create Secrets via kubectl (Recommended)

```bash
# Instead of committing secrets.yaml, create secrets manually:
kubectl create secret generic mcp-manager-secrets \
  --namespace mcp-manager \
  --from-literal=DATABASE_URL="postgresql://mcp_user:YourSecurePassword@your-db-host:5432/mcp_manager?sslmode=require" \
  --from-literal=JWT_SECRET="$(openssl rand -base64 32)" \
  --from-literal=OIDC_ISSUER="https://your-company.okta.com" \
  --from-literal=OIDC_CLIENT_ID="mcp-manager" \
  --from-literal=OIDC_CLIENT_SECRET="your-oidc-secret" \
  --from-literal=GITHUB_APP_ID="12345" \
  --from-literal=GITHUB_APP_INSTALLATION_ID="67890" \
  --from-file=GITHUB_PRIVATE_KEY=./path/to/github-app-private-key.pem \
  --from-literal=GITHUB_ENTERPRISE_URL="https://github.your-company.com"
```

---

## 3️⃣ INGRESS / DNS CONFIGURATION (Required)

**File:** `k8s/base/ingress.yaml`

### Changes Required:

```yaml
spec:
  tls:
    - hosts:
        - mcp.your-company.com              # ← CHANGE to your domain
        - mcp-gateway.your-company.com      # ← CHANGE to your domain
        - mcp-registry.your-company.com     # ← CHANGE to your domain
      secretName: mcp-manager-tls
  rules:
    - host: mcp.your-company.com            # ← CHANGE to your domain
      # ...
    - host: mcp-gateway.your-company.com    # ← CHANGE to your domain
      # ...
    - host: mcp-registry.your-company.com   # ← CHANGE to your domain
      # ...
```

### Full List of Domain Changes:

| Current Value | Change To |
|---------------|-----------|
| `mcp.your-company.com` | `mcp.acme-corp.com` (your actual domain) |
| `mcp-gateway.your-company.com` | `mcp-gateway.acme-corp.com` |
| `mcp-registry.your-company.com` | `mcp-registry.acme-corp.com` |

### DNS Records to Create:

After deployment, point these DNS records to your MKE ingress IP:

```
mcp.your-company.com           → A → <MKE Ingress IP>
mcp-gateway.your-company.com   → A → <MKE Ingress IP>
mcp-registry.your-company.com  → A → <MKE Ingress IP>
```

---

## 4️⃣ CONTAINER REGISTRY (Required)

You need to update the image references in **5 deployment files**:

### Files to Modify:

| File | Line | Current | Change To |
|------|------|---------|-----------|
| `k8s/base/admin-ui/deployment.yaml` | 30 | `your-registry.com/mcp-manager/admin-ui:latest` | `registry.your-company.com/mcp-manager/admin-ui:latest` |
| `k8s/base/control-plane/deployment.yaml` | 33 | `your-registry.com/mcp-manager/control-plane:latest` | `registry.your-company.com/mcp-manager/control-plane:latest` |
| `k8s/base/gateway/deployment.yaml` | 33 | `your-registry.com/mcp-manager/gateway:latest` | `registry.your-company.com/mcp-manager/gateway:latest` |
| `k8s/base/registry/deployment.yaml` | ~30 | `your-registry.com/mcp-manager/registry:latest` | `registry.your-company.com/mcp-manager/registry:latest` |
| `k8s/base/scanner/deployment.yaml` | ~30 | `your-registry.com/mcp-manager/scanner:latest` | `registry.your-company.com/mcp-manager/scanner:latest` |

### OR Use Kustomization (Recommended):

The CI/CD pipeline automatically updates images via kustomization. Just ensure `DOCKER_REGISTRY` is set correctly in Bitbucket variables.

### Image Pull Secret (If Using Private Registry):

```bash
kubectl create secret docker-registry regcred \
  --namespace mcp-manager \
  --docker-server=registry.your-company.com \
  --docker-username=your-username \
  --docker-password=your-password \
  --docker-email=your-email@company.com
```

Then add to deployments:
```yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: regcred
```

---

## 5️⃣ ADMIN UI ENVIRONMENT (Required)

**File:** `k8s/base/admin-ui/deployment.yaml`

### Changes Required:

```yaml
env:
  - name: NEXT_PUBLIC_GATEWAY_URL
    value: "https://mcp-gateway.your-company.com"  # ← CHANGE to your actual gateway domain
```

---

## 6️⃣ CONFIGMAP (Recommended)

**File:** `k8s/base/configmap.yaml`

### Values You May Want to Adjust:

```yaml
data:
  # Logging
  LOG_LEVEL: "info"                          # Options: debug, info, warn, error
  
  # Scanner Configuration  
  SCAN_INTERVAL_MS: "60000"                  # How often to scan (60 seconds default)
  SCAN_CONCURRENCY: "5"                      # Parallel scans
  SCAN_TIMEOUT_MS: "60000"                   # Timeout per scan
  
  # Rate Limiting
  RATE_LIMIT_REQUESTS_PER_MINUTE: "100"      # Requests per minute per user
  
  # Security
  THREAT_DETECTION_SENSITIVITY: "MEDIUM"     # Options: LOW, MEDIUM, HIGH
  BLOCK_ON_HIGH_THREAT: "true"               # Block requests with high threat score
```

### Production Recommended Values:

```yaml
LOG_LEVEL: "info"                            # Not "debug" in production
THREAT_DETECTION_SENSITIVITY: "HIGH"         # More strict in production
RATE_LIMIT_REQUESTS_PER_MINUTE: "50"         # More strict rate limiting
```

---

## 7️⃣ REPLICAS & RESOURCES (Recommended)

**File:** `k8s/overlays/production/kustomization.yaml`

### Current Production Replicas:

```yaml
replicas:
  - name: gateway
    count: 5          # ← Adjust based on expected traffic
  - name: control-plane
    count: 3
  - name: scanner
    count: 3
  - name: registry
    count: 3
  - name: admin-ui
    count: 3
```

### Scaling Guidelines:

| Expected Users | Gateway | Control Plane | Scanner | Admin UI |
|----------------|---------|---------------|---------|----------|
| <100 | 3 | 2 | 2 | 2 |
| 100-500 | 5 | 3 | 3 | 3 |
| 500-2000 | 10 | 5 | 5 | 5 |
| 2000+ | 20+ | 10 | 10 | 5 |

### Resource Adjustments:

Edit individual deployment files in `k8s/base/*/deployment.yaml`:

```yaml
resources:
  requests:
    cpu: "500m"      # Minimum CPU (0.5 cores)
    memory: "512Mi"  # Minimum memory
  limits:
    cpu: "2000m"     # Maximum CPU (2 cores)
    memory: "2Gi"    # Maximum memory
```

---

## 8️⃣ NETWORK POLICIES (Optional)

**File:** `k8s/base/network-policies.yaml`

### If Your Ingress Controller Uses a Different Namespace:

```yaml
# Current:
- namespaceSelector:
    matchLabels:
      name: ingress-nginx   # ← Change if your ingress is in a different namespace

# For MKE with Interlock:
- namespaceSelector:
    matchLabels:
      name: kube-system     # Interlock runs in kube-system
```

### If Using External Database:

Add egress rule for external database:

```yaml
egress:
  - to:
      - ipBlock:
          cidr: 10.0.0.0/8   # ← Your database CIDR
    ports:
      - protocol: TCP
        port: 5432
```

---

## 9️⃣ STORAGE CLASS (If Using In-Cluster PostgreSQL)

**File:** Create `k8s/base/postgresql/statefulset.yaml`

```yaml
spec:
  storageClassName: standard   # ← Change to your MKE storage class

# Get available storage classes:
# kubectl get storageclass

# Common MKE storage classes:
# - vsphere-sc         (vSphere)
# - gp3                (AWS EBS)
# - managed-premium    (Azure)
# - local-path         (Local storage)
```

---

## 🔟 TLS CERTIFICATES (Required for HTTPS)

### Option A: cert-manager (Recommended)

The ingress already has annotation for cert-manager:
```yaml
annotations:
  cert-manager.io/cluster-issuer: letsencrypt-prod
```

Create ClusterIssuer if not exists:
```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@company.com  # ← CHANGE
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

### Option B: Manual Certificate

```bash
kubectl create secret tls mcp-manager-tls \
  --namespace mcp-manager \
  --cert=./path/to/fullchain.pem \
  --key=./path/to/privkey.pem
```

---

## Summary Checklist

### Before First Deployment:

- [ ] **Bitbucket Variables** - Set DOCKER_REGISTRY, DOCKER_USERNAME, DOCKER_PASSWORD, MKE_KUBECONFIG
- [ ] **Secrets** - Update DATABASE_URL, JWT_SECRET, OIDC settings, GitHub App credentials
- [ ] **Ingress** - Change all `your-company.com` to your actual domain
- [ ] **DNS** - Create A records pointing to MKE ingress IP
- [ ] **Admin UI** - Update NEXT_PUBLIC_GATEWAY_URL
- [ ] **Image Registry** - Update image paths OR set DOCKER_REGISTRY variable
- [ ] **TLS** - Set up cert-manager OR create manual TLS secret

### Recommended Adjustments:

- [ ] **ConfigMap** - Adjust LOG_LEVEL, THREAT_DETECTION_SENSITIVITY
- [ ] **Replicas** - Scale based on expected users
- [ ] **Resources** - Adjust CPU/memory based on cluster capacity
- [ ] **Network Policies** - Adjust ingress namespace if needed

### After Deployment:

- [ ] **Verify pods** - `kubectl get pods -n mcp-manager`
- [ ] **Run migrations** - `kubectl exec deploy/control-plane -n mcp-manager -- npx prisma migrate deploy`
- [ ] **Test UI** - Access https://mcp.your-company.com
- [ ] **Test Gateway** - Verify MCP proxy works
- [ ] **Check logs** - `kubectl logs -f deploy/gateway -n mcp-manager`

---

## Quick Reference: All Config File Locations

```
mcp_manager/
├── bitbucket-pipelines.yml          # CI/CD pipeline (auto-updates images)
├── k8s/
│   ├── base/
│   │   ├── namespace.yaml           # Namespace definition
│   │   ├── configmap.yaml           # ← MODIFY: Environment settings
│   │   ├── secrets.yaml             # ← MODIFY: All credentials
│   │   ├── ingress.yaml             # ← MODIFY: Domain names, TLS
│   │   ├── network-policies.yaml    # ← MODIFY: Ingress namespace
│   │   ├── rbac.yaml                # Usually no changes needed
│   │   ├── admin-ui/
│   │   │   └── deployment.yaml      # ← MODIFY: Image, NEXT_PUBLIC_GATEWAY_URL
│   │   ├── control-plane/
│   │   │   └── deployment.yaml      # ← MODIFY: Image
│   │   ├── gateway/
│   │   │   └── deployment.yaml      # ← MODIFY: Image
│   │   ├── registry/
│   │   │   └── deployment.yaml      # ← MODIFY: Image
│   │   └── scanner/
│   │       └── deployment.yaml      # ← MODIFY: Image
│   └── overlays/
│       ├── staging/
│       │   └── kustomization.yaml   # Auto-generated by CI/CD
│       └── production/
│           └── kustomization.yaml   # ← MODIFY: Replicas, resources
```

---

## Need Help?

If you encounter issues:

1. **Check pod logs:** `kubectl logs -f deploy/<service-name> -n mcp-manager`
2. **Describe pod:** `kubectl describe pod <pod-name> -n mcp-manager`
3. **Check secrets:** `kubectl get secret mcp-manager-secrets -n mcp-manager -o yaml`
4. **Check events:** `kubectl get events -n mcp-manager --sort-by=.metadata.creationTimestamp`
