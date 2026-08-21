import * as RadixSwitch from '@radix-ui/react-switch';

interface PowerSwitchProps {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  label: string;
  disabled?: boolean;
}

export function PowerSwitch({ checked, onCheckedChange, label, disabled }: PowerSwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      // after:-inset-2 grows the hit area to 40x44 without touching layout.
      // ring-offset-2 was dropped: its offset paints white, which reads as a
      // halo on a dark surface.
      className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full bg-line outline-none transition-colors duration-200 after:absolute after:-inset-2 after:content-[''] data-[state=checked]:bg-accent focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-40"
    >
      <RadixSwitch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 will-change-transform data-[state=checked]:translate-x-[22px]" />
    </RadixSwitch.Root>
  );
}
