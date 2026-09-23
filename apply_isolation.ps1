$ErrorActionPreference = "Stop"
$kubeconfig = "C:\Users\Admin\.kube\proj_week8_k8s_config.txt"

Write-Host "1. Danh dau doc hai (Taint) cho cac may Monitoring..."
kubectl --kubeconfig=$kubeconfig taint nodes -l cmccloud-k8s-nodegroups=nodegroup-monitoring-hcm1-prod dedicated=monitoring:NoSchedule --overwrite

$patch = '{"spec":{"template":{"spec":{"nodeSelector":{"cmccloud-k8s-nodegroups":"nodegroup-monitoring-hcm1-prod"},"tolerations":[{"key":"dedicated","operator":"Equal","value":"monitoring","effect":"NoSchedule"}]}}}}'

Write-Host "2. Tiem NodeSelector va Tolerations vao Grafana & Loki..."
kubectl --kubeconfig=$kubeconfig patch deployment grafana -n monitoring -p $patch
kubectl --kubeconfig=$kubeconfig patch statefulset loki -n monitoring -p $patch

Write-Host "3. Tiem NodeSelector va Tolerations vao Prometheus & Kube-State-Metrics..."
kubectl --kubeconfig=$kubeconfig patch deployment prometheus-server -n cmc-monitoring -p $patch
kubectl --kubeconfig=$kubeconfig patch deployment kube-state-metrics -n cmc-monitoring -p $patch

$dsPatch = '[{"op": "add", "path": "/spec/template/spec/tolerations/-", "value": {"key":"dedicated","operator":"Equal","value":"monitoring","effect":"NoSchedule"}}]'

Write-Host "4. Cap the mien tu (Toleration) cho Promtail & Node-Exporter de tiep tuc thu thap Log/Metric tren may Monitoring..."
kubectl --kubeconfig=$kubeconfig patch ds loki-promtail -n monitoring --type='json' -p $dsPatch
kubectl --kubeconfig=$kubeconfig patch ds node-exporter -n cmc-monitoring --type='json' -p $dsPatch

Write-Host "5. Xoa cac Pod Banking dang chay sai cho (Buoc chung khoi dong lai va vao dung may Workload)..."
kubectl --kubeconfig=$kubeconfig delete pods --all -n banking

Write-Host "HOAN TAT! He thong dang duoc quy hoach lai..."
