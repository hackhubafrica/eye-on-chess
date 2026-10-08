# Quick Start

Get EyeOnChess running in under 5 minutes.

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Docker Compose)

## Setup

```bash
git clone https://github.com/amiwrpremium/eye-on-chess.git
cd eye-on-chess
cp .env.example .env
```

Edit `.env` and change at minimum:

- `POSTGRES_PASSWORD` — Generate with `openssl rand -hex 16`
- `REDIS_PASSWORD` — Generate with `openssl rand -hex 16`
- `JWT_SECRET` — Generate with `openssl rand -hex 32`
- `SEED_USER_PASSWORD` — Your admin password
- `GRAFANA_ADMIN_PASSWORD` — Grafana login password

Update `DATABASE_URL` and `REDIS_URL` to match the new passwords.

## Start

### Production (Nginx on port 80)

```bash
docker compose --env-file .env -f deployment/docker-compose.yml up -d
```

Open **http://localhost:8080** and log in with the admin credentials from your `.env`.
The admin panel is available locally at **http://localhost:3002**. Its container port is bound to loopback only.

#### Podman

Build the shared local base image before starting the stack, then run:

```bash
podman build -t eyeonchess-base -f deployment/Dockerfile.base .
podman-compose --env-file .env -f deployment/docker-compose.yml up -d
```

The compose file uses host ports `8080` and `8443` by default for rootless Podman. For a public deployment that needs Let's Encrypt, set `HTTP_PORT=80` and `HTTPS_PORT=443` in `.env` and ensure the host allows binding those privileged ports.

### Development (Hot reload)

```bash
docker compose -f deployment/docker-compose.dev.yml up --build
```

| Service  | URL                   |
| -------- | --------------------- |
| Web      | http://localhost:3000 |
| Admin    | http://localhost:3002 |
| API      | http://localhost:3001 |
| Postgres | localhost:5432        |
| Redis    | localhost:6379        |

### Using Make

```bash
make up          # Production
make dev         # Development (foreground)
make dev-up      # Development (background)
make help        # Show all commands
```

## First Login

1. Open the site in your browser
2. Log in with the seed admin credentials:
   - Email: value of `SEED_USER_EMAIL` (default: `admin@eyeonchess.local`)
   - Password: value of `SEED_USER_PASSWORD` (default: `changeme123`)
3. Access the admin panel at `admin.{your-domain}` or via the Play page (purple "Admin Panel" button)

## Stopping

```bash
make down        # Stop production
make dev-down    # Stop development
make clean       # Stop all
```
