# Jenkins CI/CD Setup for MCP Manager

This guide explains how to configure Jenkins to build and deploy MCP Manager to a Mirantis Kubernetes Engine (MKE) cluster.

## Pipeline Options

We provide two Jenkinsfile options:

| File | Description | Best For |
|------|-------------|----------|
| `Jenkinsfile` | Full-featured pipeline with Kubernetes Pod agents | Teams with Kubernetes-based Jenkins |
| `Jenkinsfile.simple` | Simplified pipeline for standard Jenkins agents | Traditional Jenkins setup |

## Prerequisites

### Jenkins Plugins Required

Install these plugins via **Manage Jenkins → Plugins**:

| Plugin | Purpose |
|--------|---------|
| Pipeline | Core pipeline functionality |
| Docker Pipeline | Docker build/push support |
| Kubernetes | Kubernetes Pod agents (for main Jenkinsfile) |
| Credentials | Secure credential storage |
| Git | Source code management |
| Pipeline: Stage View | Visual pipeline status |
| Blue Ocean | Modern UI (optional but recommended) |
| Slack Notification | Slack alerts (optional) |

### Required Credentials

Create these credentials in **Manage Jenkins → Credentials → System → Global**:

| Credential ID | Type | Description |
|---------------|------|-------------|
| `docker-registry-credentials` | Username with password | Docker registry login |
| `mke-kubeconfig` | Secret file | MKE cluster kubeconfig file |
| `docker-registry-url` | Secret text | Registry URL (optional, can hardcode) |
| `github-token` | Secret text | GitHub PAT for webhooks (optional) |

### MKE Kubeconfig

1. Download kubeconfig from MKE console or generate via CLI
2. Create credential in Jenkins:
   - **Kind**: Secret file
   - **ID**: `mke-kubeconfig`
   - **File**: Upload your kubeconfig file

## Setup Instructions

### Option 1: Kubernetes Pod Agents (Recommended)

Uses ephemeral Kubernetes pods as Jenkins agents. Best for scalability.

1. **Configure Kubernetes Cloud**
   
   Go to **Manage Jenkins → Clouds → Add → Kubernetes**:
   
   ```
   Name: kubernetes
   Kubernetes URL: https://your-mke-cluster:6443
   Kubernetes Namespace: jenkins
   Credentials: (add your MKE kubeconfig as secret file)
   Jenkins URL: http://jenkins.jenkins.svc.cluster.local:8080
   ```

2. **Create Pipeline Job**
   
   - New Item → Pipeline
   - Name: `mcp-manager`
   - Pipeline from SCM:
     - SCM: Git
     - Repository URL: `https://github.com/your-org/mcp-manager.git`
     - Script Path: `Jenkinsfile`

3. **Configure Webhooks**
   
   In GitHub/GitLab, add webhook:
   ```
   URL: https://your-jenkins.com/github-webhook/
   Content type: application/json
   Events: Push, Pull Request
   ```

### Option 2: Standard Jenkins Agent

Uses existing Jenkins agents with Docker installed.

1. **Install Tools on Agent**
   
   ```bash
   # Node.js 20
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # pnpm
   npm install -g pnpm@9
   
   # Docker
   sudo apt-get install -y docker.io
   sudo usermod -aG docker jenkins
   
   # kubectl
   curl -LO "https://dl.k8s.io/release/v1.28.0/bin/linux/amd64/kubectl"
   sudo mv kubectl /usr/local/bin/ && sudo chmod +x /usr/local/bin/kubectl
   ```

2. **Configure Node.js Tool**
   
   Go to **Manage Jenkins → Tools → NodeJS installations**:
   - Name: `NodeJS-20`
   - Version: `20.x`

3. **Create Pipeline Job**
   
   Same as Option 1, but use `Jenkinsfile.simple` as Script Path.

## Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           JENKINS PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐     │
│  │  Checkout  │ → │  Install   │ → │   Lint &   │ → │    Run     │     │
│  │    SCM     │   │   Deps     │   │ TypeCheck  │   │   Tests    │     │
│  └────────────┘   └────────────┘   └────────────┘   └────────────┘     │
│                                           │                              │
│                                           ▼                              │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐     │
│  │  Deploy    │ ← │   Push     │ ← │   Build    │ ← │  (Branch   │     │
│  │  Staging   │   │  Images    │   │  Docker    │   │   Check)   │     │
│  └────────────┘   └────────────┘   └────────────┘   └────────────┘     │
│        │                                                                 │
│        ▼                                                                 │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐                       │
│  │   Smoke    │ → │  Manual    │ → │  Deploy    │                       │
│  │   Tests    │   │  Approval  │   │ Production │                       │
│  └────────────┘   └────────────┘   └────────────┘                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Stage Details

| Stage | Branch | Description |
|-------|--------|-------------|
| Checkout | All | Clone repository |
| Install Dependencies | All | `pnpm install`, generate Prisma |
| Lint & Type Check | All | ESLint, TypeScript compilation |
| Run Tests | All | Unit/integration tests |
| Build Docker Images | `main`, `dev` | Build all 5 service images |
| Push Docker Images | `main`, `dev` | Push to container registry |
| Deploy to Staging | `dev` | Deploy to staging namespace |
| Smoke Tests | `dev` | Health checks on staging |
| Approval | `main` | Manual approval gate |
| Deploy to Production | `main` | Deploy to production namespace |

## Environment Variables

Set these in Jenkins job configuration:

| Variable | Description | Example |
|----------|-------------|---------|
| `DOCKER_REGISTRY` | Container registry URL | `docker.io` or `registry.company.com` |
| `SLACK_WEBHOOK_URL` | Slack notifications (optional) | `https://hooks.slack.com/...` |

## Branch Strategy

| Branch | Action |
|--------|--------|
| `feature/*` | Lint & test only |
| `dev` | Build → Push → Deploy to Staging |
| `main` | Build → Push → Staging → Approval → Production |
| `v*` tags | Build release → Deploy to Production |

## Parameters

The pipeline supports these parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `DEPLOY_ENV` | Choice | `none` | Override target environment |
| `SKIP_TESTS` | Boolean | `false` | Skip lint/tests |
| `FORCE_BUILD` | Boolean | `false` | Force Docker rebuild |
| `ROLLBACK_TAG` | String | Empty | Image tag for rollback |

## Rollback

To rollback a production deployment:

1. Go to pipeline job
2. Click "Build with Parameters"
3. Set `ROLLBACK_TAG` to the previous working image tag
4. Set `DEPLOY_ENV` to `production`
5. Click "Build"

Or via CLI:
```bash
# Find previous tags
docker images | grep mcp-manager

# Trigger rollback
curl -X POST "https://jenkins.company.com/job/mcp-manager/buildWithParameters" \
  --user "user:token" \
  --data "ROLLBACK_TAG=abc1234&DEPLOY_ENV=production"
```

## Monitoring Pipeline

### Blue Ocean View

Access Blue Ocean for visual pipeline:
```
https://your-jenkins.com/blue/organizations/jenkins/mcp-manager/activity
```

### Slack Notifications

If configured, you'll receive:
- ✅ Success notifications with commit info
- ❌ Failure notifications with stage info

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Docker build fails | Check disk space, increase agent memory |
| kubectl: connection refused | Verify kubeconfig credentials, check MKE connectivity |
| Prisma generate fails | Ensure DATABASE_URL not needed at build time |
| Pod OOMKilled | Increase memory limits in Jenkinsfile pod spec |
| Rollout timeout | Check pod events: `kubectl describe pod -n mcp-manager` |

### Debug Commands

```bash
# Check Jenkins agent logs
kubectl logs -l jenkins=agent -n jenkins

# Check deployment status
kubectl get deployments -n mcp-manager

# Check pod logs
kubectl logs -l app=gateway -n mcp-manager --tail=100

# Check events
kubectl get events -n mcp-manager --sort-by='.lastTimestamp'
```

## Security Best Practices

1. **Credentials**: Never hardcode credentials in Jenkinsfile
2. **RBAC**: Use minimal kubeconfig permissions
3. **Network**: Restrict Jenkins agent network access
4. **Secrets**: Use Kubernetes secrets for sensitive env vars
5. **Audit**: Enable Jenkins audit logging

## Multi-Branch Pipeline

For automatic branch detection:

1. New Item → Multibranch Pipeline
2. Branch Sources → Git
3. Discover branches: All branches
4. Build Configuration: by Jenkinsfile

This will auto-create pipelines for each branch.
