#!/usr/bin/env python3
"""Physical button on the keepsake.

Wire a momentary push button between GPIO 17 (pin 11) and ground (pin 9).
Short press plays the next voice note; hold for 1 second to skip to the next photo.
Install: sudo cp button.service /etc/systemd/system/ && sudo systemctl enable --now button
"""
import json
import urllib.request
from signal import pause

from gpiozero import Button

URL = "http://localhost:8080/api/device/action"
button = Button(17, bounce_time=0.05, hold_time=1.0)
held = False


def send(action):
    req = urllib.request.Request(URL, data=json.dumps({"action": action}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=3).read()
    except OSError as e:
        print("keepsake server not reachable:", e)


def on_hold():
    global held
    held = True
    send("next")


def on_release():
    global held
    if not held:
        send("voice")
    held = False


button.when_held = on_hold
button.when_released = on_release
pause()
