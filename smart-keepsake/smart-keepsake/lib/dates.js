'use strict';
// Date helpers for birthday / anniversary highlights.
// Dates are stored as 'YYYY-MM-DD', or '--MM-DD' when the year is unknown.

function parseDate(s) {
  const m = /^(?:(\d{4})-|--)(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const month = +m[2], day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: m[1] ? +m[1] : null, month, day };
}

function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// The date this month/day falls on in a given year (Feb 29 -> Feb 28 off leap years).
function occurrence(month, day, year) {
  if (month === 2 && day === 29 && !isLeap(year)) day = 28;
  return new Date(year, month - 1, day);
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function firstName(memorial) {
  if (!memorial) return '';
  return (memorial.nickname || memorial.name || '').trim().split(/\s+/)[0];
}

// Every remembered date: the profile's birth and passing dates plus custom ones.
function allDates(memorial, custom) {
  const out = [];
  if (memorial && parseDate(memorial.born)) {
    out.push({ id: 'born', type: 'birthday', label: `${firstName(memorial)}'s birthday`, date: memorial.born });
  }
  if (memorial && parseDate(memorial.died)) {
    out.push({ id: 'died', type: 'passing', label: `Remembering ${firstName(memorial)}`, date: memorial.died });
  }
  for (const d of custom || []) if (parseDate(d.date)) out.push(d);
  return out;
}

function headline(entry, years, memorial) {
  const name = firstName(memorial);
  switch (entry.type) {
    case 'birthday':
      return years ? `Today would have been ${name}'s ${ordinal(years)} birthday` : `Happy birthday, ${name}`;
    case 'passing':
      return years ? `Remembering ${name}, ${years} year${years === 1 ? '' : 's'} today` : `Remembering ${name} today`;
    case 'anniversary':
      return years ? `${entry.label} · ${years} year${years === 1 ? '' : 's'}` : entry.label;
    default:
      return entry.label;
  }
}

// Returns today's highlights and dates coming up within `horizon` days.
function buildCalendar(memorial, custom, todayStr, horizon = 14) {
  const t = parseDate(todayStr) || parseDate(localToday());
  const today = new Date(t.year, t.month - 1, t.day);
  const DAY = 86400000;
  const highlights = [], upcoming = [];

  for (const entry of allDates(memorial, custom)) {
    const d = parseDate(entry.date);
    let next = occurrence(d.month, d.day, t.year);
    if (next < today) next = occurrence(d.month, d.day, t.year + 1);
    const inDays = Math.round((next - today) / DAY);
    const years = d.year ? next.getFullYear() - d.year : null;
    if (years !== null && years < 0) continue;
    if (inDays === 0) {
      // The day of passing itself is not a "highlight" until a year has gone by.
      if (entry.type === 'passing' && years === 0) continue;
      highlights.push({ id: entry.id, type: entry.type, label: entry.label, years, text: headline(entry, years, memorial) });
    } else if (inDays <= horizon) {
      upcoming.push({ id: entry.id, type: entry.type, label: entry.label, years, inDays, on: localToday(next) });
    }
  }
  upcoming.sort((a, b) => a.inDays - b.inDays);
  return { today: localToday(today), highlights, upcoming };
}

module.exports = { parseDate, localToday, buildCalendar, ordinal, firstName, allDates };
