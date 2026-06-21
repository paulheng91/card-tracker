// Pure logic extracted from cube-tracker.html — kept in sync manually.
// Run: npm test

// ── colorKey ─────────────────────────────────────────────────────────────────

function colorKey(card) {
  let c = card.colors ?? [];
  if (c.length === 0 && card.card_faces?.length > 0) {
    const all = new Set();
    card.card_faces.forEach(f => (f.colors ?? []).forEach(x => all.add(x)));
    c = [...all];
  }
  if (c.length > 1) return 'M';
  if (c.length === 1) return c[0];
  if (card.type_line?.includes('Land')) return 'L';
  return 'A';
}

describe('colorKey', () => {
  test('single color card', () => {
    expect(colorKey({ colors: ['U'] })).toBe('U');
    expect(colorKey({ colors: ['G'] })).toBe('G');
  });

  test('multicolor card goes to M', () => {
    expect(colorKey({ colors: ['U', 'R'] })).toBe('M');
    expect(colorKey({ colors: ['W', 'B', 'G'] })).toBe('M');
  });

  test('basic land', () => {
    expect(colorKey({ colors: [], type_line: 'Basic Land — Forest' })).toBe('L');
  });

  test('nonbasic land', () => {
    expect(colorKey({ colors: [], type_line: 'Land' })).toBe('L');
  });

  test('colorless artifact', () => {
    expect(colorKey({ colors: [], type_line: 'Artifact Creature — Golem' })).toBe('A');
  });

  test('DFC: colors on card_faces only (regression — was going to Artifact)', () => {
    expect(colorKey({
      colors: [],
      card_faces: [{ colors: ['G'] }, { colors: ['G'] }],
      type_line: 'Creature — Human Werewolf // Creature — Werewolf',
    })).toBe('G');
  });

  test('DFC: multicolor across faces', () => {
    expect(colorKey({
      colors: [],
      card_faces: [{ colors: ['U'] }, { colors: ['R'] }],
      type_line: 'Creature — Human // Creature — Horror',
    })).toBe('M');
  });

  test('DFC: top-level colors take precedence over face colors', () => {
    expect(colorKey({
      colors: ['W'],
      card_faces: [{ colors: ['W'] }, { colors: [] }],
    })).toBe('W');
  });
});

// ── isDFC ────────────────────────────────────────────────────────────────────

function isDFC(card) {
  return card.card_faces?.length > 1;
}

describe('isDFC', () => {
  test('returns false for single-face cards', () => {
    expect(isDFC({ name: 'Lightning Bolt' })).toBeFalsy();
    expect(isDFC({ card_faces: [] })).toBeFalsy();
    expect(isDFC({ card_faces: [{ name: 'Front' }] })).toBeFalsy();
  });

  test('returns true for double-faced cards', () => {
    expect(isDFC({ card_faces: [{ name: 'Front' }, { name: 'Back' }] })).toBe(true);
  });
});

// ── topSeverity ───────────────────────────────────────────────────────────────

function topSeverity(matches) {
  if (!matches.length) return null;
  return matches.some(m => m.severity === 'high') ? 'high' : 'low';
}

describe('topSeverity', () => {
  test('returns null when no matches', () => {
    expect(topSeverity([])).toBeNull();
  });

  test('returns low when all matches are low', () => {
    expect(topSeverity([{ severity: 'low' }, { severity: 'low' }])).toBe('low');
  });

  test('returns high if any match is high', () => {
    expect(topSeverity([{ severity: 'low' }, { severity: 'high' }])).toBe('high');
    expect(topSeverity([{ severity: 'high' }])).toBe('high');
  });
});

// ── getErrataMatches ──────────────────────────────────────────────────────────

const ERRATA_CATEGORIES = [
  {
    id: 'any-target', severity: 'high',
    test: t => t.includes('any target'),
  },
  {
    id: 'target-planeswalker', severity: 'high',
    test: t => t.includes('target player or planeswalker'),
  },
  {
    id: 'etb-ltb', severity: 'low',
    test: t => (/\benters\b/.test(t) && !t.includes('enters the battlefield'))
            || (/\bleaves\b/.test(t) && !t.includes('leaves the battlefield')),
  },
  {
    id: 'create-token', severity: 'low',
    test: t => t.includes('create') && t.includes('token'),
  },
];

function getErrataMatches(cardName, oracleMap) {
  const text = oracleMap[cardName] ?? '';
  return ERRATA_CATEGORIES.filter(cat => cat.test(text));
}

describe('getErrataMatches', () => {
  test('clean oracle text has no matches', () => {
    expect(getErrataMatches('Forest', { Forest: '' })).toHaveLength(0);
  });

  test('detects "any target" (high)', () => {
    const map = { 'Lightning Bolt': 'Lightning Bolt deals 3 damage to any target.' };
    const m = getErrataMatches('Lightning Bolt', map);
    expect(m.some(x => x.id === 'any-target')).toBe(true);
    expect(m.some(x => x.severity === 'high')).toBe(true);
  });

  test('detects "target player or planeswalker" (high)', () => {
    const map = { 'Shock': 'Deals 2 damage to target player or planeswalker.' };
    const m = getErrataMatches('Shock', map);
    expect(m.some(x => x.id === 'target-planeswalker')).toBe(true);
  });

  test('detects ETB shortening (low) — "enters" without "enters the battlefield"', () => {
    const map = { 'Elvish Visionary': 'When Elvish Visionary enters, draw a card.' };
    const m = getErrataMatches('Elvish Visionary', map);
    expect(m.some(x => x.id === 'etb-ltb')).toBe(true);
    expect(m.some(x => x.severity === 'low')).toBe(true);
  });

  test('does NOT flag old "enters the battlefield" wording as errata', () => {
    const map = { 'Old Card': 'When Old Card enters the battlefield, draw a card.' };
    expect(getErrataMatches('Old Card', map).some(x => x.id === 'etb-ltb')).toBe(false);
  });

  test('detects LTB shortening', () => {
    const map = { 'Frost Titan': 'When Frost Titan leaves, untap all lands you control.' };
    expect(getErrataMatches('Frost Titan', map).some(x => x.id === 'etb-ltb')).toBe(true);
  });

  test('does NOT flag "leaves the battlefield" (old wording)', () => {
    const map = { 'Old Card': 'When Old Card leaves the battlefield, do something.' };
    expect(getErrataMatches('Old Card', map).some(x => x.id === 'etb-ltb')).toBe(false);
  });

  test('detects token creation wording (low)', () => {
    const map = { 'Lingering Souls': 'Create two 1/1 white Spirit creature tokens with flying.' };
    const m = getErrataMatches('Lingering Souls', map);
    expect(m.some(x => x.id === 'create-token')).toBe(true);
  });

  test('missing card name returns no matches', () => {
    expect(getErrataMatches('Nonexistent Card', {})).toHaveLength(0);
  });

  test('card can match multiple categories', () => {
    const map = { 'Multi': 'Deals 1 damage to any target. Create a 1/1 token.' };
    const m = getErrataMatches('Multi', map);
    expect(m.length).toBeGreaterThanOrEqual(2);
    expect(m.some(x => x.id === 'any-target')).toBe(true);
    expect(m.some(x => x.id === 'create-token')).toBe(true);
  });
});

// ── hasUncategorizedChange ────────────────────────────────────────────────────

function hasUncategorizedChange(cardName, oracleMap, oracleSnapshot, activeCube) {
  const snap = oracleSnapshot[activeCube]?.[cardName];
  if (snap === undefined) return false;
  if (snap === (oracleMap[cardName] ?? '')) return false;
  return getErrataMatches(cardName, oracleMap).length === 0;
}

describe('hasUncategorizedChange', () => {
  const cube = 'isd';

  test('returns false when no snapshot exists for card', () => {
    expect(hasUncategorizedChange('Delver', {}, {}, cube)).toBe(false);
  });

  test('returns false when oracle text matches snapshot', () => {
    const oracleMap = { 'Delver': 'flip text' };
    const snap = { isd: { 'Delver': 'flip text' } };
    expect(hasUncategorizedChange('Delver', oracleMap, snap, cube)).toBe(false);
  });

  test('returns false when text changed but matches a known category', () => {
    const oracleMap = { 'Shock': 'Deals 2 damage to any target.' };
    const snap = { isd: { 'Shock': 'Deals 2 damage to target creature or player.' } };
    expect(hasUncategorizedChange('Shock', oracleMap, snap, cube)).toBe(false);
  });

  test('returns true when text changed and no category matches', () => {
    const oracleMap = { 'Unknown': 'Some brand new oracle text.' };
    const snap = { isd: { 'Unknown': 'Old oracle text.' } };
    expect(hasUncategorizedChange('Unknown', oracleMap, snap, cube)).toBe(true);
  });
});
