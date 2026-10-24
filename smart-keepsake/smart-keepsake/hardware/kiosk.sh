#!/bin/sh
# Opens the keepsake screen full screen. Run by keepsake-kiosk.service inside
# the "cage" kiosk compositor. Waits for the local server first.
until curl -s -o /dev/null http://localhost:8080/api/memorial; do sleep 1; done
BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 \
  --disable-features=Translate --ozone-platform=wayland \
  --enable-features=OverlayScrollbar --password-store=basic \
  "http://localhost:8080/device${KEEPSAKE_SHAPE:+?shape=$KEEPSAKE_SHAPE}"
