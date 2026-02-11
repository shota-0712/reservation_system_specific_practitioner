#!/bin/sh
set -eu

: "${RESERVATION_API_URL:=}"
: "${RESERVATION_TENANT_KEY:=}"
: "${RESERVATION_ENABLE_MOCK:=false}"
: "${RESERVATION_BYPASS_LIFF:=false}"

envsubst '${RESERVATION_API_URL} ${RESERVATION_TENANT_KEY} ${RESERVATION_ENABLE_MOCK} ${RESERVATION_BYPASS_LIFF}' \
  < /usr/share/nginx/html/config.template.js \
  > /usr/share/nginx/html/config.js

exec "$@"
