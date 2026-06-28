#!/usr/bin/env node
// fetch-cards.js — run once to generate cards-data.json
// Usage: node fetch-cards.js
//
// Requires Node 18+ (uses native fetch).
// Re-run any time you want to refresh card data or add a new set.

import { writeFile } from 'fs/promises';

const CUBES = {
  isd: { name: 'Innistrad',            setCode: 'isd', specials: [{ q: 'set:isd+layout:checklist', label: 'Checklist' }] },
  ktk: { name: 'Khans of Tarkir',      setCode: 'ktk' },
  neo: { name: 'Neon Dynasty',          setCode: 'neo' },
  dmu: { name: 'Dominaria United',      setCode: 'dmu', specials: [{ code: 'mul', label: 'Multiverse Legends' }] },
  ltr: { name: 'Lord of the Rings',     setCode: 'ltr' },
  blb: { name: 'Bloomburrow',           setCode: 'blb' },
  fdn: { name: 'Foundations',           setCode: 'fdn' },
  inr: { name: 'Innistrad Remastered',  setCode: 'inr' },
  tdm: { name: 'Tarkir: Dragonstorm',   setCode: 'tdm' },
  fin: { name: 'Final Fantasy',         setCode: 'fin', noDFCLands: true },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAllPages(url) {
  const items = [];
  while (url) {
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.data) break;
    items.push(...data.data);
    url = data.has_more ? data.next_page : null;
    if (data.has_more) await sleep(110);
  }
  return items;
}

async function fetchSetCards(setCode, options = {}, specialLabel = null) {
  const { maxCN, noDFCLands } = options;
  const url = `https://api.scryfall.com/cards/search?q=set:${setCode}+not:extra+game:paper+is:booster&order=collector&unique=cards`;
  const raw = await fetchAllPages(url);
  return raw.filter(c => {
    if (c.type_line?.includes('Basic Land')) return false;
    if (maxCN && !isNaN(parseInt(c.collector_number)) && parseInt(c.collector_number) > maxCN) return false;
    if (noDFCLands && c.card_faces?.length > 0) {
      const tl = c.type_line ?? c.card_faces[0]?.type_line ?? '';
      if (tl.includes('Land')) return false;
    }
    return true;
  }).map(c => { if (specialLabel) c._specialLabel = specialLabel; return c; });
}

async function fetchByQuery(q, specialLabel = null) {
  const qStr = (q + '+game:paper').split('+').map(p => encodeURIComponent(p)).join('+');
  const url  = `https://api.scryfall.com/cards/search?q=${qStr}&order=collector&unique=cards`;
  const raw  = await fetchAllPages(url);
  return raw
    .filter(c => !c.type_line?.includes('Basic Land'))
    .map(c => { if (specialLabel) c._specialLabel = specialLabel; return c; });
}

async function fetchTokens(setCode) {
  const url = `https://api.scryfall.com/cards/search?q=set:t${setCode}+game:paper&order=collector&unique=prints`;
  let raw;
  try { raw = await fetchAllPages(url); } catch { return []; }
  const seen = new Set();
  return raw.filter(t => {
    const tl = t.type_line ?? '';
    if (!tl.includes('Token') && !tl.includes('Emblem') && t.layout !== 'checklist' && t.layout !== 'token') return false;
    const key = t.illustration_id ?? t.oracle_id ?? t.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tokenIsFromCube(token, cubeCards, oracleMap) {
  if (token.layout === 'checklist') return true;
  const tl = token.type_line ?? '';
  if (tl.includes('Emblem') || token.name?.toLowerCase().includes('emblem')) {
    const pwName  = (token.name ?? '').replace(/\s*Emblem\s*$/i, '').trim().toLowerCase();
    const pwFirst = pwName.split(/[,\s]/)[0] ?? '';
    const pwMatch = cubeCards.some(c => {
      const oracle = (oracleMap[c.name] ?? '').toLowerCase();
      if (!oracle.includes('emblem')) return false;
      const cn = c.name.toLowerCase();
      return cn === pwName || (pwFirst.length >= 4 && cn.startsWith(pwFirst) && pwName.startsWith(cn.split(/[,\s]/)[0]));
    });
    if (pwMatch) return true;
    const faceName = (token.card_faces?.[0]?.name ?? token.name).toLowerCase();
    return faceName.length >= 3 && cubeCards.some(c => (oracleMap[c.name] ?? '').toLowerCase().includes(faceName));
  }
  const typeMatch = tl.match(/—\s*(.+)/);
  if (!typeMatch) {
    const searchFor = token.name.toLowerCase();
    if (!searchFor) return false;
    return cubeCards.some(c => (oracleMap[c.name] ?? '').toLowerCase().includes(searchFor));
  }
  const types = typeMatch[1].trim().split(/\s+/).map(t => t.toLowerCase()).filter(t => t.length > 2);
  return cubeCards.some(c => {
    const oracle = (oracleMap[c.name] ?? '').toLowerCase();
    if (!oracle.includes('token')) return false;
    return types.some(t => oracle.includes(t));
  });
}

function slimCard(c) {
  const obj = {
    id: c.id, name: c.name, oracle_text: c.oracle_text, type_line: c.type_line,
    rarity: c.rarity, collector_number: c.collector_number, layout: c.layout,
    colors: c.colors, color_identity: c.color_identity,
  };
  if (c.power      !== undefined) obj.power      = c.power;
  if (c.toughness  !== undefined) obj.toughness  = c.toughness;
  if (c._specialLabel)            obj._specialLabel = c._specialLabel;
  if (c.image_uris)               obj.image_uris = { normal: c.image_uris.normal };
  if (c.prices?.usd !== undefined && c.prices.usd !== null)
                                  obj.prices     = { usd: c.prices.usd };
  if (c.purchase_uris?.tcgplayer) obj.purchase_uris = { tcgplayer: c.purchase_uris.tcgplayer };
  if (c.card_faces) obj.card_faces = c.card_faces.map(f => {
    const face = { name: f.name, oracle_text: f.oracle_text, type_line: f.type_line, colors: f.colors };
    if (f.image_uris) face.image_uris = { normal: f.image_uris.normal };
    return face;
  });
  return obj;
}

function slimToken(t) {
  const obj = {
    id: t.id, name: t.name, type_line: t.type_line, layout: t.layout,
    collector_number: t.collector_number,
    illustration_id: t.illustration_id, oracle_id: t.oracle_id,
  };
  if (t.power     !== undefined) obj.power     = t.power;
  if (t.toughness !== undefined) obj.toughness = t.toughness;
  if (t.image_uris) obj.image_uris = { normal: t.image_uris.normal };
  if (t.card_faces) obj.card_faces = t.card_faces.map(f => {
    const face = { name: f.name, type_line: f.type_line };
    if (f.image_uris) face.image_uris = { normal: f.image_uris.normal };
    return face;
  });
  return obj;
}

async function main() {
  const result = { version: new Date().toISOString().slice(0, 10), sets: {} };

  for (const [key, cube] of Object.entries(CUBES)) {
    const code = cube.setCode;
    process.stdout.write(`[${key}] ${cube.name}… `);

    try {
      const [mainCards, tokens] = await Promise.all([
        fetchSetCards(code, { maxCN: cube.maxCN, noDFCLands: cube.noDFCLands }),
        fetchTokens(code),
      ]);

      let allCards = [...mainCards];

      if (cube.specials?.length) {
        const batches = await Promise.all(cube.specials.map(sc => {
          if (typeof sc === 'string') return fetchSetCards(sc);
          if (sc.code) return fetchSetCards(sc.code, {}, sc.label ?? null);
          return fetchByQuery(sc.q, sc.label ?? null);
        }));
        const seen = new Set(mainCards.map(c => c.id));
        for (const batch of batches)
          for (const c of batch)
            if (!seen.has(c.id)) { seen.add(c.id); allCards.push(c); }
      }

      const oracleMap = {};
      for (const c of allCards)
        oracleMap[c.name] = c.oracle_text ?? c.card_faces?.map(f => f.oracle_text || '').join('\n\n──\n\n') ?? '';

      const filteredTokens = tokens.filter(t => tokenIsFromCube(t, allCards, oracleMap));

      result.sets[key] = {
        cards:  allCards.map(slimCard),
        tokens: filteredTokens.map(slimToken),
      };

      console.log(`${allCards.length} cards, ${filteredTokens.length} tokens`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }

    await sleep(600); // be polite to Scryfall between sets
  }

  await writeFile('./cards-data.json', JSON.stringify(result, null, 2));
  console.log('\n✓  cards-data.json written');
}

main().catch(e => { console.error(e); process.exit(1); });
