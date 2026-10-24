'use strict';
// Sample content for the simulator: a made-up person, a few painted "photos"
// (SVG), messages and a short tune as a voice note.

const { localToday } = require('./dates');

function scene({ sky, sun, hills, water, extra = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${water[0]}"/><stop offset="1" stop-color="${water[1]}"/></linearGradient>
<radialGradient id="g"><stop offset="0" stop-color="${sun}" stop-opacity=".9"/><stop offset="1" stop-color="${sun}" stop-opacity="0"/></radialGradient></defs>
<rect width="1600" height="1200" fill="url(#s)"/>
<circle cx="1050" cy="560" r="360" fill="url(#g)"/><circle cx="1050" cy="560" r="90" fill="${sun}"/>
<path d="M0 640 C 260 470 420 560 640 500 S 1100 420 1600 560 V 760 H 0 Z" fill="${hills[0]}"/>
<path d="M0 700 C 300 600 600 690 900 620 S 1350 640 1600 660 V 780 H 0 Z" fill="${hills[1]}"/>
<rect y="760" width="1600" height="440" fill="url(#w)"/>
<g fill="${sun}" opacity=".5"><rect x="990" y="800" width="120" height="6" rx="3"/><rect x="960" y="850" width="180" height="6" rx="3"/><rect x="1010" y="905" width="80" height="6" rx="3"/></g>
${extra}</svg>`;
}

function garden() {
  let flowers = '';
  const colors = ['#e2546b', '#f2a541', '#f7d6e0', '#c04f8f', '#ffffff', '#ef7b45'];
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 140; i++) {
    const x = rnd() * 1600, y = 620 + rnd() * 580, r = 14 + rnd() * 26 * (y / 900);
    const c = colors[Math.floor(rnd() * colors.length)];
    flowers += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + r * 3}" stroke="#3f6b35" stroke-width="${r / 5}"/>`;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      flowers += `<circle cx="${x + Math.cos(a) * r * .7}" cy="${y + Math.sin(a) * r * .7}" r="${r * .6}" fill="${c}"/>`;
    }
    flowers += `<circle cx="${x}" cy="${y}" r="${r * .45}" fill="#f6d55c"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd3f0"/><stop offset="1" stop-color="#e9f6fb"/></linearGradient></defs>
<rect width="1600" height="1200" fill="url(#s)"/><rect y="560" width="1600" height="640" fill="#5f8f4e"/>
<path d="M0 560 C 400 520 800 600 1600 540 V 600 H 0Z" fill="#4c7a3f"/>${flowers}</svg>`;
}

function portrait() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
<defs><radialGradient id="b" cx=".5" cy=".4"><stop offset="0" stop-color="#f3d9b8"/><stop offset="1" stop-color="#9c6b4e"/></radialGradient></defs>
<rect width="1200" height="1200" fill="url(#b)"/>
<path d="M300 1200 C 320 900 460 820 600 820 S 880 900 900 1200Z" fill="#5a6f8f"/>
<circle cx="600" cy="560" r="220" fill="#e9c4a4"/>
<path d="M370 560 C 360 300 520 250 600 250 S 860 300 830 560 C 800 420 700 380 600 380 S 400 420 370 560Z" fill="#d9d4cf"/>
<circle cx="525" cy="560" r="16" fill="#3b2a22"/><circle cx="675" cy="560" r="16" fill="#3b2a22"/>
<path d="M520 650 Q 600 710 680 650" stroke="#a0574a" stroke-width="12" fill="none" stroke-linecap="round"/>
<circle cx="600" cy="840" r="22" fill="#f4efe6"/><circle cx="560" cy="830" r="16" fill="#f4efe6"/><circle cx="640" cy="830" r="16" fill="#f4efe6"/></svg>`;
}

// "Happy Birthday" opening, as a soft sine-tone WAV.
function tuneWav() {
  const rate = 22050;
  const notes = [[392, .4], [392, .2], [440, .6], [392, .6], [523, .6], [494, 1.1], [0, .3],
    [392, .4], [392, .2], [440, .6], [392, .6], [587, .6], [523, 1.2]];
  const samples = [];
  for (const [f, d] of notes) {
    const n = Math.floor(rate * d);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 400) * Math.min(1, (n - i) / 1600);
      const t = i / rate;
      samples.push(f ? env * 0.28 * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) : 0);
    }
  }
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, 44 + i * 2));
  return { buf, seconds: samples.length / rate };
}

// Returns everything the server needs to fill an empty keepsake.
function demoContent(now = new Date()) {
  const today = localToday(now);
  const inDays = (n) => localToday(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const tune = tuneWav();
  const svg = (s) => ({ mime: 'image/svg+xml', ext: '.svg', buf: Buffer.from(s) });
  return {
    memorial: {
      name: 'Margaret Ann Rose', nickname: 'Peg',
      born: `1946-${today.slice(5)}`, // her birthday is "today", so the highlight shows right away
      died: '2025-06-12',
      tribute: 'Loved her garden, her grandkids, and a good crossword.',
    },
    familyCode: 'roses1946',
    ownerCode: 'peg-owner',
    dates: [{ type: 'anniversary', label: 'Wedding anniversary', date: `1968-${inDays(5).slice(5)}` }],
    items: [
      { kind: 'photo', from: 'Dad', caption: 'Peg, 1971', file: svg(portrait()), cover: true },
      { kind: 'photo', from: 'Sarah', caption: 'Lake Tahoe, summer 1978', file: svg(scene({ sky: ['#f6a96b', '#fbe2c5'], sun: '#fff1c9', hills: ['#6c5b7b', '#8c6f88'], water: ['#c0846d', '#5e4b5f'] })) },
      { kind: 'message', from: 'Sarah (granddaughter)', text: 'I planted your tulips by the porch this spring. They came up exactly the way you said they would.' },
      { kind: 'photo', from: 'Uncle Joe', caption: 'Her garden in full bloom', file: svg(garden()) },
      { kind: 'photo', from: 'Mom', caption: 'Morning walk at Point Reyes', file: svg(scene({ sky: ['#7fb7e0', '#dcefff'], sun: '#ffffff', hills: ['#5d8a6a', '#7aa37f'], water: ['#3f7fa8', '#244a66'] })) },
      { kind: 'voice', from: 'The grandkids', caption: 'Happy birthday, Grandma', file: { mime: 'audio/wav', ext: '.wav', buf: tune.buf }, duration: Math.round(tune.seconds) },
      { kind: 'message', from: 'Joe', text: 'Still can’t finish a Sunday crossword without you.' },
      { kind: 'photo', from: 'Sarah', caption: 'Evening on the bay', file: svg(scene({ sky: ['#2c3e66', '#e98d6b'], sun: '#ffd29a', hills: ['#2a2f45', '#3c3f58'], water: ['#3b4566', '#141a2c'] })) },
      { kind: 'message', from: 'Mom', text: 'Happy birthday, Mom. We had cake for you today.' },
    ],
  };
}

module.exports = { demoContent };
