# Deploy Apex on one EC2 instance

This is the smallest deployment that matches the current project: one Ubuntu
server runs Caddy, the frontend, API, WebSocket service, engine, market-data
producer, database writer, PostgreSQL, and Redis with Docker Compose. Only
Caddy is exposed publicly. The engine snapshot, PostgreSQL, Redis, and Caddy
certificate data live in Docker volumes on the instance's EBS disk.

## 1. Choose the instance and control costs

In the AWS Billing console, check whether your account is on the Free plan or
the Paid plan, its remaining credits, and its expiration date. For accounts
created after July 15, 2025, AWS's Free Tier is credit based and ends after
six months or when the credits are exhausted. Create a small cost alert before
launching the server. AWS's [Free Tier usage guide](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html)
and [Billing guide](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
describe the current account rules.

Start with one **Ubuntu Server 24.04 LTS, x86_64, `t3.small`** instance and a
**30 GiB gp3** EBS volume. The 2 GiB RAM is tight during image builds, so add
swap below. If the services are killed for lack of memory, resize to a 4 GiB
instance after checking its cost in your region. Do not launch RDS, ElastiCache,
or a load balancer for this first demo; Compose already includes the data
services and reverse proxy.

When launching EC2, create or select an SSH key pair. Set the security group's
inbound rules to:

| Port | Source | Purpose |
| --- | --- | --- |
| 22/tcp | Your current public IP only | SSH |
| 80/tcp | Anywhere | HTTP and certificate issuance |
| 443/tcp | Anywhere | HTTPS |

Do **not** open ports 5432, 6379, 7001, or 8000. Allow the instance outbound
internet access so the market-data service can reach Coinbase and Kraken.
An Elastic IP keeps the DNS address stable if you stop the instance, but a
public IPv4 address consumes credits or incurs charges. Check the price in
your AWS region before allocating one.

## 2. Connect and install Docker

Replace the key path and public IP:

```sh
chmod 400 /path/to/apex-key.pem
ssh -i /path/to/apex-key.pem ubuntu@YOUR_PUBLIC_IP
```

On the instance, install Docker Engine and the Compose plugin using the
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
The relevant commands are:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker compose version
```

Add 2 GiB of swap for the initial image build:

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Clone and configure Apex

```sh
git clone https://github.com/punit363/perp-cex-v2.git
cd perp-cex-v2
umask 077
cp .env.example .env
```

If the repository is private, use a read-only GitHub deploy key rather than a
personal access token in a shell command. Edit `.env` and replace every
`replace-this-*` value. Generate independent hexadecimal secrets with
`openssl rand -hex 32`. Use the **same** generated PostgreSQL password in
`POSTGRES_PASSWORD` and `DATABASE_URL`:

```dotenv
POSTGRES_USER=apex
POSTGRES_PASSWORD=<postgres-secret>
POSTGRES_DB=apex
DATABASE_URL=postgresql://apex:<postgres-secret>@postgres:5432/apex
JWT_SECRET=<different-jwt-secret>
ADMIN_TOKEN=<different-admin-secret>
DEMO_MAX_TOP_UP=1000
```

For a public HTTPS deployment, also set `SITE_ADDRESS` to a domain or
subdomain that you control, for example `exchange.example.com`. Point its DNS
`A` record at the instance's public IP **before** starting Caddy. Caddy will
obtain and renew a certificate automatically when the hostname resolves and
ports 80/443 are reachable. The frontend uses same-origin `/api/v1` and `/ws`
paths in production, so there is no separate frontend URL to configure.

For a short first check without a hostname, keep `SITE_ADDRESS=:80` and open
`http://YOUR_PUBLIC_IP`. This is plain HTTP; switch to a hostname and HTTPS
before using real passwords outside a private test.

## 4. Start and inspect

From the repository root on the instance:

```sh
sudo docker compose config -q
sudo docker compose up -d --build
sudo docker compose ps -a
sudo docker compose logs --tail=100 migrate seed engine market_data database backend ws web
```

`migrate` and `seed` are expected to exit successfully after setup. The other
services should remain running. The seed creates only supported USDT markets.
Verify the public page and market API:

```sh
curl -I https://YOUR_DOMAIN/
curl -fsS https://YOUR_DOMAIN/api/v1/market/
```

Use `http://YOUR_PUBLIC_IP` instead if you are doing the temporary HTTP check.
Then register a demo user, sign in, add a small demo balance, and confirm the
market status becomes live once both external price feeds connect. If the API
works but trading reports stale marks, inspect `market_data` and `engine` logs.

## 5. Update and keep state

```sh
git pull --ff-only
sudo docker compose up -d --build
sudo docker compose ps -a
```

`docker compose down` keeps named volumes, while `down -v` deletes them. The
current crash recovery also depends on the engine snapshot and Redis stream,
so keep their volumes together with PostgreSQL when moving or backing up the
deployment. This single-instance setup is suitable for a demo; losing the EBS
disk would lose all three stores unless they have been backed up elsewhere.
