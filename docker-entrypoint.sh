#!/bin/sh

set -e

echo "Starting Xvfb..."

Xvfb :99 -screen 0 1920x1080x24 -ac > /tmp/xvfb.log 2>&1 &

export DISPLAY=:99

sleep 2

echo "Starting Adobe Analytics Validator server..."

exec node server/server.js