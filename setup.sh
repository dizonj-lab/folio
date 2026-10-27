#!/usr/bin/env bash
# Build and serve the portfolio on the home server (run as your normal user).
#   ./setup.sh                                                   # first time, and to rebuild
#   MEALSENSE_DIR=~/dev/MealSenseAI CEREBRO_DIR=~/dev/cerebro ./setup.sh
#   ARCH_BIND=127.0.0.1 ARCH_PORT=8095 ./setup.sh                # the defaults
#
# The portfolio's own content lives in this repository. The two architecture models are read from
# the product repositories: MealSenseAI from MEALSENSE_DIR (default ~/MealSenseAI) and CEREBRO from
# CEREBRO_DIR (default ~/cerebro); either may be missing, and its page is then left out. Settings
# are kept in .env, so later runs need no arguments.
set -euo pipefail
cd "$(dirname "$0")"
touch .env && chmod 600 .env
setkv() { grep -q "^$1=" .env && sed -i "s#^$1=.*#$1=$2#" .env || echo "$1=$2" >> .env; }
getkv() { sed -n "s/^$1=//p" "${2:-.env}" | tail -1; }

MEALSENSE_DIR="${MEALSENSE_DIR:-$(getkv MEALSENSE_DIR)}"; MEALSENSE_DIR="${MEALSENSE_DIR:-$HOME/MealSenseAI}"

# The site used to live inside MealSenseAI as the `architecture` Compose project. A first run here
# carries over its port; the address stays loopback.
OLD_ENV="$MEALSENSE_DIR/infrastructure/architecture-site/.env"
if [ ! -s .env.imported ] && [ -f "$OLD_ENV" ]; then
  for key in ARCH_PORT CEREBRO_DIR; do
    value="$(getkv "$key" "$OLD_ENV")"
    [ -n "$value" ] && [ -z "$(getkv "$key")" ] && setkv "$key" "$value"
  done
  echo "$OLD_ENV" > .env.imported
  echo "==> Carried over the port from $OLD_ENV"
fi

# The loopback address by default: cloudflared runs on this machine and reaches the site there, so
# nothing else on the network can. An explicit value wins, then the saved one.
BIND="${ARCH_BIND:-$(getkv ARCH_BIND)}"; BIND="${BIND:-127.0.0.1}"
PORT="${ARCH_PORT:-$(getkv ARCH_PORT)}"; PORT="${PORT:-8095}"
CEREBRO_DIR="${CEREBRO_DIR:-$(getkv CEREBRO_DIR)}"; CEREBRO_DIR="${CEREBRO_DIR:-$HOME/cerebro}"
case "$BIND" in 0.0.0.0|::) echo "Refusing to bind to every interface; use 127.0.0.1 or one address."; exit 1;; esac

# The old copy inside MealSenseAI holds the same port. Stop it (containers only; its volumes are
# kept) so this one can take over.
if docker compose -p architecture ps --status running -q web 2>/dev/null | grep -q .; then
  echo "==> Stopping the old portfolio (Compose project 'architecture') so this one can use port $PORT"
  docker compose -p architecture stop web
fi

# A port another service already listens on would make nginx fail to start; say so up front.
if ss -ltnH "( sport = :$PORT )" | grep -q . && ! docker compose ps --status running web 2>/dev/null | grep -q web; then
  echo "Port $PORT is already in use on this machine:"; ss -ltnp "( sport = :$PORT )" || true
  echo "Pick another with ARCH_PORT=…"; exit 1
fi

model() {  # $1 name, $2 path: the model's directory, or ./empty when it is not there
  if [ -d "$2" ]; then echo "==> $1 model: $2" >&2; echo "$2"
  else echo "-- No $1 model at $2; its page is left out this time." >&2; echo "$(pwd)/empty"; fi
}
MEALSENSE_MODEL="$(model MealSenseAI "$MEALSENSE_DIR/architecture/likec4")"
CEREBRO_MODEL="$(model CEREBRO "$CEREBRO_DIR/architecture/likec4")"
[ "$CEREBRO_MODEL" = "$(pwd)/empty" ] && echo "   CEREBRO's model is on the cerebro-mvp branch and the branches after it."

setkv ARCH_BIND "$BIND"; setkv ARCH_PORT "$PORT"
setkv MEALSENSE_DIR "$MEALSENSE_DIR"; setkv CEREBRO_DIR "$CEREBRO_DIR"
setkv MEALSENSE_MODEL "$MEALSENSE_MODEL"; setkv CEREBRO_MODEL "$CEREBRO_MODEL"

# The CEREBRO demo video: the newest one demo/run.sh made, or DEMO_VIDEO=/path/to/CEREBRO-demo.mp4.
# Copied into media/ (not committed: it is large) with its subtitles converted to WebVTT for browsers.
mkdir -p media
DEMO_VIDEO="${DEMO_VIDEO:-$(ls -t "$HOME"/cerebro-demo-*/CEREBRO-demo.mp4 2>/dev/null | head -1 || true)}"
if [ -n "$DEMO_VIDEO" ] && [ -f "$DEMO_VIDEO" ]; then
  echo "==> CEREBRO demo: $DEMO_VIDEO"
  cmp -s "$DEMO_VIDEO" media/cerebro-demo.mp4 || cp "$DEMO_VIDEO" media/cerebro-demo.mp4
  SRT="${DEMO_VIDEO%.mp4}.srt"
  if [ -f "$SRT" ]; then
    { printf 'WEBVTT\n\n'; sed -E 's/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/\1.\2/g' "$SRT"; } > media/cerebro-demo.vtt
  fi
else
  echo "-- No CEREBRO demo video found (~/cerebro-demo-*/CEREBRO-demo.mp4); the card has no Watch demo link."
fi

docker compose --profile build run --rm build
docker compose up -d --wait web
curl -fsS "http://$BIND:$PORT/healthz" >/dev/null && echo "==> Portfolio: http://$BIND:$PORT/ (and https://folio.xtangent.ai)"
