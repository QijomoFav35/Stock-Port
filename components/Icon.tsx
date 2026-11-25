import { ICONS, type IconName } from "@/lib/icons";

/** Renders one of the bundled static SVG icons (see lib/icons.ts). */
export default function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <span
      className={`ic ${className}`}
      style={{ width: size, height: size, display: "inline-flex" }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
