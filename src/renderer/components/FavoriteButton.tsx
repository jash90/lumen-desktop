import type { ResourceRef } from '../../shared/models';
import { isFavorite, useFavorites, useToggleFavorite } from '../hooks/useHue';

/** Pin toggle shown on rooms, lights and scenes. */
export function FavoriteButton({ target, label }: { target: ResourceRef; label: string }) {
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const pinned = isFavorite(favorites, target);

  return (
    <button
      type="button"
      onClick={() => toggle(target)}
      aria-pressed={pinned}
      aria-label={pinned ? `Usuń ${label} z ulubionych` : `Dodaj ${label} do ulubionych`}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm transition-colors focus-visible:focus-ring ${
        pinned ? 'text-accent' : 'text-ink-muted opacity-0 group-hover/row:opacity-100 focus:opacity-100'
      }`}
    >
      {pinned ? '★' : '☆'}
    </button>
  );
}
