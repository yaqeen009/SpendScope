# Security headers for the static single-page app.
#
# This file is `include`d at the server level *and* inside every `location` that
# sets its own `add_header`: nginx discards inherited `add_header` directives as
# soon as a location defines one, and silently losing `nosniff` on `/assets/`
# would be an easy mistake to make.
#
# `always` keeps the headers on error responses too.
#
# HSTS is deliberately not set here. It belongs on whichever layer terminates
# TLS, because the header must only ever be sent over HTTPS; see
# docs/DEPLOYMENT.md.

add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;

# The bundle is self-hosted, so nothing third-party is allowed. `connect-src
# 'self'` covers the same-origin `/api` calls; no analytics or font CDN is
# permitted, which matches the product's "no third-party telemetry" stance.
# `style-src 'unsafe-inline'` is required by the charting library's inline
# styles; no inline <script> is allowed.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
