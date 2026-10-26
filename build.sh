#!/bin/sh
# Build each LikeC4 model mounted under /models/<name> into /site/<name>/, then write the index.
# Runs inside the node container (see docker-compose.yml). A model that is missing or invalid is
# skipped with a message rather than failing the whole site.
set -eu
VERSION="${LIKEC4_VERSION:-1.60.0}"
MODELS="${MODELS_DIR:-/models}"
SITE="${SITE_DIR:-/site}"
TEMPLATE="${TEMPLATE:-/work/index.template.html}"
STAGE="${TMPDIR:-/tmp}/likec4-site"
rm -rf "$STAGE" && mkdir -p "$STAGE"
built=""

for dir in "$MODELS"/*; do
  name="$(basename "$dir")"
  if ! ls "$dir"/*.c4 >/dev/null 2>&1; then
    echo "-- $name: no .c4 files at the mounted path, skipped"
    continue
  fi
  echo "==> $name: validate"
  if ! npx -y "likec4@$VERSION" validate "$dir"; then
    echo "-- $name: invalid model, skipped (fix it and run the build again)"
    continue
  fi
  echo "==> $name: build"
  # Hash history keeps every view a plain file request, so nginx needs no rewrite rules.
  npx -y "likec4@$VERSION" build "$dir" -o "$STAGE/$name" --base "/$name/" --use-hash-history \
    --title "$name architecture"
  built="$built $name"
done

if [ -z "$built" ]; then
  echo "!! nothing was built; the site was left as it was"
  exit 1
fi

links=""
for name in $built; do
  case "$name" in
    mealsenseai) label="MealSenseAI"; desc="Photo-based meal logging with explainable nutrition and glucose estimates." ;;
    cerebro) label="CEREBRO"; desc="Adaptive Knowledge and Reasoning Digital Twin: Learn, Connect, Reason, Recall." ;;
    *) label="$name"; desc="" ;;
  esac
  links="$links<a class=\"card\" href=\"/$name/\"><strong>$label</strong><span>$desc</span></a>"
done
stamp="$(date -u '+%Y-%m-%d %H:%M UTC')"
sed -e "s|{{TITLE}}|${SITE_TITLE:-Buddy architecture}|g" -e "s|{{LINKS}}|$links|" \
  -e "s|{{STAMP}}|$stamp|" -e "s|{{VERSION}}|$VERSION|" "$TEMPLATE" > "$STAGE/index.html"
echo "ok" > "$STAGE/healthz"

# Swap in the finished site in one step, so the server never shows a half-built one.
find "$SITE" -mindepth 1 -delete && cp -R "$STAGE"/. "$SITE"/
echo "==> built:$built"
