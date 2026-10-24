'use strict';
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCalendar } = require('../lib/dates');

const peg = { name: 'Margaret Rose', nickname: 'Peg', born: '1946-03-04', died: '2025-06-12' };

test('birthday highlight counts the years', () => {
  const cal = buildCalendar(peg, [], '2026-03-04');
  assert.equal(cal.highlights[0].text, "Today would have been Peg's 80th birthday");
});

test('the day of passing is not highlighted in the same year', () => {
  assert.equal(buildCalendar(peg, [], '2025-06-12').highlights.length, 0);
  assert.equal(buildCalendar(peg, [], '2026-06-12').highlights[0].text, 'Remembering Peg, 1 year today');
});

test('upcoming dates and unknown years', () => {
  const cal = buildCalendar(peg, [{ id: 'a', type: 'anniversary', label: 'Wedding anniversary', date: '--03-10' }], '2026-03-01');
  assert.deepEqual(cal.upcoming.map((u) => [u.label, u.inDays, u.years]), [["Peg's birthday", 3, 80], ['Wedding anniversary', 9, null]]);
});

test('Feb 29 birthdays show on Feb 28 in other years', () => {
  const cal = buildCalendar({ name: 'Leap Day', born: '1948-02-29' }, [], '2027-02-28');
  assert.equal(cal.highlights.length, 1);
});

test('api: setup, codes, upload, feed, range requests', async (t) => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'urn-'));
  process.env.PORT = '0';
  const { start } = require('../server');
  const server = start();
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  let r = await post('/api/setup', { name: 'Margaret Rose', born: '1946-03-04', familyCode: 'roses', ownerCode: 'secret1' });
  assert.equal(r.status, 200);
  assert.equal((await post('/api/setup', { name: 'x', familyCode: 'abcd', ownerCode: 'abcdef' })).status, 409);

  assert.equal((await post('/api/login', { code: 'nope' })).status, 401);
  r = await post('/api/login', { code: ' ROSES ' });
  assert.equal((await r.json()).role, 'family');
  const cookie = r.headers.get('set-cookie').split(';')[0];

  const fd = new FormData();
  fd.append('from', 'Sarah');
  fd.append('file', new Blob([Buffer.alloc(1000, 1)], { type: 'audio/webm' }), 'v.webm');
  r = await fetch(base + '/api/upload', { method: 'POST', body: fd, headers: { cookie } });
  const item = await r.json();
  assert.equal(item.kind, 'voice');

  const bad = new FormData();
  bad.append('file', new Blob(['<html>'], { type: 'text/html' }), 'x.html');
  assert.equal((await fetch(base + '/api/upload', { method: 'POST', body: bad, headers: { cookie } })).status, 415);

  // family cannot delete; owner can
  assert.equal((await fetch(base + `/api/items/${item.id}`, { method: 'DELETE', headers: { cookie } })).status, 403);

  r = await fetch(base + item.url, { headers: { cookie, range: 'bytes=0-99' } });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 100);

  r = await fetch(base + '/api/feed?date=2026-03-04', { headers: { cookie } });
  const feed = await r.json();
  assert.equal(feed.items.length, 1);
  assert.match(feed.calendar.highlights[0].text, /80th birthday/);
});
