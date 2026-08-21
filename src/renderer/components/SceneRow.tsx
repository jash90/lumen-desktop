import type { Scene } from '../../shared/models';
import { useActivateScene } from '../hooks/useHue';

/**
 * Scenes as a row of chips. The bridge ships a handful per room and their names
 * repeat across rooms ("Jasne" exists in every one), so they are always shown
 * under the room they belong to rather than in one flat list.
 */
export function SceneRow({ scenes }: { scenes: Scene[] }) {
  const activate = useActivateScene();

  if (scenes.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {scenes.map((scene) => (
        <button
          key={scene.id}
          type="button"
          onClick={() => activate.mutate(scene.id)}
          aria-pressed={scene.isActive}
          className={`min-h-8 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:focus-ring ${
            scene.isActive
              ? 'border-accent bg-accent/10 text-ink'
              : 'border-line text-ink-muted hover:text-ink'
          }`}
        >
          {scene.name}
        </button>
      ))}
    </div>
  );
}
