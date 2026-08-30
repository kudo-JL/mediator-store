#!/usr/bin/env bash
# scripts/setup-oracle-cloud.sh
# One-shot setup for an Oracle Cloud Always-Free ARM VM.
# Run as root (or with sudo) on a fresh Ubuntu 22.04/24.04 instance.
#
# What it does:
#   1. Updates system + installs basics (curl, git, ufw)
#   2. Installs Node.js 22 via NodeSource
#   3. Installs nginx + certbot
#   4. Installs Docker + docker-compose
#   5. Installs Coolify (self-hosted PaaS) on port 8000
#   6. Opens firewall ports (80, 443, 8000, 22)
#
# After this script finishes, open:
#   http://<VM_IP>:8000
# and follow Coolify's first-time wizard.

set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root: sudo bash $0"
  exit 1
fi

echo "==> [1/7] Updating system"
apt-get update -y
apt-get upgrade -y

echo "==> [2/7] Installing basics"
apt-get install -y curl git ufw ca-certificates gnupg build-essential

echo "==> [3/7] Installing Node.js 22"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "    Node already installed: $(node -v)"
fi

echo "==> [4/7] Installing nginx + certbot"
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
systemctl start nginx

echo "==> [5/7] Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os/release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable docker
  systemctl start docker
else
  echo "    Docker already installed: $(docker --version)"
fi

echo "==> [6/7] Configuring firewall"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp     # HTTP
ufw allow 443/tcp    # HTTPS
ufw allow 8000/tcp   # Coolify UI (initial setup)
ufw allow 3000/tcp   # alternative dev port
ufw --force enable
ufw status || true

echo "==> [7/7] Installing Coolify"
# Coolify auto-detects whether to install or update.
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

echo
echo "================================================================"
echo "  ✅ Setup complete!"
echo "================================================================"
echo
echo "  Coolify is now running. Open in your browser:"
echo "    http://$(curl -s ifconfig.me 2>/dev/null || echo '<VM_IP>'):8000"
echo
echo "  First-time setup will ask you to:"
echo "    1. Create the admin account"
echo "    2. (Optional) register a wildcard domain"
echo "    3. Add a server (it will use 'localhost')"
echo
echo "  Then for each app:"
echo "    New Resource -> Application -> Public Repository"
echo "    -> paste your GitHub repo URL"
echo "    -> Build Pack: Nixpacks (auto-detects Node)  OR  Dockerfile"
echo "    -> set Environment Variables"
echo "    -> Deploy"
echo
echo "  After first app works, secure Coolify itself:"
echo "    Settings -> FQDN -> set https://coolify.yourdomain.com"
echo "    (Coolify will then use HTTPS on that subdomain)"
echo
echo "  Recommended next steps:"
echo "    1. Get a free domain: https://www.duckdns.org/  (or buy one)"
echo "    2. Point  *.yourdomain.duckdns.org  -> $(curl -s ifconfig.me 2>/dev/null || echo '<VM_IP>')"
echo "    3. In Coolify: Settings -> Wildcard domain = yourdomain.duckdns.org"
echo "    4. Every app you deploy gets https://appname.yourdomain.duckdns.org for free"
echo "================================================================"
