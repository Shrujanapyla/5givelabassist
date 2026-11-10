# Linux MEC VM deployment preparation

This directory prepares the existing React, Express/Socket.IO, and optional FastAPI application for a Linux VM. It does not connect to or configure the university VM. Replace the hostname and certificate path placeholders with values supplied by the university administrator.

Build and deploy from the current project root using the commands below. The preexisting `_edge_deploy_stage` directory and `5g-live-lab-assist-edge.zip` are preserved as supplied and are not part of this deployment procedure; the archived frontend bundle contains a legacy non-loopback endpoint. The commands below build a fresh frontend from current source with same-origin API and Socket.IO URLs.

## Prerequisites

- A supported Node.js release (20.19+ or 22.12+), npm, Python 3, and Nginx installed by the VM administrator.
- DNS and firewall rules for HTTPS (TCP 443) and, if redirecting HTTP, TCP 80. Keep backend port 3000 and AI port 8000 restricted to loopback/private access.
- A Linux service account named `5glab` and a writable persistent data directory at `/var/lib/5g-live-lab-assist`.
- A university hostname and trusted TLS certificate/key installed at paths matching `nginx/5g-live-lab-assist.conf`.

## Build and install

From the project root on the VM (or build on a compatible machine and copy the resulting project):

```bash
getent passwd 5glab >/dev/null || sudo useradd --system --home-dir /opt/5g-live-lab-assist --shell /usr/sbin/nologin 5glab
cd /opt/5g-live-lab-assist
npm --prefix client ci
VITE_SERVER_URL= npm --prefix client run build
npm --prefix server ci --omit=dev
sudo install -d -o 5glab -g 5glab -m 0700 /var/lib/5g-live-lab-assist
sudo install -d -m 0750 /etc/5g-live-lab-assist
sudo install -o root -g 5glab -m 0640 deploy/.env.example /etc/5g-live-lab-assist/server.env
```

Edit `/etc/5g-live-lab-assist/server.env`: set the real HTTPS hostname, three distinct random enrollment secrets (at least 32 characters), and `CLIENT_ORIGIN`. Do not put credentials in the frontend build or repository. Keep the file readable only by root and the service group.

Install and enable the backend and Nginx configuration:

```bash
sudo install -m 0644 deploy/systemd/5g-live-lab-assist.service /etc/systemd/system/
sudo install -m 0644 deploy/nginx/5g-live-lab-assist.conf /etc/nginx/sites-available/5g-live-lab-assist
sudo ln -sfn /etc/nginx/sites-available/5g-live-lab-assist /etc/nginx/sites-enabled/5g-live-lab-assist
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now 5g-live-lab-assist
sudo systemctl reload nginx
```

Set Nginx `root` to the deployed `client/dist` path and replace `MEC_HOSTNAME_FROM_UNIVERSITY` and certificate paths before enabling the site. Nginx serves the static production build, proxies `/api/` and `/health` to Node, and proxies `/socket.io/` with WebSocket upgrade headers. Node binds to `0.0.0.0` as required by the existing server entry point; use the VM firewall to prevent public access to port 3000. AI binds to loopback only.

## Optional AI service

The service is independently managed. Install it only if AI inference is wanted:

```bash
cd /opt/5g-live-lab-assist/ai-service
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
mkdir -p models
```

Obtain the small CPU model weights once through the university's approved source, then install the local file and set `YOLO_MODEL` in `/etc/5g-live-lab-assist/ai-service.env` to that path:

```bash
sudo install -o 5glab -g 5glab -m 0640 /path/provided/by/university/yolo11n.pt /opt/5g-live-lab-assist/ai-service/models/yolo11n.pt
sudoedit /etc/5g-live-lab-assist/ai-service.env
```

The service deliberately fails inference with a clear unavailable response if that file is missing; it will not download weights on each service start. Install and start the optional service:

```bash
sudo install -m 0644 deploy/systemd/5g-live-lab-assist-ai.service /etc/systemd/system/
sudo install -o root -g 5glab -m 0640 deploy/ai-service.env.example /etc/5g-live-lab-assist/ai-service.env
sudo systemctl daemon-reload
sudo systemctl enable --now 5g-live-lab-assist-ai
```

The detector is generic COCO object detection. It is not trained to understand laboratory equipment or experiment states. AI is optional and is not required for video collaboration.

## Operations

```bash
sudo systemctl status 5g-live-lab-assist
sudo journalctl -u 5g-live-lab-assist -f
sudo systemctl restart 5g-live-lab-assist
sudo systemctl stop 5g-live-lab-assist

# Optional AI service
sudo systemctl status 5g-live-lab-assist-ai
sudo journalctl -u 5g-live-lab-assist-ai -f
sudo systemctl restart 5g-live-lab-assist-ai
sudo systemctl stop 5g-live-lab-assist-ai
```

Check `https://MEC_HOSTNAME_FROM_UNIVERSITY/health` after Nginx and the backend are active. Persistent user, audit, session, and snapshot records live under `DATA_DIR`. Back up that directory using the university's approved backup process. The service stores snapshots in its private data directory, not in the public frontend tree. Backend restart invalidates in-memory login tokens and interrupts active WebRTC connections; users must sign in and reconnect.
