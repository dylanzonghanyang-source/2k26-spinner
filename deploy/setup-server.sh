# 2kspinner HK server bootstrap — run as root on a fresh Ubuntu 24.04 instance.
# Installs Node 20 LTS + Caddy, sets up the headshot proxy as a systemd service,
# and prepares /var/www/2kspinner for the static site.
set -euo pipefail

log() { echo -e "\n\033[1;32m==>\033[0m $*"; }

log "apt update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl ufw

log "install Node 20 LTS (NodeSource)"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
apt-get install -y -qq nodejs
node -v && npm -v

log "install Caddy"
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy
caddy version

log "deploy headshot proxy to /opt/headshots-proxy"
mkdir -p /opt/headshots-proxy
cp /root/deploy/headshots-proxy.mjs /opt/headshots-proxy/server.mjs
cat > /etc/systemd/system/headshots-proxy.service <<'EOF'
[Unit]
Description=2kspinner headshot proxy
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/headshots-proxy
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now headshots-proxy
systemctl status headshots-proxy --no-pager -l | head -8

log "create web root"
mkdir -p /var/www/2kspinner

log "write Caddyfile"
cat > /etc/caddy/Caddyfile <<'EOF'
# 2kspinner — HTTP only by default. Add a domain below to enable auto-HTTPS.
# Example with domain:
#   spin.example.com {
#       root * /var/www/2kspinner
#       file_server
#       handle /nba-headshots/* { reverse_proxy 127.0.0.1:3001 }
#       handle /historical-headshots/* { reverse_proxy 127.0.0.1:3001 }
#   }

:80 {
	root * /var/www/2kspinner
	file_server

	handle /nba-headshots/* {
		reverse_proxy 127.0.0.1:3001
	}
	handle /historical-headshots/* {
		reverse_proxy 127.0.0.1:3001
	}
}
EOF
systemctl reload caddy

log "firewall: allow 22/80/443"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose | head -12

log "DONE. Site root /var/www/2kspinner (scp dist/ here), proxy on :3001, Caddy on :80."
