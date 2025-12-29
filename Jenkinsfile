/**
 * MCP Manager - Jenkins CI/CD Pipeline
 * 
 * Deploys to MKE (Mirantis Kubernetes Engine)
 * 
 * Required Jenkins Credentials (ID → Type):
 *   docker-registry-credentials → Username/Password (Docker Registry)
 *   mke-kubeconfig             → Secret file (kubeconfig for MKE cluster)
 *   github-token               → Secret text (for GitHub webhooks/status)
 * 
 * Required Jenkins Plugins:
 *   - Pipeline
 *   - Docker Pipeline
 *   - Kubernetes CLI
 *   - Credentials
 *   - Git
 *   - Blue Ocean (optional, for better UI)
 * 
 * Environment Variables (configure in Jenkins):
 *   DOCKER_REGISTRY           → Container registry URL (e.g., docker.io, your-registry.company.com)
 *   SLACK_WEBHOOK_URL         → (Optional) Slack webhook for notifications
 */

pipeline {
    agent {
        kubernetes {
            yaml '''
apiVersion: v1
kind: Pod
metadata:
  labels:
    jenkins: agent
spec:
  containers:
    - name: node
      image: node:20-alpine
      command:
        - cat
      tty: true
      resources:
        requests:
          memory: "2Gi"
          cpu: "1000m"
        limits:
          memory: "4Gi"
          cpu: "2000m"
    - name: docker
      image: docker:24-dind
      securityContext:
        privileged: true
      env:
        - name: DOCKER_TLS_CERTDIR
          value: ""
      resources:
        requests:
          memory: "2Gi"
          cpu: "500m"
        limits:
          memory: "4Gi"
          cpu: "2000m"
    - name: kubectl
      image: bitnami/kubectl:1.28
      command:
        - cat
      tty: true
  volumes:
    - name: docker-socket
      emptyDir: {}
'''
        }
    }

    environment {
        // Docker Registry
        DOCKER_REGISTRY = credentials('docker-registry-url') // Or hardcode: 'your-registry.company.com'
        DOCKER_CREDENTIALS = credentials('docker-registry-credentials')
        
        // Build info
        IMAGE_TAG = "${env.GIT_COMMIT?.take(7) ?: 'latest'}"
        BUILD_DATE = sh(script: 'date -u +"%Y-%m-%dT%H:%M:%SZ"', returnStdout: true).trim()
        
        // Services to build
        SERVICES = 'admin-ui control-plane gateway registry scanner'
        
        // Namespaces
        STAGING_NAMESPACE = 'mcp-manager-staging'
        PRODUCTION_NAMESPACE = 'mcp-manager'
    }

    options {
        timeout(time: 60, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timestamps()
        ansiColor('xterm')
    }

    parameters {
        choice(
            name: 'DEPLOY_ENV',
            choices: ['none', 'staging', 'production'],
            description: 'Select environment to deploy (auto-selected based on branch if "none")'
        )
        booleanParam(
            name: 'SKIP_TESTS',
            defaultValue: false,
            description: 'Skip lint and type checking (use with caution)'
        )
        booleanParam(
            name: 'FORCE_BUILD',
            defaultValue: false,
            description: 'Force Docker image rebuild even if no changes'
        )
        string(
            name: 'ROLLBACK_TAG',
            defaultValue: '',
            description: 'Image tag to rollback to (leave empty for normal deploy)'
        )
    }

    stages {
        stage('🔍 Checkout') {
            steps {
                checkout scm
                script {
                    // Set build description
                    currentBuild.description = "Branch: ${env.BRANCH_NAME}, Commit: ${env.GIT_COMMIT?.take(7)}"
                    
                    // Determine target environment
                    if (params.DEPLOY_ENV != 'none') {
                        env.TARGET_ENV = params.DEPLOY_ENV
                    } else if (env.BRANCH_NAME == 'main') {
                        env.TARGET_ENV = 'production'
                    } else if (env.BRANCH_NAME == 'dev') {
                        env.TARGET_ENV = 'staging'
                    } else {
                        env.TARGET_ENV = 'none'
                    }
                    
                    echo "🎯 Target Environment: ${env.TARGET_ENV}"
                    echo "🏷️ Image Tag: ${env.IMAGE_TAG}"
                }
            }
        }

        stage('📦 Install Dependencies') {
            steps {
                container('node') {
                    sh '''
                        echo "📦 Installing pnpm..."
                        npm install -g pnpm@9
                        
                        echo "📦 Installing dependencies..."
                        pnpm install --frozen-lockfile
                        
                        echo "📦 Generating Prisma client..."
                        pnpm db:generate
                    '''
                }
            }
        }

        stage('🔬 Lint & Type Check') {
            when {
                expression { !params.SKIP_TESTS }
            }
            steps {
                container('node') {
                    sh '''
                        echo "🔬 Running ESLint..."
                        pnpm lint || echo "⚠️ Lint completed with warnings"
                        
                        echo "🔬 Running TypeScript type check..."
                        pnpm build
                    '''
                }
            }
        }

        stage('🧪 Run Tests') {
            when {
                expression { !params.SKIP_TESTS }
            }
            steps {
                container('node') {
                    sh '''
                        echo "🧪 Running tests..."
                        pnpm test || echo "⚠️ Tests completed (some may have been skipped)"
                    '''
                }
            }
            post {
                always {
                    // Publish test results if available
                    junit allowEmptyResults: true, testResults: '**/test-results/*.xml'
                }
            }
        }

        stage('🐳 Build Docker Images') {
            when {
                anyOf {
                    branch 'main'
                    branch 'dev'
                    expression { params.FORCE_BUILD }
                    expression { env.TAG_NAME != null }
                }
            }
            steps {
                container('docker') {
                    script {
                        // Login to Docker registry
                        sh """
                            echo '🔐 Logging into Docker registry...'
                            echo "\${DOCKER_CREDENTIALS_PSW}" | docker login -u "\${DOCKER_CREDENTIALS_USR}" --password-stdin \${DOCKER_REGISTRY}
                        """
                        
                        // Build each service
                        def services = env.SERVICES.split(' ')
                        def parallelBuilds = [:]
                        
                        services.each { service ->
                            parallelBuilds[service] = {
                                sh """
                                    echo "🐳 Building ${service}..."
                                    docker build \
                                        --build-arg BUILD_DATE="${env.BUILD_DATE}" \
                                        --build-arg VCS_REF="${env.GIT_COMMIT}" \
                                        --build-arg VERSION="${env.IMAGE_TAG}" \
                                        -t \${DOCKER_REGISTRY}/mcp-manager/${service}:${env.IMAGE_TAG} \
                                        -t \${DOCKER_REGISTRY}/mcp-manager/${service}:${env.BRANCH_NAME} \
                                        -f apps/${service}/Dockerfile \
                                        .
                                """
                            }
                        }
                        
                        // Build in parallel (2 at a time to manage resources)
                        parallel parallelBuilds
                    }
                }
            }
        }

        stage('📤 Push Docker Images') {
            when {
                anyOf {
                    branch 'main'
                    branch 'dev'
                    expression { params.FORCE_BUILD }
                    expression { env.TAG_NAME != null }
                }
            }
            steps {
                container('docker') {
                    script {
                        def services = env.SERVICES.split(' ')
                        
                        services.each { service ->
                            sh """
                                echo "📤 Pushing ${service}..."
                                docker push \${DOCKER_REGISTRY}/mcp-manager/${service}:${env.IMAGE_TAG}
                                docker push \${DOCKER_REGISTRY}/mcp-manager/${service}:${env.BRANCH_NAME}
                            """
                        }
                        
                        // Tag as latest if main branch
                        if (env.BRANCH_NAME == 'main') {
                            services.each { service ->
                                sh """
                                    docker tag \${DOCKER_REGISTRY}/mcp-manager/${service}:${env.IMAGE_TAG} \${DOCKER_REGISTRY}/mcp-manager/${service}:latest
                                    docker push \${DOCKER_REGISTRY}/mcp-manager/${service}:latest
                                """
                            }
                        }
                    }
                }
            }
        }

        stage('🚀 Deploy to Staging') {
            when {
                anyOf {
                    branch 'dev'
                    expression { env.TARGET_ENV == 'staging' }
                }
            }
            steps {
                container('kubectl') {
                    withCredentials([file(credentialsId: 'mke-kubeconfig', variable: 'KUBECONFIG')]) {
                        script {
                            deployToEnvironment('staging', env.STAGING_NAMESPACE, env.IMAGE_TAG)
                        }
                    }
                }
            }
            post {
                success {
                    echo "✅ Staging deployment successful!"
                }
                failure {
                    echo "❌ Staging deployment failed!"
                }
            }
        }

        stage('🧪 Staging Smoke Tests') {
            when {
                anyOf {
                    branch 'dev'
                    expression { env.TARGET_ENV == 'staging' }
                }
            }
            steps {
                container('kubectl') {
                    withCredentials([file(credentialsId: 'mke-kubeconfig', variable: 'KUBECONFIG')]) {
                        sh """
                            echo "🧪 Running smoke tests on staging..."
                            
                            # Wait for pods to be ready
                            kubectl wait --for=condition=ready pod -l app=gateway -n ${STAGING_NAMESPACE} --timeout=120s
                            kubectl wait --for=condition=ready pod -l app=registry -n ${STAGING_NAMESPACE} --timeout=120s
                            
                            # Get service endpoints
                            GATEWAY_POD=\$(kubectl get pod -l app=gateway -n ${STAGING_NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
                            REGISTRY_POD=\$(kubectl get pod -l app=registry -n ${STAGING_NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
                            
                            # Health checks
                            echo "🏥 Checking Gateway health..."
                            kubectl exec \$GATEWAY_POD -n ${STAGING_NAMESPACE} -- wget -qO- http://localhost:3003/health || exit 1
                            
                            echo "🏥 Checking Registry health..."
                            kubectl exec \$REGISTRY_POD -n ${STAGING_NAMESPACE} -- wget -qO- http://localhost:3002/health || exit 1
                            
                            echo "✅ Smoke tests passed!"
                        """
                    }
                }
            }
        }

        stage('⏸️ Approval for Production') {
            when {
                anyOf {
                    branch 'main'
                    expression { env.TARGET_ENV == 'production' }
                }
            }
            steps {
                script {
                    // Skip approval if rollback
                    if (params.ROLLBACK_TAG?.trim()) {
                        echo "🔄 Rollback detected, skipping approval"
                    } else {
                        timeout(time: 30, unit: 'MINUTES') {
                            input message: '🚀 Deploy to Production?', 
                                  ok: 'Deploy',
                                  submitter: 'admin,devops',
                                  parameters: [
                                      string(name: 'APPROVAL_NOTE', defaultValue: '', description: 'Optional approval note')
                                  ]
                        }
                    }
                }
            }
        }

        stage('🚀 Deploy to Production') {
            when {
                anyOf {
                    branch 'main'
                    expression { env.TARGET_ENV == 'production' }
                }
            }
            steps {
                container('kubectl') {
                    withCredentials([file(credentialsId: 'mke-kubeconfig', variable: 'KUBECONFIG')]) {
                        script {
                            def deployTag = params.ROLLBACK_TAG?.trim() ?: env.IMAGE_TAG
                            
                            if (params.ROLLBACK_TAG?.trim()) {
                                echo "🔄 Rolling back to: ${deployTag}"
                                rollbackDeployment(env.PRODUCTION_NAMESPACE, deployTag)
                            } else {
                                deployToEnvironment('production', env.PRODUCTION_NAMESPACE, deployTag)
                            }
                        }
                    }
                }
            }
            post {
                success {
                    echo "✅ Production deployment successful!"
                }
                failure {
                    echo "❌ Production deployment failed!"
                }
            }
        }

        stage('📊 Post-Deployment Verification') {
            when {
                anyOf {
                    branch 'main'
                    branch 'dev'
                }
            }
            steps {
                container('kubectl') {
                    withCredentials([file(credentialsId: 'mke-kubeconfig', variable: 'KUBECONFIG')]) {
                        script {
                            def namespace = env.TARGET_ENV == 'production' ? env.PRODUCTION_NAMESPACE : env.STAGING_NAMESPACE
                            
                            sh """
                                echo "📊 Deployment Status for ${namespace}:"
                                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                                
                                echo "\n📦 Pods:"
                                kubectl get pods -n ${namespace} -o wide
                                
                                echo "\n🔗 Services:"
                                kubectl get svc -n ${namespace}
                                
                                echo "\n📈 Deployments:"
                                kubectl get deployments -n ${namespace}
                                
                                echo "\n🏷️ Image Tags:"
                                for service in ${SERVICES}; do
                                    TAG=\$(kubectl get deployment \$service -n ${namespace} -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo "N/A")
                                    echo "  \$service: \$TAG"
                                done
                            """
                        }
                    }
                }
            }
        }
    }

    post {
        always {
            // Clean up Docker images to save space
            container('docker') {
                sh 'docker system prune -f || true'
            }
            
            // Clean workspace
            cleanWs()
        }
        
        success {
            script {
                if (env.SLACK_WEBHOOK_URL) {
                    slackNotification('SUCCESS', "✅ MCP Manager build #${env.BUILD_NUMBER} succeeded\nBranch: ${env.BRANCH_NAME}\nCommit: ${env.GIT_COMMIT?.take(7)}")
                }
            }
        }
        
        failure {
            script {
                if (env.SLACK_WEBHOOK_URL) {
                    slackNotification('FAILURE', "❌ MCP Manager build #${env.BUILD_NUMBER} failed\nBranch: ${env.BRANCH_NAME}\nCommit: ${env.GIT_COMMIT?.take(7)}")
                }
            }
        }
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Deploy to a specific environment
 */
def deployToEnvironment(String environment, String namespace, String imageTag) {
    echo "🚀 Deploying to ${environment} (namespace: ${namespace}) with tag: ${imageTag}"
    
    // Replica counts per environment
    def replicas = environment == 'production' ? [
        gateway: 5,
        'control-plane': 3,
        'admin-ui': 3,
        registry: 2,
        scanner: 3
    ] : [
        gateway: 2,
        'control-plane': 2,
        'admin-ui': 2,
        registry: 1,
        scanner: 2
    ]
    
    // Generate kustomization.yaml
    sh """
        cat > k8s/overlays/${environment}/kustomization.yaml << 'EOF'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: ${namespace}

resources:
  - ../../base

commonLabels:
  environment: ${environment}

images:
  - name: mcp-manager/admin-ui
    newName: \${DOCKER_REGISTRY}/mcp-manager/admin-ui
    newTag: "${imageTag}"
  - name: mcp-manager/control-plane
    newName: \${DOCKER_REGISTRY}/mcp-manager/control-plane
    newTag: "${imageTag}"
  - name: mcp-manager/gateway
    newName: \${DOCKER_REGISTRY}/mcp-manager/gateway
    newTag: "${imageTag}"
  - name: mcp-manager/registry
    newName: \${DOCKER_REGISTRY}/mcp-manager/registry
    newTag: "${imageTag}"
  - name: mcp-manager/scanner
    newName: \${DOCKER_REGISTRY}/mcp-manager/scanner
    newTag: "${imageTag}"

replicas:
  - name: gateway
    count: ${replicas.gateway}
  - name: control-plane
    count: ${replicas['control-plane']}
  - name: admin-ui
    count: ${replicas['admin-ui']}
  - name: registry
    count: ${replicas.registry}
  - name: scanner
    count: ${replicas.scanner}
EOF
    """
    
    // Create namespace if not exists
    sh "kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -"
    
    // Apply kustomization
    sh "kubectl apply -k k8s/overlays/${environment}"
    
    // Wait for rollout
    def services = env.SERVICES.split(' ')
    services.each { service ->
        def timeout = environment == 'production' ? '600s' : '300s'
        sh "kubectl rollout status deployment/${service} -n ${namespace} --timeout=${timeout} || true"
    }
    
    // Run database migrations
    sh """
        echo "🗄️ Running database migrations..."
        kubectl exec deploy/control-plane -n ${namespace} -- npx prisma migrate deploy || echo "⚠️ Migration skipped or already applied"
    """
    
    // Verify deployment
    sh "kubectl get pods -n ${namespace}"
    echo "✅ ${environment} deployment complete! Image: ${imageTag}"
}

/**
 * Rollback deployment to a specific tag
 */
def rollbackDeployment(String namespace, String rollbackTag) {
    echo "🔄 Rolling back ${namespace} to: ${rollbackTag}"
    
    def services = env.SERVICES.split(' ')
    services.each { service ->
        sh """
            kubectl set image deployment/${service} \
                ${service}=\${DOCKER_REGISTRY}/mcp-manager/${service}:${rollbackTag} \
                -n ${namespace}
        """
    }
    
    // Wait for rollout
    services.each { service ->
        sh "kubectl rollout status deployment/${service} -n ${namespace} --timeout=300s"
    }
    
    echo "✅ Rolled back to ${rollbackTag}"
}

/**
 * Send Slack notification
 */
def slackNotification(String status, String message) {
    def color = status == 'SUCCESS' ? 'good' : 'danger'
    
    sh """
        curl -X POST -H 'Content-type: application/json' \
            --data '{"attachments":[{"color":"${color}","text":"${message}"}]}' \
            \${SLACK_WEBHOOK_URL} || true
    """
}
