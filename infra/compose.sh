#!/bin/bash
# Guard-railed wrapper (docs/08 M3, docs/13 §2): refuses commands that would destroy persistent volumes.
set -euo pipefail
for arg in "$@"; do
  case "$arg" in
    -v|--volumes|--remove-orphans) if [ "${1:-}" = "down" ] || [ "${1:-}" = "rm" ]; then echo "refusing '$1 $arg' on production: volumes hold the database and recordings" >&2; exit 2; fi ;;
  esac
done
exec docker compose -f "$(dirname "$0")/docker/compose.yml" "$@"
