# 🌐 Sơ Đồ Kiến Trúc Topo Mạng & Luồng Quản Trị K8S (CMC Cloud HCM1)

Tài liệu thể hiện sơ đồ Topo kiến trúc phân tầng của hệ thống **Banking Microservices** trên cụm CMC Cloud K8S. Sơ đồ mô tả chi tiết **các K8S Secrets (`banking-db-secret`, `cloudflare-cert`, `harbor-registry`)**, **các loại K8S Service (`LoadBalancer / ELB`, `NodePort`, `ClusterIP`)**, **Persistent Volume (PV/PVC EVS)** gắn với Grafana/Loki, luồng người dùng qua **pfSense Firewall VIP**, luồng quản trị viên qua **pfSense OpenVPN Server**, và luồng **CI/CD Runner**.

---

## 🎨 1. Sơ Đồ Kiến Trúc Topo Mạng Chuẩn Hóa (Mermaid Diagram)

```mermaid
flowchart TD
    %% Layer 1: External Access & Admin
    subgraph Layer1 ["🌐 EXTERNAL USERS & ADMIN TIER"]
        User["💻 Public User Browser / App"]
        Admin["👨‍💻 Admin / DevOps Engineer"]
    end

    %% Layer 2: Perimeter Security & OpenVPN Gateway (pfSense)
    subgraph Layer2 ["🛡️ PERIMETER SECURITY & PERIMETER GATEWAYS (pfSense)"]
        PfVIP["🔥 pfSense Firewall / VIP Gateway<br/><b>Virtual IP (VIP): 192.168.6.x</b><br/><i>Ports: 80 / 443 (Public HTTP/HTTPS Traffic)</i>"]
        PfVPN["🔒 pfSense OpenVPN Server<br/><b>OpenVPN Tunnel (UDP 1194)</b><br/><i>Encrypted Admin Access to VPC</i>"]
    end

    %% Layer 3: Private VPC Network
    subgraph VPC ["☁️ CMC CLOUD PRIVATE VPC NETWORK (192.168.6.0/24)"]

        %% Bastion Host for SSH Management inside VPC
        Bastion["🖥️ Bastion Host (Management VM)<br/><i>Private IP + SSH Keypair Auth</i>"]

        %% Subgraph: Internal Automation & Management
        subgraph AdminCI ["⚙️ Internal Infra & CI/CD Tooling"]
            Runner["🏃 Self-Hosted GitHub Runner VM<br/><i>runs-on: self-hosted</i>"]
            Harbor["⚓ Internal Harbor Registry<br/><code>harbor.cmc-cloud-hcm1.cloud</code>"]
        end

        %% Subgraph: Kubernetes Cluster
        subgraph K8s ["☸️ CMC CLOUD KUBERNETES CLUSTER (Namespace: banking)"]
            
            %% K8S Secrets Management Tier
            subgraph K8sSecrets ["🔐 Kubernetes Secrets Management (Namespace: banking)"]
                DBSecret["🔑 K8S Secret: banking-db-secret<br/><b>Type: Opaque</b><br/><i>Postgres & Redis DB Credentials</i>"]
                CFCert["📜 K8S Secret: cloudflare-cert<br/><b>Type: kubernetes.io/tls</b><br/><i>TLS/SSL Cert for HAProxy Ingress</i>"]
                HarborSecret["📦 K8S Secret: harbor-registry<br/><b>Type: kubernetes.io/dockerconfigjson</b><br/><i>Private Image Pull Secret</i>"]
            end

            %% Ingress Tier with LoadBalancer Service (ELB)
            subgraph IngressEntry ["🚦 Ingress Entry Point (LoadBalancer & NodePort)"]
                K8sELB["⚖️ K8S Service: HAProxy Ingress<br/><b>kind: Service (type: LoadBalancer / ELB)</b><br/><i>Public Ingress Traffic</i>"]
                HAProxy["🔀 HAProxy Ingress Controller Pods<br/><i>(Exposed via NodePort Service :30080 / :30443)</i><br/>SSL Termination & Host/Path Routing"]
            end

            Kong["🦍 Kong API Gateway Pods<br/><b>kind: Service (type: ClusterIP / :8000)</b><br/><i>Plugins: Rate-Limit, Proxy-Cache, Auth</i>"]
            FE["💻 React Frontend Pods<br/><b>kind: Service (type: ClusterIP / :80)</b>"]

            subgraph BackendServices ["⚙️ Core Microservices (type: ClusterIP Internal Services)"]
                AuthSvc["🔐 Auth Service<br/><b>kind: Service (type: ClusterIP / :8000)</b>"]
                AccountSvc["💳 Account Service<br/><b>kind: Service (type: ClusterIP / :8001)</b>"]
                TransferSvc["💸 Transfer Service<br/><b>kind: Service (type: ClusterIP / :8002)</b>"]
                NotifySvc["🔔 Notification Service<br/><b>kind: Service (type: ClusterIP / :8003)</b>"]
                GameSvc["🎲 Game Service Plinko<br/><b>kind: Service (type: ClusterIP / :8005)</b>"]
            end

            subgraph Monitoring ["📊 Observability Tier (type: NodePort Service)"]
                Prometheus["📈 Prometheus Exporter<br/><b>kind: Service (type: ClusterIP)</b>"]
                Loki["📜 Grafana Loki & Promtail<br/>DaemonSet Log Collector"]
                GrafanaSvc["📉 Grafana Dashboard<br/><b>kind: Service (type: NodePort / :32305)</b>"]
                GrafanaPVC["💾 Grafana & Loki PVC / PV<br/><b>kind: PersistentVolumeClaim</b><br/><i>Elastic Volume Service (EVS 10GB)</i>"]
            end
        end

        %% Subgraph: Managed Data Tier
        subgraph DBaaS ["🗄️ Managed DBaaS Infrastructure"]
            PostgresDB[("🐘 CMC DBaaS PostgreSQL<br/><i>Master-Replica HA</i>")]
            RedisDB[("⚡ CMC DBaaS Redis<br/><i>Session Store & Pub/Sub</i>")]
        end
    end

    %% --- CONNECTIONS & FLOWS ---

    %% Public Traffic Flow
    User -->|1. HTTP/HTTPS Request| PfVIP
    PfVIP -->|2. Target VIP| K8sELB
    K8sELB -->|3. Dispatch NodePort| HAProxy
    HAProxy -->|4a. ClusterIP Web Route /| FE
    HAProxy -->|4b. ClusterIP API Route /api| Kong
    Kong -->|5. Forward Internal ClusterIP| BackendServices

    %% K8S Secrets Usage Connections
    HAProxy -.->|Uses TLS Cert| CFCert
    BackendServices -.->|Inject DB User/Password envFrom| DBSecret
    K8s ==>|imagePullSecrets| HarborSecret

    %% Admin Management Flow via pfSense OpenVPN + Bastion Host
    Admin -->|1. Connect OpenVPN Tunnel UDP:1194| PfVPN
    PfVPN -->|2. Route to Private VPC| Bastion
    Bastion -->|3a. kubectl CLI / Manifest Apply| K8s
    Bastion -->|3b. Admin SSH / Config| Runner
    Admin -->|Direct NodePort Access :32305 via VPN| GrafanaSvc

    %% Storage Connection
    GrafanaSvc --- GrafanaPVC
    Loki --- GrafanaPVC

    %% CI/CD Pipeline Flow
    Runner -->|1. Build & Push Image| Harbor
    Runner -->|2. Rollout Deployment| K8s
    Harbor ==>|3. Pull Image via VPC| K8s

    %% DB Connections using injected credentials
    BackendServices --> PostgresDB
    BackendServices --> RedisDB

    %% Monitoring Connections
    Prometheus -.-> BackendServices
    Loki -.-> GrafanaSvc

    %% Styling Nodes
    classDef vipStyle fill:#ff2a5f,stroke:#fff,stroke-width:2px,color:#fff;
    classDef vpnStyle fill:#38bdf8,stroke:#fff,stroke-width:2px,color:#000;
    classDef adminStyle fill:#a855f7,stroke:#fff,stroke-width:2px,color:#fff;
    classDef elbStyle fill:#00e5ff,stroke:#0077d6,stroke-width:2px,color:#000;
    classDef nodeportStyle fill:#f59e0b,stroke:#fff,stroke-width:2px,color:#000;
    classDef clusteripStyle fill:#0077d6,stroke:#00e5ff,stroke-width:2px,color:#fff;
    classDef secretStyle fill:#e11d48,stroke:#fff,stroke-width:2px,color:#fff;
    classDef dbStyle fill:#1e293b,stroke:#34d399,stroke-width:2px,color:#fff;
    classDef pvcStyle fill:#ec4899,stroke:#fff,stroke-width:2px,color:#fff;
    
    class PfVIP vipStyle;
    class PfVPN vpnStyle;
    class Bastion,Admin adminStyle;
    class K8sELB elbStyle;
    class HAProxy,GrafanaSvc nodeportStyle;
    class Kong,FE,AuthSvc,AccountSvc,TransferSvc,NotifySvc,GameSvc clusteripStyle;
    class DBSecret,CFCert,HarborSecret secretStyle;
    class PostgresDB,RedisDB,Harbor dbStyle;
    class GrafanaPVC pvcStyle;
```

---

## 🔐 2. Phân Tích Chi Tiết Các K8S Secrets Trong Hệ Thống

| Tên Secret K8S | Loạt Secret (`Type`) | Thành Phần Sử Dụng | Mục Đích & Nội Dung Bảo Mật |
| :--- | :--- | :--- | :--- |
| **`banking-db-secret`** | `Opaque` | Backend Pods (`auth`, `account`, `transfer`, `notification`, `game`) | Chứa thông tin đăng nhập DBaaS PostgreSQL & Redis (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`). Được inject trực tiếp vào môi trường Pods qua `envFrom`. |
| **`cloudflare-cert`** | `kubernetes.io/tls` | HAProxy Ingress Controller | Chứa SSL/TLS Certificate & Private Key của Cloudflare (`tls.crt`, `tls.key`) phục vụ giải mã HTTPS SSL Termination tại Ingress. |
| **`harbor-registry`** | `kubernetes.io/dockerconfigjson` | K8S Worker Nodes / Kubelet | Chứa thông tin Docker Auth Config (`.dockerconfigjson`) giúp K8S kéo (`imagePullSecrets`) các private container images từ Harbor Registry nội bộ. |

---

## 🔍 3. Phân Tích Các Loại Service K8S & Persistent Volume (PV/PVC)

### 📌 Bảng Tổng Hợp Các Loại Kubernetes Service Trong Dự Án

| Tên Service K8S | Loại Service (`kind: Service`) | Cổng Mở (Port Mapping) | Mục Đích Sử Dụng |
| :--- | :--- | :--- | :--- |
| **HAProxy Ingress ELB** | `type: LoadBalancer` (ELB) | Cổng VIP Public `:80`, `:443` | Tiếp nhận traffic từ pfSense VIP và cân bằng tải vào cụm K8S |
| **HAProxy Ingress Pods** | `type: NodePort` | `:30080` (HTTP), `:30443` (HTTPS) | Lắng nghe cổng NodePort trên Worker Nodes |
| **Grafana Dashboard** | `type: NodePort` | NodePort `:32305` | Cho phép Admin truy cập xem biểu đồ trực tiếp khi kết nối VPN |
| **Kong API Gateway** | `type: ClusterIP` | Internal ClusterIP `:8000` | Điểm quản lý API tập trung, ẩn hoàn toàn trong mạng nội bộ |
| **Frontend (React UI)** | `type: ClusterIP` | Internal ClusterIP `:80` | Phục vụ giao diện static web Nginx nội bộ |
| **Core Microservices** | `type: ClusterIP` | Internal ClusterIP `:8000` - `:8005` | Bảo vệ 5 backend microservices (Auth, Account, Transfer, Notify, Game) |

---

### 💾 Storage Persistent Volume (PV / PVC EVS) Gắn Với Grafana & Loki

- **Tài nguyên**: **PersistentVolumeClaim (`kind: PersistentVolumeClaim`)** tên `GrafanaPVC` liên kết với **CMC Cloud Elastic Volume Service (EVS 10GB)**.
- **Đặc điểm**: Ghi liên tục dữ liệu log từ **Loki** và Dashboard Grafana vào EVS Volume, đảm bảo tính bền vững dữ liệu khi Pod bị tái tạo (`Self-Healing`).

