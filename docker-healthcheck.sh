#!/bin/sh
# Reads PORT at runtime
curl -f "http://127.0.0.1:${PORT:-7050}/health" || exit 1
