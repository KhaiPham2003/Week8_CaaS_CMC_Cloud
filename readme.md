This project shadowing step by step of Kurbenetes deployment, base on https://github.com/kevinram164/banking-demo/tree/main, using CMC Cloud platform (K8S services)

Phrase1: yml files will be stored in a private registry (Harbor)
kubernetes-prod-hcm1
namespace: banking

Private Harbor registry:

- Chỉnh lại engine (ko có https)
- docker login <IP Habor>

Instead of deploy Redis and Postgre container as a StatefulSet on K8s cluster, use CMC Cloud DBaaS
