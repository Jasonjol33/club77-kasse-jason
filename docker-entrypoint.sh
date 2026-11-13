#!/bin/sh
set -e
chown -R node:node "${DATA_DIR:-/data}" 2>/dev/null || true
exec su-exec node "$@"
