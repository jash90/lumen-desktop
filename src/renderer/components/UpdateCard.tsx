import type { UpdateStatus } from '../../shared/ipc';
import {
  useAppVersion,
  useCheckForUpdates,
  useInstallUpdate,
  useUpdateStatus,
} from '../hooks/useUpdates';

/** What the line under the version says, and what the button does. */
function describe(status: UpdateStatus | undefined): {
  detail: string;
  button: string;
  action: 'check' | 'install' | null;
} {
  switch (status?.state) {
    case 'unsupported':
      return {
        detail: 'Updates are available only in the installed app.',
        button: 'Check for updates',
        action: null,
      };
    case 'checking':
      return { detail: 'Looking for a newer version…', button: 'Checking…', action: null };
    case 'downloading':
      return {
        detail: 'A new version was found and is downloading.',
        button: 'Downloading…',
        action: null,
      };
    case 'ready':
      return {
        detail: `Version ${status.version} is ready to install.`,
        button: 'Restart to update',
        action: 'install',
      };
    case 'available':
      return {
        detail: `Version ${status.version} is available on the releases page.`,
        button: `Download ${status.version}`,
        action: 'install',
      };
    case 'upToDate':
      return {
        detail: 'You have the latest version.',
        button: 'Check for updates',
        action: 'check',
      };
    case 'error':
      return { detail: status.message, button: 'Try again', action: 'check' };
    default:
      return { detail: '', button: 'Check for updates', action: 'check' };
  }
}

export function UpdateCard() {
  const version = useAppVersion();
  const status = useUpdateStatus();
  const check = useCheckForUpdates();
  const install = useInstallUpdate();

  const { detail, button, action } = describe(status.data);
  const busy = check.isPending || install.isPending;

  return (
    <div className="card-stack flex items-center gap-3 p-4">
      <span className="min-w-0 flex-1 text-sm">
        Version {version.data ?? '…'}
        {detail && (
          <span
            role="status"
            className={`mt-0.5 block text-xs ${
              status.data?.state === 'error' ? 'text-danger' : 'text-ink-muted'
            }`}
          >
            {detail}
          </span>
        )}
      </span>
      <button
        type="button"
        disabled={action === null || busy}
        onClick={() => (action === 'install' ? install.mutate() : check.mutate())}
        className={`min-h-9 shrink-0 rounded-row border px-4 text-sm transition-colors focus-visible:focus-ring disabled:cursor-default disabled:opacity-50 ${
          action === 'install'
            ? 'border-accent bg-accent/10 font-medium hover:bg-accent/20'
            : 'border-line hover:bg-line/40'
        }`}
      >
        {button}
      </button>
    </div>
  );
}
