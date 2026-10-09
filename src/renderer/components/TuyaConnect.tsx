import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  TUYA_REGIONS,
  type TuyaCloudDeviceSummary,
  type TuyaRegion,
  type TuyaScanResult,
} from '../../shared/ipc';
import { parseTarget } from '../../shared/ipRange';
import { messageOf, unwrap } from '../lib/api';
import { Skeleton } from './Skeleton';

/**
 * Connecting Tuya devices, in the order a person actually gets through it:
 *
 *   1. **Their Tuya account** — optional, but it is what turns "paste a local
 *      key you have never heard of" into one form. The keys stay in the main
 *      process; this screen only ever sees names.
 *   2. **Where the devices are** — broadcasts first, as before, and an address
 *      scan for anything that stays quiet.
 *   3. **Which to connect** — a device needs an address and a key; everything
 *      else is decided by asking the device what it is.
 *
 * The list is additive across all three: a device can come from the cloud, be
 * located by a broadcast and get its key typed in, and still be one row.
 */

interface Row {
  deviceId: string;
  name: string;
  productName?: string;
  address?: string;
  version?: string;
  fromCloud: boolean;
  isLight?: boolean;
  /** Already in the stored hub; connecting it again would only re-save it. */
  connected?: boolean;
}

const inputClass =
  'min-h-9 w-full rounded-row border border-line bg-surface-raised px-3 text-sm outline-none focus:border-accent focus-visible:focus-ring';
const secondaryButton =
  'min-h-9 rounded-row border border-line px-3 text-sm transition-colors hover:bg-line/40 focus-visible:focus-ring disabled:opacity-50';
const linkButton =
  'rounded-row px-1 text-xs text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink-muted focus-visible:focus-ring disabled:opacity-50';

export function TuyaConnect({ onConnected }: { onConnected?: () => void }) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [cloud, setCloud] = useState<TuyaCloudDeviceSummary[]>([]);
  const [scan, setScan] = useState<TuyaScanResult | null>(null);
  const queryClient = useQueryClient();

  const discovery = useQuery({
    queryKey: ['tuyaDiscovery'],
    queryFn: () => unwrap(window.lumen.discoverTuyaDevices()),
    retry: false,
  });

  const typedKeys = Object.entries(keys)
    .map(([deviceId, value]) => ({ deviceId, localKey: value.trim() }))
    .filter((entry) => entry.localKey.length === 16);

  const scanNetwork = useMutation({
    mutationFn: (target: string) =>
      unwrap(
        window.lumen.scanTuyaNetwork({ keys: typedKeys, ...(target ? { target } : {}) }),
      ),
    onSuccess: setScan,
  });

  const rows = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const device of cloud) {
      byId.set(device.deviceId, {
        deviceId: device.deviceId,
        name: device.name,
        productName: device.productName,
        fromCloud: true,
        isLight: device.isLight,
      });
    }
    const locate = (
      deviceId: string,
      address: string,
      version: string,
      extra: { name?: string; connected?: boolean } = {},
    ): void => {
      const row = byId.get(deviceId) ?? {
        deviceId,
        name: extra.name ?? 'Tuya device',
        fromCloud: false,
      };
      byId.set(deviceId, {
        ...row,
        address,
        version,
        ...(extra.connected ? { connected: true } : {}),
      });
    };
    for (const device of discovery.data ?? []) {
      locate(device.deviceId, device.address, device.version, device);
    }
    for (const device of scan?.found ?? []) locate(device.deviceId, device.address, device.version);

    // Located lights first, then whatever still needs something, then what is
    // already connected.
    const rank = (row: Row): number =>
      (row.connected ? 4 : 0) + (row.address ? 0 : 2) + (row.isLight === false ? 1 : 0);
    return [...byId.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [cloud, discovery.data, scan]);

  const hasKey = (row: Row): boolean =>
    row.fromCloud || (keys[row.deviceId] ?? '').trim().length === 16;
  const isSelected = (row: Row): boolean =>
    selected[row.deviceId] ??
    (!row.connected && (row.fromCloud ? row.isLight !== false : hasKey(row)));
  const ready = rows.filter((row) => row.address && hasKey(row) && isSelected(row));
  const missing = rows.filter((row) => !row.address).length;

  const connect = useMutation({
    mutationFn: () =>
      unwrap(
        window.lumen.connectTuya({
          devices: ready.map((row) => {
            const typed = (keys[row.deviceId] ?? '').trim();
            return {
              deviceId: row.deviceId,
              name: row.name,
              address: row.address!,
              ...(typed.length === 16 ? { localKey: typed } : {}),
              ...(row.version ? { version: row.version } : {}),
            };
          }),
        }),
      ),
    onSuccess: (hub) => {
      setKeys({});
      void queryClient.invalidateQueries();
      // Anything that turned out not to be a light is worth saying out loud.
      // Staying open lets the user see why rather than being bounced back.
      if (hub.skipped.length > 0) {
        setSkipped(hub.skipped);
        return;
      }
      onConnected?.();
    },
  });

  const searching = discovery.isFetching || scanNetwork.isPending;

  return (
    <div className="space-y-4">
      <CloudAccount
        devices={cloud}
        onFetched={(devices) => {
          setCloud(devices);
          // With keys in hand the scan can recognise devices, so look for the
          // ones no broadcast has placed without making the user ask.
          setScan(null);
          if (devices.length > 0) scanNetwork.mutate('');
        }}
      />

      <div className="flex items-center justify-between">
        <h2 className="label-caps">Devices</h2>
        <button
          type="button"
          onClick={() => void discovery.refetch()}
          disabled={searching}
          className={linkButton}
        >
          {discovery.isFetching ? 'Listening…' : 'Search again'}
        </button>
      </div>

      {discovery.isFetching && rows.length === 0 && (
        <div className="card-stack divide-y divide-line" aria-busy="true">
          {[0, 1].map((row) => (
            <div key={row} className="space-y-2 px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          ))}
        </div>
      )}

      {!searching && rows.length === 0 && (
        <p className="text-sm text-ink-muted">
          Nothing answered yet. Devices announce themselves every few seconds, so another search
          often finds one the first missed — or scan the network below.
        </p>
      )}

      {rows.length > 0 && (
        <div className="card-stack divide-y divide-line">
          {rows.map((row) => (
            <DeviceRow
              key={row.deviceId}
              row={row}
              checked={isSelected(row)}
              onChecked={(value) => setSelected((current) => ({ ...current, [row.deviceId]: value }))}
              keyValue={keys[row.deviceId] ?? ''}
              onKey={(value) => setKeys((current) => ({ ...current, [row.deviceId]: value }))}
            />
          ))}
        </div>
      )}

      <ScanControls
        pending={scanNetwork.isPending}
        disabled={searching}
        missing={missing}
        result={scan}
        listed={rows.flatMap((row) => (row.address ? [row.address] : []))}
        error={scanNetwork.isError ? messageOf(scanNetwork.error) : null}
        onScan={(target) => scanNetwork.mutate(target)}
      />

      <button
        type="button"
        onClick={() => connect.mutate()}
        disabled={ready.length === 0 || connect.isPending}
        className="min-h-9 w-full rounded-row bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-105 focus-visible:focus-ring disabled:opacity-50"
      >
        {connect.isPending
          ? 'Connecting…'
          : `Connect ${ready.length || ''} ${ready.length === 1 ? 'device' : 'devices'}`.trim()}
      </button>

      {skipped.length > 0 && (
        <div className="rounded-card border-l-4 border-amber-500 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <p className="font-medium">Connected, but not everything is a light</p>
          <ul className="mt-1 space-y-0.5">
            {skipped.map((entry) => (
              <li key={entry.name}>
                {entry.name} — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {connect.isError && (
        <p className="rounded-card border-l-4 border-danger bg-danger/10 px-4 py-3 text-sm text-danger">
          {messageOf(connect.error)}
        </p>
      )}
    </div>
  );
}

function DeviceRow({
  row,
  checked,
  onChecked,
  keyValue,
  onKey,
}: {
  row: Row;
  checked: boolean;
  onChecked(value: boolean): void;
  keyValue: string;
  onKey(value: string): void;
}) {
  const where = row.address
    ? `${row.address}${row.version ? ` · protocol ${row.version}` : ''}${
        row.connected ? ' · already connected' : ''
      }`
    : 'Not found on this network yet';

  return (
    <div className="flex gap-3 px-4 py-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={!row.address}
        onChange={(event) => onChecked(event.target.checked)}
        aria-label={`Connect ${row.name}`}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-sm font-medium">
          {row.name}
          {row.productName ? (
            <span className="font-normal text-ink-muted"> · {row.productName}</span>
          ) : null}
        </span>
        <span className={`block text-xs ${row.address ? 'text-ink-muted' : 'text-amber-600 dark:text-amber-400'}`}>
          {where}
        </span>
        {row.fromCloud ? (
          <span className="block text-xs text-ink-muted">Key from your Tuya account</span>
        ) : (
          <input
            value={keyValue}
            onChange={(event) => onKey(event.target.value)}
            placeholder="local key (16 characters)"
            aria-label={`Local key for ${row.name}`}
            // Masked like the Home Assistant token: it has no more business
            // being readable over someone's shoulder than any other key.
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 min-h-8 w-full rounded-row border border-line bg-surface-raised px-2 font-mono text-xs outline-none focus:border-accent focus-visible:focus-ring"
          />
        )}
      </div>
    </div>
  );
}

function ScanControls({
  pending,
  disabled,
  missing,
  result,
  listed,
  error,
  onScan,
}: {
  pending: boolean;
  disabled: boolean;
  missing: number;
  result: TuyaScanResult | null;
  /** Addresses already in the list, which the scan has nothing new to say about. */
  listed: string[];
  error: string | null;
  onScan(target: string): void;
}) {
  const [target, setTarget] = useState('');
  const invalid = target.trim() !== '' && parseTarget(target) === null;
  const unknown = (result?.unidentified ?? []).filter((address) => !listed.includes(address));

  return (
    <div className="card-stack space-y-2 p-4">
      <p className="text-sm">
        {missing > 0
          ? `${missing} ${missing === 1 ? 'device has' : 'devices have'} not been found yet.`
          : 'Missing a device?'}
        <span className="mt-0.5 block text-xs text-ink-muted">
          Scanning tries every address on this network instead of waiting for devices to announce
          themselves. Leave the field empty for the whole network, or enter one address or a range.
        </span>
      </p>
      <div className="flex gap-2">
        <input
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="192.168.1.40 or 192.168.1.0/24"
          aria-label="Address or range to scan"
          aria-invalid={invalid}
          className={`${inputClass} flex-1 font-mono text-xs`}
        />
        <button
          type="button"
          onClick={() => onScan(target.trim())}
          disabled={disabled || invalid}
          className={secondaryButton}
        >
          {pending ? 'Scanning…' : 'Scan'}
        </button>
      </div>
      {invalid && <p className="text-xs text-danger">Enter an address like 192.168.1.40 or a range.</p>}
      {result && !pending && (
        <p className="text-xs text-ink-muted">
          {result.found.length > 0
            ? `Found ${result.found.length} ${result.found.length === 1 ? 'device' : 'devices'} by address.`
            : unknown.length > 0
              ? ''
              : 'No other devices on this network.'}
          {unknown.length > 0 &&
            ` ${unknown.join(', ')} ${unknown.length === 1 ? 'looks' : 'look'} like a Tuya device but answered to none of the keys — fetch your account to identify ${unknown.length === 1 ? 'it' : 'them'}.`}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function CloudAccount({
  devices,
  onFetched,
}: {
  devices: TuyaCloudDeviceSummary[];
  onFetched(devices: TuyaCloudDeviceSummary[]): void;
}) {
  const [open, setOpen] = useState(true);
  const [region, setRegion] = useState<TuyaRegion>('eu');
  const [accessId, setAccessId] = useState('');
  const [accessSecret, setAccessSecret] = useState('');

  const fetchDevices = useMutation({
    mutationFn: () =>
      unwrap(window.lumen.fetchTuyaCloudDevices({ region, accessId, accessSecret })),
    onSuccess: (result) => {
      // Not kept: it is only needed for this one request.
      setAccessSecret('');
      setOpen(false);
      onFetched(result);
    },
  });

  if (!open) {
    return (
      <div className="card-stack flex items-center gap-3 p-4">
        <span className="min-w-0 flex-1 text-sm">
          {devices.length > 0
            ? `${devices.length} ${devices.length === 1 ? 'device' : 'devices'} from your Tuya account`
            : 'Your Tuya account has no devices yet'}
          <span className="mt-0.5 block text-xs text-ink-muted">
            {devices.length > 0
              ? 'Names and local keys are filled in below.'
              : 'Link your Smart Life app account to the Tuya project, then fetch again.'}
          </span>
        </span>
        <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="card-stack space-y-3 p-4">
      <p className="text-sm font-medium">
        Get local keys from your Tuya account
        <span className="mt-0.5 block text-xs font-normal text-ink-muted">
          Each device encrypts its traffic with a local key that only Tuya&apos;s cloud knows. A free
          Tuya IoT project lets this app read the keys once; after that everything stays on your
          network. You can also skip this and type keys in yourself.
        </span>
      </p>

      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer text-ink">How do I get an Access ID and Secret?</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>
            Sign up at{' '}
            <a href="https://iot.tuya.com" target="_blank" rel="noreferrer" className="underline">
              iot.tuya.com
            </a>{' '}
            and create a Cloud project. Pick the data center your app account uses — Central Europe
            for most of the EU.
          </li>
          <li>Add the IoT Core and Authorization Token Management services to it.</li>
          <li>
            In the project, open Devices → Link App Account and scan the QR code with the Smart Life
            or Tuya Smart app.
          </li>
          <li>Copy the Access ID and Access Secret from the project&apos;s Overview page.</li>
        </ol>
      </details>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          fetchDevices.mutate();
        }}
      >
        <select
          value={region}
          onChange={(event) => setRegion(event.target.value as TuyaRegion)}
          aria-label="Data center"
          className={inputClass}
        >
          {(Object.keys(TUYA_REGIONS) as TuyaRegion[]).map((id) => (
            <option key={id} value={id}>
              {TUYA_REGIONS[id]}
            </option>
          ))}
        </select>
        <input
          value={accessId}
          onChange={(event) => setAccessId(event.target.value)}
          placeholder="Access ID / Client ID"
          aria-label="Access ID"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <input
          value={accessSecret}
          onChange={(event) => setAccessSecret(event.target.value)}
          placeholder="Access Secret / Client Secret"
          aria-label="Access Secret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!accessId.trim() || !accessSecret.trim() || fetchDevices.isPending}
            className={`${secondaryButton} flex-1`}
          >
            {fetchDevices.isPending ? 'Fetching…' : 'Get my devices'}
          </button>
          {devices.length > 0 && (
            <button type="button" onClick={() => setOpen(false)} className={secondaryButton}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {fetchDevices.isError && (
        <p className="rounded-card border-l-4 border-danger bg-danger/10 px-4 py-3 text-sm text-danger">
          {messageOf(fetchDevices.error)}
        </p>
      )}
    </div>
  );
}
