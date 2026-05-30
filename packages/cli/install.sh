#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. Install Node.js 16 or newer first." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm first." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Installing dependencies..."
npm install

echo "Installing cloud189 command..."
npm link

echo
echo "Installed. Try:"
echo "  cloud189 help"
echo "  cloud189 login-qr"
