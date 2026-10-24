# Smart keepsake (urn) software

Proof of concept software for the DT smart urn / keepsake. One small program runs on the urn and does three jobs:

| Page | Who uses it | What it does |
|---|---|---|
| `/device` | The urn's own screen | Photo slideshow, written messages, voice notes on a button press, birthday and anniversary highlights, night dimming |
| `/family` | Family, on their phones | Enter the family code once, then add photos, record voice notes, write messages, see what's coming up |
| `/admin` | The owner (one family member) | First-time setup, edit the profile, special dates, pick the portrait, delete things, change codes |
| `/sim` | You, while there's no hardware | The urn screen in a frame, a fake button and NFC tag, screen sizes, "pretend today is", night preview, demo data |

No AI features. No cloud account. Everything stays on the urn.

## Run it on your computer (no Pi needed)

1. Install Node.js 20 or newer from nodejs.org.
2. In this folder run: `npm start`
3. Open **http://localhost:8080/sim** and click **Load demo family**.

Demo codes: family `roses1946`, owner `peg-owner`. The demo person's birthday is set to "today" so you see the birthday highlight straight away.

To try the family page on your real phone, put the phone on the same Wi-Fi and open the "Family app" address the server prints at startup (for example `http://192.168.1.20:8080/family`).

To start over, stop the server and delete the `data` folder.

Run the tests with `npm test`.

## How things work

- **Codes, not accounts.** The owner picks a family code (shared with family) and a private owner code. A phone that enters a code stays signed in for a year. Changing a code signs every phone out.
- **The urn's own screen needs no code**, because it runs on the same machine.
- **Photos are shrunk on the phone** before upload (about 1920 px JPEG). This keeps the Pi's storage small and turns iPhone HEIC photos into something the screen can show.
- **Voice notes**: recording inside the page needs a secure (https) connection, which a home Wi-Fi address doesn't have. On plain Wi-Fi the page offers "choose an audio file" so people can use their phone's voice recorder instead. Moving to https (see next steps) turns in-page recording on.
- **Live updates**: new photos and messages appear on the urn within a second, with a "New photo from Sarah" badge.
- **Special days**: birthday and passing date come from the profile. The owner can add anniversaries (with or without a known year). On the day, the urn opens with a card like "Today would have been Peg's 80th birthday". The family page lists dates coming up in the next two weeks.
- **Night dimming**: between the hours set by the owner (default 10 pm to 7 am) the screen goes nearly black with a faint clock. Touching it or pressing the button wakes it for a minute.
- **NFC**: the plan is a cheap passive NFC sticker (NTAG215) inside the shell, written with the family page address using a free phone app such as NFC Tools. Tapping a phone on the urn opens the family page. No reader on the Pi is needed. The simulator's NFC spot opens the family page in the phone frame.
- **The button**: short press plays the next voice note, hold for 1 second to skip to the next photo.

## Files

```
server.js            the whole server (no extra packages)
lib/dates.js         birthday / anniversary logic
lib/demo.js          demo person for the simulator
public/              the four pages
hardware/            Raspberry Pi setup: kiosk, boot services, GPIO button
test/                automated tests
data/                created at first run: db.json + media/ (photos, voice notes)
```

## Moving to the Raspberry Pi (when parts arrive)

Suggested parts for the first prototype (prices are rough estimates, check current listings):

- Raspberry Pi Zero 2 W, about $15, plus a 32 GB microSD card
- A screen. Good fits: a 4" 720 × 720 square HDMI or DPI screen, a 2.1" 480 × 480 round screen (Pimoroni HyperPixel 2.1 Round), or a 5" 800 × 480. The simulator has all three.
- Sound: the Zero has no headphone jack. Use a MAX98357A I2S amplifier board (about $6) and a small 3 W speaker, or a USB sound card.
- A momentary push button and an NTAG215 NFC sticker.
- A 5 V 2.5 A USB power supply.

Setup:

1. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager. In the Imager settings set user `pi`, your Wi-Fi, and turn on SSH.
2. On the Pi:
   ```sh
   sudo apt update
   sudo apt install -y nodejs cage chromium python3-gpiozero curl
   node --version   # needs 20 or newer
   ```
   If `node --version` is older than 20, install Node from nodesource.com instead.
3. Copy this folder to `/home/pi/keepsake` (for example with `scp -r`).
4. Turn on the services:
   ```sh
   cd /home/pi/keepsake/hardware
   sudo cp keepsake.service keepsake-kiosk.service button.service /etc/systemd/system/
   sudo systemctl enable --now keepsake keepsake-kiosk button
   ```
5. From a phone or laptop on the same Wi-Fi, open `http://<pi-address>:8080/admin` to set it up.

Notes for the Pi:

- The kiosk browser is started with autoplay allowed, so the button plays sound without anyone touching the screen. In a normal browser the first tap enables sound.
- The Zero 2 W has 512 MB of memory. Chromium fits for a slideshow, but if it struggles, a lighter screen app can replace `/device` later without changing anything else.
- Each screen needs its own driver setup (usually a line in `/boot/firmware/config.txt`). Follow the screen maker's guide.
- For a round screen, add `Environment=KEEPSAKE_SHAPE=round` to `keepsake-kiosk.service`.

## Next steps worth considering

- **A cloud companion service.** Right now family must be on the same Wi-Fi as the urn. A small hosted service would let family add memories from anywhere, give https (in-page voice recording), back up the memories, and is where a subscription would live. This is the biggest step toward a product.
- **A QR code** on the setup screen and printed card, next to the NFC tag, for phones without NFC.
- **Wi-Fi setup without a keyboard** for customers (a hotspot setup page on first boot).
- **Moderation**: let the owner approve uploads before they show, if families want that.
