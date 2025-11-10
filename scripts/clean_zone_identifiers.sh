#!/usr/bin/env bash
set -euo pipefail

# Remove Windows Zone.Identifier artifacts that sometimes sneak into repos
# Matches either suffix files like "foo.ts:Zone.Identifier" or names containing "Zone.Identifier"

ROOT_DIR="${1:-.}"

if [ ! -d "$ROOT_DIR" ]; then
  echo "[CLEAN] Provided path is not a directory: $ROOT_DIR" >&2
  exit 1
fi

echo "[CLEAN] Removing Zone.Identifier artifacts under: $ROOT_DIR"

# Use find to safely handle odd characters and nested paths
find "$ROOT_DIR" -type f \
  \( -name '*:Zone.Identifier' -o -name '*Zone.Identifier*' \) \
  -print -delete || true

echo "[CLEAN] Done"

