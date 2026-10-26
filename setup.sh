#!/usr/bin/env bash
# Build and serve the architecture site on the home server (run as your normal user).
#   ./infrastructure/architecture-site/setup.sh                       # first time, and to rebuild
#   CEREBRO_DIR=~/dev/cerebro ./infrastructure/architecture-site/setup.sh
#   ARCH_BIND=192.168.1.25 ARCH_PORT=8095 ./infrastructure/architecture-site/setup.sh
#
# Reads the MealSenseAI model from this repository and the CEREBRO model from CEREBRO_DIR
# (default ~/cerebro, branch cerebro-mvp, where architecture/likec4 lives). Settings are kept in
# infrastructure/architecture-site/.env, so later runs need no arguments.
set -euo pipefail
cd "$(dirname "$0")"
touch .env && chmod 600 .env
setkv() { grep -q "^$1=" .env && sed -i "s#^$1=.*#$1=$2#" .env || echo "$1=$2" >> .env; }
getkv() { sed -n "s/^$1=//p" .env | tail -1; }

# The LAN address: an explicit value wins, then the saved one, then the address of the default route.
lan_ip="$(ip -o -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
BIND="${ARCH_BIND:-$(getkv ARCH_BIND)}"; BIND="${BIND:-$lan_ip}"
PORT="${ARCH_PORT:-$(getkv ARCH_PORT)}"; PORT="${PORT:-8095}"
CEREBRO_DIR="${CEREBRO_DIR:-$(getkv CEREBRO_DIR)}"; CEREBRO_DIR="${CEREBRO_DIR:-$HOME/cerebro}"
[ -n "$BIND" ] || { echo "Could not work out the LAN address; run again with ARCH_BIND=192.168.x.y"; exit 1; }
case "$BIND" in 0.0.0.0|::) echo "Refusing to bind to every interface; use the LAN address."; exit 1;; esac

# A port another service already listens on would make nginx fail to start; say so up front.
if ss -ltnH "( sport = :$PORT )" | grep -q . && ! docker compose ps --status running web 2>/dev/null | grep -q web; then
  echo "Port $PORT is already in use on this machine:"; ss -ltnp "( sport = :$PORT )" || true
  echo "Pick another with ARCH_PORT=…"; exit 1
fi

CEREBRO_MODEL="$CEREBRO_DIR/architecture/likec4"
if [ -d "$CEREBRO_MODEL" ]; then
  echo "==> CEREBRO model: $CEREBRO_MODEL"
else
  echo "-- No CEREBRO model at $CEREBRO_MODEL."
  echo "   It is on the cerebro-mvp branch: cd $CEREBRO_DIR && git fetch && git checkout cerebro-mvp"
  echo "   Building the MealSenseAI model only for now."
  CEREBRO_MODEL="$(pwd)/empty"
fi

setkv ARCH_BIND "$BIND"; setkv ARCH_PORT "$PORT"; setkv CEREBRO_DIR "$CEREBRO_DIR"
setkv CEREBRO_MODEL "$CEREBRO_MODEL"
setkv MEALSENSE_MODEL "$(cd ../.. && pwd)/architecture/likec4"

docker compose --profile build run --rm build
docker compose up -d --wait web
curl -fsS "http://$BIND:$PORT/healthz" >/dev/null && echo "==> Architecture site: http://$BIND:$PORT/"
