import type { UpdateStatus } from '../../shared/ipc';
import {
  useAppVersion,
  useCheckForUpdates,
  useInstallUpdate,
  useUpdateStatus,
} from '../hooks/useUpdates';
import { useT } from '../i18n';
import type { Translate } from '../../shared/i18n';

/** What the line under the version says, and what the button does. */
function describe(
  status: UpdateStatus | undefined,
  t: Translate,
): {
  detail: string;
  button: string;
  action: 'check' | 'install' | null;
} {
  switch (status?.state) {
    case 'unsupported':
      return {
        detail: t('update.unsupported'),
        button: t('update.check'),
        action: null,
      };
    case 'checking':
      return { detail: t('update.lookingDetail'), button: t('update.checkingButton'), action: null };
    case 'downloading':
      return {
        detail: t('update.downloadingDetail'),
        button: t('update.downloadingButton'),
        action: null,
      };
    case 'ready':
      return {
        detail: t('update.readyDetail', { version: status.version }),
        button: t('update.restartButton'),
        action: 'install',
      };
    case 'available':
      return {
        detail: t('update.availableDetail', { version: status.version }),
        button: t('update.downloadButton', { version: status.version }),
        action: 'install',
      };
    case 'upToDate':
      return {
        detail: t('update.upToDate'),
        button: t('update.check'),
        action: 'check',
      };
    case 'error':
      return { detail: status.message, button: t('common.tryAgain'), action: 'check' };
    default:
      return { detail: '', button: t('update.check'), action: 'check' };
  }
}

export function UpdateCard() {
  const version = useAppVersion();
  const status = useUpdateStatus();
  const check = useCheckForUpdates();
  const install = useInstallUpdate();
  const t = useT();

  const { detail, button, action } = describe(status.data, t);
  const busy = check.isPending || install.isPending;

  return (
    <div className="card-stack flex items-center gap-3 p-4">
      <span className="min-w-0 flex-1 text-sm">
        {t('update.version', { version: version.data ?? '…' })}
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
