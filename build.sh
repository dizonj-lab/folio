#!/bin/sh
# Build each LikeC4 model mounted under /models/<name> into /site/<name>/, then write the portfolio index.
# Runs inside the node container (see docker-compose.yml). A model that is missing or invalid is
# skipped with a message rather than failing the whole site.
set -eu
VERSION="${LIKEC4_VERSION:-1.60.0}"
MODELS="${MODELS_DIR:-/models}"
SITE="${SITE_DIR:-/site}"
WORK="${WORK_DIR:-/work}"
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
  # --no-use-dot: inside a container LikeC4 expects the Graphviz `dot` program, which the node
  # image does not have; this uses LikeC4's bundled layout engine instead.
  npx -y "likec4@$VERSION" build "$dir" -o "$STAGE/$name" --base "/$name/" --use-hash-history \
    --no-use-dot --title "$name architecture"
  built="$built $name"
done

if [ -z "$built" ]; then
  echo "!! nothing was built; the site was left as it was"
  exit 1
fi

# The index is the portfolio: content from portfolio.json (and pages/), rendered into the templates.
node "$WORK/render.mjs" "$WORK" "$STAGE" "$built" "$VERSION"
cp -R "$WORK/brand" "$STAGE/brand" && cp "$WORK/site.css" "$STAGE/site.css"
echo "ok" > "$STAGE/healthz"

# Swap in the finished site in one step, so the server never shows a half-built one.
find "$SITE" -mindepth 1 -delete && cp -R "$STAGE"/. "$SITE"/
echo "==> built:$built"
