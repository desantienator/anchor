import { describe, expect, it } from 'vitest';
import { acceptedTagIds } from './ai-parser';

// Small models answer a tag prompt in several ways. Only exact ids used to
// survive, which silently produced "no tags" for everything else.
const vocabulary = [
  { id: 'id-home', name: 'Home' },
  { id: 'id-work', name: 'Work' },
  { id: 'id-travel', name: 'Travel' },
];

describe('acceptedTagIds', () => {
  it('keeps ids the person owns', () => {
    expect(acceptedTagIds({ tagIds: ['id-home'] }, vocabulary)).toEqual([
      'id-home',
    ]);
  });

  it('resolves tag names, which models often echo instead of ids', () => {
    expect(acceptedTagIds({ tagIds: ['Home', 'Work'] }, vocabulary)).toEqual([
      'id-home',
      'id-work',
    ]);
  });

  it('matches names regardless of case and surrounding space', () => {
    expect(
      acceptedTagIds({ tagIds: [' home ', 'TRAVEL'] }, vocabulary),
    ).toEqual(['id-home', 'id-travel']);
  });

  it('accepts objects carrying an id or a name', () => {
    expect(
      acceptedTagIds(
        { tagIds: [{ id: 'id-work' }, { name: 'Travel' }] },
        vocabulary,
      ),
    ).toEqual(['id-work', 'id-travel']);
  });

  it('drops tags the person does not have', () => {
    expect(
      acceptedTagIds({ tagIds: ['Invoices', 'nonsense'] }, vocabulary),
    ).toEqual([]);
  });

  it('de-duplicates a tag named and identified at once', () => {
    expect(acceptedTagIds({ tagIds: ['Home', 'id-home'] }, vocabulary)).toEqual(
      ['id-home'],
    );
  });

  it('caps the number of suggestions', () => {
    expect(
      acceptedTagIds(
        { tagIds: ['Home', 'Work', 'Travel', 'Home'] },
        vocabulary,
      ),
    ).toHaveLength(3);
  });

  it('rejects a wrong shape without throwing', () => {
    expect(acceptedTagIds({ tags: ['Home'] }, vocabulary)).toEqual([]);
    expect(acceptedTagIds({ tagIds: 'Home' }, vocabulary)).toEqual([]);
  });

  it('still works with only the allowed id set', () => {
    expect(
      acceptedTagIds({ tagIds: ['id-home'] }, new Set(['id-home'])),
    ).toEqual(['id-home']);
  });
});
