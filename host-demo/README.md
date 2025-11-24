# Pecan Dashboard Hosting Setup

This folder contains Docker configuration to host the Pecan dashboard at `pecan-demo.0001200.xyz`.

## Prerequisites

- Docker and Docker Compose installed
- Domain `pecan-demo.0001200.xyz` pointed to your server's IP address
- WebSocket server running separately (see `car-simulate/persistent-broadcast/`)

## Quick Start

### 1. Build and Start

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
