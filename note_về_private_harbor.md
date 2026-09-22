Dùng EC private key cho cert Harbor (domain riêng, qua VPN)
1. Vì sao EC key ổn cho case này
EC (thường dùng prime256v1/P-256) cho cert nhanh hơn, key nhỏ hơn RSA 2048 nhiều mà độ an toàn tương đương — phù hợp khi cert chỉ dùng nội bộ qua VPN, không cần tương thích ngược với hệ thống cũ (client hiện đại đều hỗ trợ EC tốt).
2. Tạo CA + cert bằng EC key
bash
# CA dùng EC key
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -sha256 -days 3650 \
  -subj "/CN=harbor-ca" \
  -key ca.key -out ca.crt

# Server key + CSR (EC)
openssl ecparam -name prime256v1 -genkey -noout -out harbor.example.com.key
openssl req -new -sha256 \
  -subj "/CN=harbor.example.com" \
  -key harbor.example.com.key -out harbor.example.com.csr

# SAN config
cat > v3.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1=harbor.example.com
EOF

# Ký cert
openssl x509 -req -sha256 -days 3650 \
  -extfile v3.ext \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -in harbor.example.com.csr -out harbor.example.com.crt
Lưu ý: -CAcreateserial tạo file .srl — giữ lại nếu sau này ký thêm cert khác từ cùng CA.
3. Vì đã có domain thật — cân nhắc Let's Encrypt thay vì tự ký
Vì bạn nói đã có domain riêng, nếu domain đó resolve public được (kể cả khi bạn chỉ truy cập Harbor qua VPN), bạn hoàn toàn xài được Let's Encrypt qua DNS-01 challenge — tránh hẳn việc phải phân phối CA cho từng client:
bash
certbot certonly --manual --preferred-challenges dns \
  --key-type ecdsa --elliptic-curve secp256r1 \
  -d harbor.example.com
--key-type ecdsa là cờ để certbot cấp cert dùng EC key thay vì RSA mặc định. DNS-01 không cần mở port 80/443 ra internet — chỉ cần bạn add được TXT record vào DNS zone, nên rất hợp với setup VPN-only của bạn (Harbor không cần public IP/port nào cả).
Nếu domain qua Cloudflare (thấy trong network của Clouddit trước đây bạn có dùng Cloudflare), có thể tự động hoá bằng cert-manager + Cloudflare DNS-01 solver trong K8s, hoặc certbot-dns-cloudflare plugin nếu chạy tay trên VM.
4. Cấu hình Harbor với EC cert
harbor.yml không phân biệt RSA/EC, chỉ cần trỏ đúng path:
yaml
hostname: harbor.example.com
https:
  port: 443
  certificate: /your/path/harbor.example.com.crt
  private_key: /your/path/harbor.example.com.key   # EC key vẫn dùng field này
bash
sudo ./install.sh
5. Trust CA phía client (nếu vẫn tự ký, không dùng Let's Encrypt)
Vì bạn truy cập qua VPN — nghĩa là DNS harbor.example.com chỉ resolve đúng khi VPN bật. Cần đảm bảo:
Private DNS (nếu có, VD Pi-hole/CoreDNS nội bộ) trỏ domain này về IP private của Harbor.
Client (kể cả containerd trên K8s node) vẫn phải trust CA như đã nói ở câu trước — EC hay RSA không đổi bước này, chỉ đổi cách tạo cert.
Bạn định dùng Let's Encrypt DNS-01 hay vẫn tự ký CA nội bộ? Nếu domain đã trỏ qua Cloudflare mình có thể viết cụ thể cert-manager Issuer/DaemonSet cho case EC key luôn.