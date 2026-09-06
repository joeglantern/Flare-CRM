#!/bin/bash
# One-time VPS preparation (docs/12 §4). Ubuntu 24.04 LTS. Run as root: bash bootstrap.sh <deploy-ssh-pubkey-file>
# Idempotent: safe to re-run.
set -euo pipefail
PUBKEY_FILE=${1:-}
SSH_PORT=${SSH_PORT:-22}
WG_PORT=${WG_PORT:-51820}

echo "== packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades chrony wireguard jq

echo "== deploy user"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG sudo deploy
  echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy
fi
if [ -n "$PUBKEY_FILE" ] && [ -f "$PUBKEY_FILE" ]; then
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  cat "$PUBKEY_FILE" >> /home/deploy/.ssh/authorized_keys
  sort -u -o /home/deploy/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
fi

echo "== ssh hardening"
sed -i -E "s/^#?PasswordAuthentication .*/PasswordAuthentication no/; s/^#?PermitRootLogin .*/PermitRootLogin no/; s/^#?Port .*/Port ${SSH_PORT}/" /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd

echo "== firewall (docs/08 A2)"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow "${WG_PORT}/udp"
ufw --force enable

echo "== docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker deploy
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "10" }, "live-restore": true, "no-new-privileges": true }
JSON
systemctl enable --now docker
systemctl restart docker

echo "== keep Docker from bypassing ufw: only caddy's published ports are reachable"
if ! grep -q "DOCKER-USER" /etc/ufw/after.rules; then
  cat >> /etc/ufw/after.rules <<'RULES'

# BEGIN CRM DOCKER-USER
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -p tcp -m multiport --dports 80,443 -j RETURN
-A DOCKER-USER -p udp --dport 443 -j RETURN
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
-A DOCKER-USER -i lo -j RETURN
-A DOCKER-USER -m addrtype --src-type LOCAL -j RETURN
-A DOCKER-USER -i wg0 -j RETURN
-A DOCKER-USER -j DROP
COMMIT
# END CRM DOCKER-USER
RULES
  ufw reload
fi

echo "== fail2ban + auto security updates + time sync"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now chrony

echo "== app directory"
install -d -m 750 -o deploy -g deploy /opt/crm /opt/crm/secrets /opt/crm/caddy /opt/crm/postgres/init /opt/crm/seaweedfs /opt/crm/backup
echo "Done. Next: copy infra/docker/* to /opt/crm, create /opt/crm/.env (chmod 600), secrets/postgres_password, secrets/valkey_password,"
echo "seaweedfs/s3.json, and (on-prem PBX) /etc/wireguard/wg0.conf; then run infra/deploy.sh."
