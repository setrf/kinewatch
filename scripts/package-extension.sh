#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/release"
OUTPUT_ZIP="${RELEASE_DIR}/kinewatch-extension.zip"

rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

(
  cd "${ROOT_DIR}/extension"
  zip -r "${OUTPUT_ZIP}" . -x "*.DS_Store"
)

echo "Created ${OUTPUT_ZIP}"
