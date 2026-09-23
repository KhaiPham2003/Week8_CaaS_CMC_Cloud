# 🚀 Hướng Dẫn Thực Hành Demo K8S Nâng Cao Cho Hệ Thống Banking trên CMC Cloud

Tài liệu này cung cấp các kịch bản thực hành (Hands-on Lab Step-by-Step) để kiểm tra và trình diễn các tính năng nâng cao của Kubernetes trên cụm **CMC Cloud CaaS**.

---

## 📋 Danh Sách Kịch Bản Demo

1. [Kịch bản 1: Self-Healing cơ bản (Xóa Pod & Kiểm tra Tự Khôi Phục)](#1-kịch-bản-1-self-healing-cơ-bản-xóa-pod--kiểm-tra-tự-khôi-phục)
2. [Kịch bản 2: Mô phỏng sự cố OOMKilled (Out Of Memory) có kiểm soát](#2-kịch-bản-2-mô-phỏng-sự-cố-oomkilled-out-of-memory-có-kiểm-soát)
3. [Kịch bản 3: Auto Scaling Pods với HPA (Horizontal Pod Autoscaler)](#3-kịch-bản-3-auto-scaling-pods-với-hpa-horizontal-pod-autoscaler)
4. [Kịch bản 4: Taints & Tolerations (Điều phối và Cô lập Node)](#4-kịch-bản-4-taints--tolerations-điều-phối-và-cô-lập-node)
5. [Kịch bản 5: Persistent Storage qua Elastic Volume Service (EVS) với PV/PVC](#5-kịch-bản-5-persistent-storage-qua-elastic-volume-service-evs-với-pvpvc)

---

## 1. Kịch bản 1: Self-Healing cơ bản (Xóa Pod & Kiểm tra Tự Khôi Phục)

### 🎯 Mục tiêu
Chứng minh tính năng tự phục hồi của Kubernetes Deployment khi một hoặc nhiều Pod bị lỗi hoặc bị vô tình xóa mất.

### 📜 Các bước thực hiện

1. **Xem danh sách các Pod đang chạy trong namespace `banking`:**
   ```bash
   kubectl get pods -n banking -o wide
   ```
   *Lưu ý lại tên một Pod backend, ví dụ `account-service-667b9d66bd-twkvt`.*

2. **Mở một terminal mới để giám sát trạng thái realtime:**
   ```bash
   kubectl get pods -n banking -w
   ```

3. **Xóa Pod mục tiêu để giả lập sự cố đột ngột:**
   ```bash
   kubectl delete pod account-service-667b9d66bd-twkvt -n banking
   ```

4. **Quan sát hiện tượng:**
   - Trạng thái Pod cũ chuyển sang `Terminating`.
   - Kubernetes Deployment lập tức phát hiện số lượng Pod thực tế (1) ít hơn mong muốn (`replicas: 2`) và tạo ngay một Pod mới thay thế ở trạng thái `ContainerCreating` -> `Running`.
   - Ứng dụng Frontend vẫn gọi API liên tục mà không bị nghẽn gián đoạn nhờ Service ClusterIP cân bằng tải sang Pod còn lại.

---

## 2. Kịch bản 2: Mô phỏng sự cố OOMKilled (Out Of Memory) có kiểm soát

### 🎯 Mục tiêu
Mô phỏng trường hợp một ứng dụng bị tràn bộ nhớ (Memory Leak), vượt quá mức `resources.limits.memory` đã đăng ký, khiến Kernel kích hoạt OOM Killer tiêu diệt Pod và K8S tự động restart lại Pod đó (`CrashLoopBackOff` / `OOMKilled`).

### 📜 Các bước thực hiện

1. **Tạo file manifest mô phỏng OOMKilled `oom-test.yaml`:**
   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: oom-simulation-pod
     namespace: banking
     labels:
       app: oom-test
   spec:
     containers:
     - name: memory-eater
       image: polinux/stress
       command: ["stress"]
       args: ["--vm", "1", "--vm-bytes", "250M", "--vm-hang", "1"]
       resources:
         limits:
           memory: "100Mi" # Giới hạn tối đa 100MB RAM
         requests:
           memory: "50Mi"
   ```

2. **Triển khai Pod thử nghiệm:**
   ```bash
   kubectl apply -f oom-test.yaml
   ```

3. **Quan sát Pod bị tiêu diệt do OOMKilled:**
   ```bash
   kubectl get pod oom-simulation-pod -n banking -w
   ```
   *Kết quả: Trạng thái Pod sẽ nhanh chóng chuyển sang `OOMKilled` và cột `RESTARTS` tăng lên.*

4. **Kiểm tra sự kiện chi tiết log hệ thống:**
   ```bash
   kubectl describe pod oom-simulation-pod -n banking
   ```
   *Tìm dòng:* `Last State: Terminated`, `Reason: OOMKilled`, `Exit Code: 137`.

5. **Dọn dẹp:**
   ```bash
   kubectl delete -f oom-test.yaml
   ```

---

## 3. Kịch bản 3: Auto Scaling Pods với HPA (Horizontal Pod Autoscaler)

### 🎯 Mục tiêu
Chứng minh khả năng tự động nhân bản số lượng Pod (Auto Scaling) khi lượng tải CPU vượt ngưỡng cấu hình (ví dụ 50%).

### 📜 Các bước thực hiện

1. **Đảm bảo Metrics Server đã hoạt động trên cụm K8S:**
   ```bash
   kubectl top pods -n banking
   ```

2. **Tạo HPA cho `account-service`:**
   ```bash
   kubectl autoscale deployment account-service -n banking --cpu-percent=50 --min=2 --max=10
   ```
   Hoặc tạo file manifest `hpa-account.yaml`:
   ```yaml
   apiVersion: autoscaling/v2
   kind: HorizontalPodAutoscaler
   metadata:
     name: account-service-hpa
     namespace: banking
   spec:
     scaleTargetRef:
       apiVersion: apps/v1
       kind: Deployment
       name: account-service
     minReplicas: 2
     maxReplicas: 10
     metrics:
     - type: Resource
       resource:
         name: cpu
         target:
           type: Utilization
           averageUtilization: 50
   ```

3. **Giám sát trạng thái HPA:**
   ```bash
   kubectl get hpa -n banking -w
   ```

4. **Tạo tải giả lập (Load Generator):**
   ```bash
   kubectl run -i --tty load-generator --rm --image=busybox:1.28 --restart=Never -n banking -- /bin/sh -c "while true; do wget -q -O- http://account-service:8001/health; done"
   ```

5. **Quan sát kết quả Auto Scaling:**
   - Chỉ số CPU tăng vọt qua 50%.
   - HPA tự động kích hoạt scale `account-service` từ 2 Pods lên 4, 6, 8 Pods để gánh tải.

---

## 4. Kịch bản 4: Taints & Tolerations (Điều phối và Cô lập Node)

### 🎯 Mục tiêu
Giới hạn và điều hướng các Pod nhạy cảm (như Banking VIP Service / Game Service) chỉ chạy trên các Node cụ thể, đồng thời ngăn chặn các Pod thông thường nhảy vào Node này.

### 📜 Các bước thực hiện

1. **Xem danh sách Worker Nodes:**
   ```bash
   kubectl get nodes
   ```
   *Chọn 1 Worker Node, ví dụ: `node-worker-1`.*

2. **Gán Taint cho `node-worker-1` (Đánh dấu Node dành riêng cho VIP):**
   ```bash
   kubectl taint nodes node-worker-1 tier=dedicated:NoSchedule
   ```

3. **Thử nghiệm tạo một Pod thông thường (không có Toleration):**
   ```bash
   kubectl run normal-pod --image=nginx -n banking
   ```
   *Quan sát:* Pod này sẽ KHÔNG THỂ được schedule lên `node-worker-1`.

4. **Tạo Pod có Toleration hợp lệ để nhảy vào Node bị Taint:**
   Tạo file `vip-pod.yaml`:
   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: vip-game-service-pod
     namespace: banking
   spec:
     containers:
     - name: game
       image: nginx
     tolerations:
     - key: "tier"
       operator: "Equal"
       value: "dedicated"
       effect: "NoSchedule"
   ```
   ```bash
   kubectl apply -f vip-pod.yaml
   ```

5. **Kiểm tra kết quả Pod đã chạy đúng trên `node-worker-1`:**
   ```bash
   kubectl get pod vip-game-service-pod -n banking -o wide
   ```

6. **Xóa Taint sau khi demo xong:**
   ```bash
   kubectl taint nodes node-worker-1 tier=dedicated:NoSchedule-
   ```

---

## 5. Kịch bản 5: Persistent Storage qua Elastic Volume Service (EVS) với PV/PVC

### 🎯 Mục tiêu
Sử dụng StorageClass của **CMC Cloud EVS (Elastic Volume Service)** để hệ thống tự động cấp phát (Dynamic Provisioning) Persistent Volume (PV), mount vào Pod và kiểm tra dữ liệu vẫn toàn vẹn sau khi Pod bị xoá/tạo lại.

### 📜 Các bước thực hiện

1. **Kiểm tra StorageClass sẵn có trên CMC Cloud:**
   ```bash
   kubectl get storageclass
   ```
   *(Ví dụ StorageClass tên là `cmc-evs-ssd` hoặc `csi-ebs-sc`)*.

2. **Tạo PersistentVolumeClaim (PVC) tên `storage-demo-pvc.yaml`:**
   ```yaml
   apiVersion: v1
   kind: PersistentVolumeClaim
   metadata:
     name: storage-demo-pvc
     namespace: banking
   spec:
     accessModes:
       - ReadWriteOnce
     resources:
       requests:
         storage: 10Gi
   ```
   ```bash
   kubectl apply -f storage-demo-pvc.yaml
   ```

3. **Kiểm tra trạng thái PVC & PV tự động gắn (Bound):**
   ```bash
   kubectl get pvc,pv -n banking
   ```
   *Trạng thái `STATUS` phải hiển thị là `Bound`.*

4. **Tạo Pod mount PVC và ghi dữ liệu `storage-pod.yaml`:**
   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: storage-demo-pod
     namespace: banking
   spec:
     containers:
     - name: writer
       image: busybox
       command: ["/bin/sh", "-c", "echo 'DATA_BANKING_TRANSACTION_SAVED_AT_$(date)' >> /data/transaction.log; sleep 3600"]
       volumeMounts:
       - name: evs-volume
         mountPath: /data
     volumes:
     - name: evs-volume
       persistentVolumeClaim:
         claimName: storage-demo-pvc
   ```
   ```bash
   kubectl apply -f storage-pod.yaml
   ```

5. **Kiểm tra dữ liệu đã được ghi vào EVS Volume:**
   ```bash
   kubectl exec -it storage-demo-pod -n banking -- cat /data/transaction.log
   ```

6. **Giả lập sự cố XÓA POD để kiểm tra tính toàn vẹn dữ liệu:**
   ```bash
   kubectl delete pod storage-demo-pod -n banking
   ```

7. **Tạo lại Pod mới mount đúng PVC đó:**
   ```bash
   kubectl apply -f storage-pod.yaml
   ```

8. **Xác nhận dữ liệu cũ VẪN CÒN NGUYÊN VẸN:**
   ```bash
   kubectl exec -it storage-demo-pod -n banking -- cat /data/transaction.log
   ```
   *Dữ liệu cũ ghi trước khi xóa Pod vẫn hiển thị đầy đủ!*

---

## 📌 Tổng Kết Kiểm Thử Demo

| Tính Năng | Lệnh Kiểm Tra Chính | Kết Quả Mong Đợi |
| :--- | :--- | :--- |
| **Self-Healing** | `kubectl delete pod <pod-name>` | K8S tự tạo ngay Pod mới thay thế |
| **OOMKilled** | `kubectl describe pod oom-simulation-pod` | Exit Code 137, Status `OOMKilled` |
| **Auto Scaling (HPA)** | `kubectl get hpa -w` | Pods tự tăng từ 2 lên N khi CPU > 50% |
| **Taints & Tolerations** | `kubectl get pod -o wide` | Chỉ Pod có Toleration mới vào Node bị Taint |
| **EVS Storage (PV/PVC)** | `kubectl exec ... cat /data/log` | Dữ liệu cũ còn nguyên sau khi Pod bị tái tạo |

