import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DICTIONARIES,
  type Message,
  resolveLocale,
  setLocale,
  t,
  translate,
} from '../src/shared/i18n';
import { userMessageFor } from '../src/shared/errors';

const placeholders = (message: Message): string[] => {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const names = texts.flatMap((text) =>
    [...(text ?? '').matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? ''),
  );
  return [...new Set(names)].sort();
};

describe('dictionaries', () => {
  const en = DICTIONARIES.en as Record<string, Message>;
  const pl = DICTIONARIES.pl as Record<string, Message>;

  it('have exactly the same keys', () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
  });

  it('agree on placeholders and on which keys are plurals', () => {
    for (const key of Object.keys(en)) {
      const source = en[key]!;
      const target = pl[key]!;
      expect(typeof target, key).toBe(typeof source);
      // `count` may be implied by a plural form ("1 light"), so it is not compared.
      const withoutCount = (names: string[]) => names.filter((name) => name !== 'count');
      expect(withoutCount(placeholders(target)), key).toEqual(withoutCount(placeholders(source)));
    }
  });

  it('give every Polish plural all three forms', () => {
    for (const [key, message] of Object.entries(pl)) {
      if (typeof message === 'string') continue;
      expect(Object.keys(message).sort(), key).toEqual(['few', 'many', 'one', 'other']);
    }
  });

  it('leave no empty translation', () => {
    for (const [key, message] of Object.entries(pl)) {
      for (const text of typeof message === 'string' ? [message] : Object.values(message)) {
        expect(text?.trim(), key).not.toBe('');
      }
    }
  });
});

describe('resolveLocale', () => {
  it('picks Polish for any Polish region', () => {
    expect(resolveLocale(['pl-PL'])).toBe('pl');
    expect(resolveLocale(['pl'])).toBe('pl');
    expect(resolveLocale(['pl_PL'])).toBe('pl');
  });

  it('takes the first language it supports', () => {
    expect(resolveLocale(['en-GB', 'pl-PL'])).toBe('en');
    expect(resolveLocale(['de-DE', 'pl-PL'])).toBe('pl');
  });

  it('falls back to English', () => {
    expect(resolveLocale([])).toBe('en');
    expect(resolveLocale(['de-DE', 'fr'])).toBe('en');
    expect(resolveLocale([undefined, null, ''])).toBe('en');
  });
});

describe('translate', () => {
  afterEach(() => setLocale('en'));

  it('fills in placeholders', () => {
    expect(translate('en', 'tray.open', { product: 'Lumen Desktop' })).toBe('Open Lumen Desktop');
    expect(translate('pl', 'tray.open', { product: 'Lumen Desktop' })).toBe('Otwórz Lumen Desktop');
  });

  it('chooses English plural forms', () => {
    expect(translate('en', 'tuya.connectCount', { count: 1 })).toBe('Connect 1 device');
    expect(translate('en', 'tuya.connectCount', { count: 3 })).toBe('Connect 3 devices');
  });

  it.each([
    [1, 'Połącz 1 urządzenie'],
    [2, 'Połącz 2 urządzenia'],
    [5, 'Połącz 5 urządzeń'],
    [12, 'Połącz 12 urządzeń'],
    [22, 'Połącz 22 urządzenia'],
    [25, 'Połącz 25 urządzeń'],
  ])('chooses the Polish form for %i', (count, expected) => {
    expect(translate('pl', 'tuya.connectCount', { count })).toBe(expected);
  });

  it('follows the process locale in t() and in error messages', () => {
    expect(t('nav.settings')).toBe('Settings');
    expect(userMessageFor('NetworkError')).toMatch(/^Network problem/);
    setLocale('pl');
    expect(t('nav.settings')).toBe('Ustawienia');
    expect(userMessageFor('NetworkError')).toMatch(/^Problem z siecią/);
  });
});

/** `"key" = "value";` pairs of an Apple .strings file — comments stripped. */
function stringsKeys(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*=/gm)].map((match) => match[1]!).sort();
}

describe('widget localizations', () => {
  const root = path.join(__dirname, '..', 'widget', 'Localization');
  const languages = readdirSync(root).filter((entry) => entry.endsWith('.lproj')).sort();

  it('ship English and Polish', () => {
    expect(languages).toEqual(['en.lproj', 'pl.lproj']);
  });

  it.each(['Localizable.strings', 'InfoPlist.strings'])('%s has the same keys in both', (name) => {
    const [en, pl] = languages.map((lproj) => stringsKeys(path.join(root, lproj, name)));
    expect(en!.length).toBeGreaterThan(0);
    expect(pl).toEqual(en);
  });

  it('covers every string literal the widget views look up', () => {
    const swift = readFileSync(path.join(__dirname, '..', 'widget', 'LumenWidget.swift'), 'utf8');
    const literals = [
      ...swift.matchAll(/(?:Text|description|title:|LocalizedStringResource =)\s*\(?"([^"\\]+)"/g),
    ]
      .map((match) => match[1]!)
      // Interpolated text maps to a %lld key, and the stringsdict covers lights_on.
      .filter((literal) => !literal.includes('\\(') && !literal.startsWith('lights_on'));
    expect(literals.length).toBeGreaterThanOrEqual(8);
    const known = stringsKeys(path.join(root, 'en.lproj', 'Localizable.strings'));
    for (const literal of literals) expect(known, literal).toContain(literal);
  });

  it('gives the Polish plural all three forms', () => {
    const plist = readFileSync(path.join(root, 'pl.lproj', 'Localizable.stringsdict'), 'utf8');
    for (const form of ['one', 'few', 'many', 'other']) {
      expect(plist).toContain(`<key>${form}</key>`);
    }
  });
});
