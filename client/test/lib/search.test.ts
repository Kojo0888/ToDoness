/** Searching notes (docs/notes/PRD.md FR-103 – FR-105). */
import { describe, expect, it } from 'vitest';
import { matchesSearch, normalize } from '../../src/lib/search';

describe('normalize', () => {
  it('lower-cases and removes accents', () => {
    expect(normalize('Café ÀÉÎÕÜ Łódź')).toBe('cafe aeiou łodz');
  });
});

describe('matchesSearch', () => {
  it('an empty or blank query matches everything', () => {
    expect(matchesSearch('anything', '')).toBe(true);
    expect(matchesSearch('', '   ')).toBe(true);
  });

  it('needs every word, in any order, anywhere', () => {
    expect(matchesSearch('Lunch: café Friday', 'cafe lunch')).toBe(true);
    expect(matchesSearch('Team lunch', 'cafe lunch')).toBe(false);
    expect(matchesSearch('Café menu', 'cafe lunch')).toBe(false);
    expect(matchesSearch('Shopping list\nmilk, EGGS', '  eggs   milk ')).toBe(true);
    expect(matchesSearch('Shopping', 'shop')).toBe(true);
  });

  it('searches several texts together (note text and owner e-mail)', () => {
    expect(matchesSearch(['Plan', 'ann@corp.test'], 'ann plan')).toBe(true);
    expect(matchesSearch(['Plan', 'ann@corp.test'], 'bob')).toBe(false);
  });
});
