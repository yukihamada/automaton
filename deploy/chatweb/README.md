# Chatweb - OpenClaw Deploy Config

Hetzner Cloud (cx23) 上の OpenClaw Gateway 設定ファイル一式。

## Server
- **IP**: 46.225.172.3
- **Type**: cx23 (2vCPU, 4GB RAM, EUR3.49/mo)
- **OS**: Ubuntu 24.04
- **Model**: openrouter/minimax/minimax-m2.5

## Files
| File | Deploy Path | Description |
|---|---|---|
| `nginx.conf` | `/etc/nginx/sites-available/openclaw` | HTTPS reverse proxy + Basic Auth |
| `openclaw.service` | `/etc/systemd/system/openclaw.service` | systemd auto-restart service |
| `openclaw.json` | `/root/.openclaw/openclaw.json` | Gateway config (replace `${OPENROUTER_API_KEY}`) |
| `502.html` | `/usr/share/nginx/html/502.html` | Custom 502 error page (10s auto-reload) |
| `ja.js` | `/usr/lib/node_modules/openclaw/dist/control-ui/assets/ja.js` | Improved Japanese translations |
| `index.html` | `/usr/lib/node_modules/openclaw/dist/control-ui/index.html` | Custom index with locale + token injection |

## Access
- **URL**: https://46.225.172.3/
- **Basic Auth**: yuki / openclaw
- **Gateway Auth**: none (protected by nginx)

## Quick Deploy
```bash
scp nginx.conf root@46.225.172.3:/etc/nginx/sites-available/openclaw
scp 502.html root@46.225.172.3:/usr/share/nginx/html/502.html
scp openclaw.service root@46.225.172.3:/etc/systemd/system/openclaw.service
scp ja.js root@46.225.172.3:/usr/lib/node_modules/openclaw/dist/control-ui/assets/ja.js
scp index.html root@46.225.172.3:/usr/lib/node_modules/openclaw/dist/control-ui/index.html
ssh root@46.225.172.3 "systemctl daemon-reload && systemctl restart openclaw && systemctl reload nginx"
```
