# 2kspinner HK server bootstrap — run as root on a fresh Ubuntu 24.04 instance.
#
# Hardening (public-beta audit 2026-08-11):
#   - Node 24 LTS (Node 20 is EOL)
#   - dedicated non-root deploy user (2kspinner) + restricted service user
#   - systemd service runs as the unprivileged user with sandbox options
#   - HTTPS only via Caddy auto-TLS (port 80 redirects to 443); set DOMAIN
#   - atomic deploys: rsync into releases/<timestamp> + symlink flip
#
# Usage:
#   DOMAIN=spinner.example.com ./setup-server.sh
set -euo pipefail

DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  echo "ERROR: DOMAIN is required (e.g. DOMAIN=spinner.example.com)." >&2
  echo "Caddy needs a real domain for auto-HTTPS; the script will NOT start on :80 only." >&2
  exit 1
fi

log() { echo -e "\n\033[1;32m==>\033[0m $*"; }

log "apt update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl ufw rsync

log "install Node 24 LTS (NodeSource)"
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
apt-get install -y -qq nodejs
node -v && npm -v

log "install Caddy"
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy
caddy version

log "create unprivileged deploy user '2kspinner'"
if ! id -u 2kspinner >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin 2kspinner
fi
mkdir -p /opt/headshots-proxy /var/www/2kspinner/releases
chown -R 2kspinner:2kspinner /opt/headshots-proxy /var/www/2kspinner

log "deploy headshot proxy to /opt/headshots-proxy"
cp /root/deploy/headshots-proxy.mjs /opt/headshots-proxy/server.mjs
cp /root/deploy/headshot-allowlist.json /opt/headshots-proxy/headshot-allowlist.json
chown -R 2kspinner:2kspinner /opt/headshots-proxy
chmod 640 /opt/headshots-proxy/*

log "systemd service (unprivileged + sandboxed)"
cat > /etc/systemd/system/headshots-proxy.service <<'EOF'
[Unit]
Description=2kspinner headshot proxy
After=network-online.target
Wants=network-online.target

[Service]
User=2kspinner
Group=2kspinner
WorkingDirectory=/opt/headshots-proxy
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now headshots-proxy
systemctl status headshots-proxy --no-pager -l | head -8

log "write Caddyfile (HTTPS-only for $DOMAIN)"
cat > /etc/caddy/Caddyfile <<EOF
# 2kspinner — HTTPS only. Port 80 auto-redirects to 443 (Caddy default).
$DOMAIN {
	root * /var/www/2kspinner/current
	file_server

	handle /nba-headshots/* {
		reverse_proxy 127.0.0.1:3001
	}
	handle /historical-headshots/* {
		reverse_proxy 127.0.0.1:3001
	}

	# Security headers (CSP tightened for the built app; inline theme script
	# is externalized so no unsafe-inline is needed for scripts).
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		Permissions-Policy camera=(), microphone=(), geolocation=()
		Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"
		# Enable HSTS only after HTTPS is verified stable for a few days:
		# Strict-Transport-Security "max-age=31536000; includeSubDomains"
	}

	# index.html must revalidate; hashed assets can be cached a year.
	@index path /index.html /
	header @index Cache-Control "no-cache"
	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"
}
EOF
systemctl reload caddy

log "atomic deploy helper: /usr/local/bin/deploy-2kspinner"
cat > /usr/local/bin/deploy-2kspinner <<'EOF'
#!/usr/bin/env bash
# Deploy a dist/ build atomically: rsync into a new release dir, flip symlink,
# prune old releases. Run as the deploy user.
set -euo pipefail
SRC="${1:?usage: deploy-2kspinner <dist-dir>}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REL="/var/www/2kspinner/releases/$STAMP"
mkdir -p "$REL"
rsync -a --delete "$SRC"/ "$REL"/
ln -sfn "$REL" /var/www/2kspinner/current
# keep the 5 most recent releases
ls -1t /var/www/2kspinner/releases | tail -n +6 | while read -r old; do
  rm -rf "/var/www/2kspinner/releases/$old"
done
echo "deployed $REL -> current"
EOF
chmod 755 /usr/local/bin/deploy-2kspinner

log "firewall: allow 22/80/443"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose | head -12

log "DONE. Deploy from CI with: deploy-2kspinner <dist-dir> (as 2kspinner)."
log "Caddy serves https://$DOMAIN with atomic symlink /var/www/2kspinner/current."
