/**
 * Which hub owns which resource id.
 *
 * With several hubs live at once a command carries only an id, and something has
 * to decide where to send it. Deliberately *not* solved by prefixing ids with
 * the provider: favourites, shortcuts and quick actions all store bare ids in
 * settings.json, and prefixing would invalidate every one of them.
 *
 * That is safe because the id spaces do not overlap in practice — Hue issues
 * UUIDs, Home Assistant uses `light.kitchen`. A collision is still handled
 * rather than assumed away: the later hub wins and the clash is logged, since
 * silently routing a command to the wrong house is worse than a warning.
 */

export interface ResourceSource {
  providerId: string;
  ids: readonly string[];
}

export interface ResourceIndex {
  rebuild(sources: readonly ResourceSource[]): void;
  owner(id: string): string | null;
}

export function createResourceIndex(): ResourceIndex {
  let owners = new Map<string, string>();

  return {
    rebuild(sources) {
      const next = new Map<string, string>();
      for (const source of sources) {
        for (const id of source.ids) {
          const existing = next.get(id);
          if (existing && existing !== source.providerId) {
            console.warn(
              `[providers] resource ${id} is claimed by both ${existing} and ${source.providerId}`,
            );
          }
          next.set(id, source.providerId);
        }
      }
      owners = next;
    },

    owner: (id) => owners.get(id) ?? null,
  };
}
