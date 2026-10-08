#!/bin/sh
# ──────────────────────────────────────────────────────────
# Nginx entrypoint — picks HTTP or SSL config based on
# whether SITE_DOMAIN is set and certs exist.
#
# When SSL is active, runs a background watcher that reloads
# nginx when certbot renews certificates (via .renewed flag).
# ──────────────────────────────────────────────────────────
set -e

if [ -n "$SITE_DOMAIN" ] && [ -f "/etc/letsencrypt/live/$SITE_DOMAIN/fullchain.pem" ]; then
  echo "SSL certs found for $SITE_DOMAIN — enabling HTTPS"
  envsubst '${SITE_DOMAIN} ${HTTPS_PORT}' < /etc/nginx/templates/ssl.conf.template > /etc/nginx/conf.d/default.conf
else
  if [ -n "$SITE_DOMAIN" ]; then
    echo "SSL certs not found for $SITE_DOMAIN — starting HTTP-only (run certbot first)"
  fi
  cp /etc/nginx/http.conf /etc/nginx/conf.d/default.conf
fi

# Background cert renewal watcher — checks for .renewed flag from certbot
# and reloads nginx to pick up new certs
if [ -n "$SITE_DOMAIN" ]; then
  (while true; do
    sleep 60
    if [ -f /etc/letsencrypt/.renewed ]; then
      rm -f /etc/letsencrypt/.renewed
      # Re-generate SSL config in case this is the first cert
      if [ -f "/etc/letsencrypt/live/$SITE_DOMAIN/fullchain.pem" ]; then
        envsubst '${SITE_DOMAIN} ${HTTPS_PORT}' < /etc/nginx/templates/ssl.conf.template > /etc/nginx/conf.d/default.conf
        nginx -s reload 2>/dev/null || true
        echo "Nginx reloaded with renewed certificates"
      fi
    fi
  done) &
fi

exec nginx -g 'daemon off;'
