# Pecan Dashboard Hosting Setup

The dashboard is deployed to **GitHub Pages** with automatic deployment via GitHub Actions.

## GitHub Pages Deployment

The dashboard automatically deploys to GitHub Pages via GitHub Actions when changes are pushed to the `main` branch.

**Live URL:** `https://western-formula-racing.github.io/daq-radio/`

**Setup:**
1. Enable GitHub Pages in repository Settings → Pages
2. Set Source to "GitHub Actions"
3. Push changes to `main` branch
4. Workflow automatically builds and deploys

**Configuration Files:**
- `.github/workflows/deploy-pecan.yml` - Auto-deploy workflow
- `pecan/vite.config.ts` - Base path configuration for GitHub Pages
- `pecan/src/routes.tsx` - Router with basename support
- `pecan/public/404.html` - SPA routing fallback for direct URLs
- `pecan/index.html` - URL restoration script

**WebSocket Connection:**
- Automatically connects to `wss://ws-wfr.0001200.xyz:9443` (secure)
- Falls back to `ws://localhost:9080` for local development

**SSL Certificate Setup with Auto-Renewal:**

The WebSocket server requires a valid SSL certificate for WSS connections. Follow these steps for automatic renewal:

```bash
# On VPS - Install Cloudflare DNS plugin for certbot
sudo apt install python3-certbot-dns-cloudflare -y

# Create Cloudflare API credentials file
# First, get API token from Cloudflare Dashboard:
# Profile → API Tokens → Create Token → "Edit zone DNS" template
# Set Zone Resources to your domain (0001200.xyz)
sudo nano /etc/letsencrypt/cloudflare.ini
# Add this line (replace with your actual token):
# dns_cloudflare_api_token = YOUR_CLOUDFLARE_API_TOKEN

# Secure the credentials file
sudo chmod 600 /etc/letsencrypt/cloudflare.ini

# Get certificate with auto-renewal enabled
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d ws-wfr.0001200.xyz

# Create deploy hook to automatically update WebSocket server on renewal
sudo bash -c 'cat > /etc/letsencrypt/renewal-hooks/deploy/update-websocket-cert.sh << "EOF"
#!/bin/bash
# Copy renewed certificates to WebSocket server
cp /etc/letsencrypt/live/ws-wfr.0001200.xyz/fullchain.pem /home/ubuntu/projects/daq-radio/car-simulate/persistent-broadcast/ssl/cert.pem
cp /etc/letsencrypt/live/ws-wfr.0001200.xyz/privkey.pem /home/ubuntu/projects/daq-radio/car-simulate/persistent-broadcast/ssl/key.pem
chmod 644 /home/ubuntu/projects/daq-radio/car-simulate/persistent-broadcast/ssl/cert.pem
chmod 600 /home/ubuntu/projects/daq-radio/car-simulate/persistent-broadcast/ssl/key.pem

# Restart Docker container
cd /home/ubuntu/projects/daq-radio/car-simulate/persistent-broadcast
docker compose restart
EOF'

# Make deploy hook executable
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/update-websocket-cert.sh

# Verify auto-renewal is set up (optional test)
sudo certbot renew --dry-run

# Check certbot timer status
sudo systemctl list-timers | grep certbot
```

**Certificate Auto-Renewal:**
- Certbot automatically checks for renewal twice daily
- Certificates renew 30 days before expiry
- Deploy hook automatically copies new certs and restarts the WebSocket server
- No manual intervention required!
- Current certificate expires on 2026-04-13 (auto-renews around 2026-03-14)

**Firewall Configuration:**
```bash
# Open WebSocket ports on VPS
sudo ufw allow 9080/tcp  # WS
sudo ufw allow 9443/tcp  # WSS
sudo ufw reload
```

### 2. Self-Hosted Docker Deployment

Al Alternative: Self-Hosted Docker Deployment

This folder contains legacy Docker configuration if you want to deploy using Nginx instead of GitHub Pages.

### Prerequisites

- Docker and Docker Compose installed
- Custom domain pointed to your server
- WebSocket server running separately (see `car-simulate/persistent-broadcast/`)

#### 1. Build and Start

```bash
cd host-demo
docker-compose up -d --build
```

### 2. View Logs

```bash
docker-compose logs -f
```

### 3. Stop Container

```bash
docker-compose down
```

## Service

- **pecan-dashboard**: Nginx serving the built React application on port 80 (and 443 with SSL)

## URLs

- Dashboard: `http://pecan-demo.0001200.xyz`

## SSL/HTTPS Setup for Nginx (Optional)

To also enable HTTPS for the dashboard:

1. Add volume mount to `docker-compose.yml` under `pecan-dashboard`:
   ```yaml
   volumes:
     - ./ssl:/etc/nginx/ssl:ro
   ```

2. Update `nginx.conf` to include HTTPS listener:
   ```nginx
   server {
       listen 443 ssl;
       server_name pecan-demo.0001200.xyz;
       
       ssl_certificate /etc/nginx/ssl/cert.pem;
       ssl_certificate_key /etc/nginx/ssl/key.pem;
       
       # ... rest of config
   }
   ```

## WebSocket Server (Separate)

The Python broadcast server runs independently in `car-simulate/persistent-broadcast/`. 

Your dashboard will connect to the WebSocket server running on a different host/port. Update your frontend WebSocket configuration accordingly.

## Updating the Application

To deploy updates:
```bash
cd host-demo
docker-compose down
docker-compose up -d --build
```

## Troubleshooting

- **Check logs:** `docker-compose logs -f`
- **Verify container:** `docker-compose ps`
- **Rebuild after changes:** `docker-compose up -d --build`
- **SSL errors:** Ensure certificates are properly configured in nginx.conf
- **Connection refused:** Check firewall allows ports 80 and 443
