import { SvgIcon, type SvgIconProps } from "@mui/material";

/**
 * Inline icon set — the artboard ships hand-drawn 24px stroke icons and
 * the project has no icon dependency, so they are kept as SvgIcon
 * wrappers around the same paths.
 */
function makeIcon(path: React.ReactNode, viewBox = "0 0 24 24") {
  return function Icon(props: SvgIconProps) {
    return <SvgIcon viewBox={viewBox} {...props}>{path}</SvgIcon>;
  };
}

export const PlusIcon = makeIcon(
  <path
    d="M12 5v14M5 12h14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
  />,
);

export const SunIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 2.5v2.4m0 14.2v2.4M2.5 12h2.4m14.2 0h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </>,
);

export const MoonIcon = makeIcon(
  <path
    d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
  />,
);

export const ArrowUpIcon = makeIcon(
  <path
    d="M12 19V5m-6 6 6-6 6 6"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
);

export const ArrowDownIcon = makeIcon(
  <path
    d="M12 5v14m-6-6 6 6 6-6"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
);

export const SwapIcon = makeIcon(
  <path
    d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
);

export const HomeIcon = makeIcon(
  <path
    d="M3 12l9-8 9 8M5 10v10h14V10"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
);

export const ListIcon = makeIcon(
  <path
    d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  />,
);

export const ChartIcon = makeIcon(
  <path
    d="M4 19V9m8 10V5m8 14v-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  />,
);

export const WalletIcon = makeIcon(
  <>
    <rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M3 10h18M7 15h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </>,
);

export const TagIcon = makeIcon(
  <>
    <path
      d="M4 4h7l9 9-7 7-9-9z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <circle cx="8.5" cy="8.5" r="1.4" fill="none" stroke="currentColor" strokeWidth="2" />
  </>,
);

export const CoinIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 8v8M9 10.5h4.5a2 2 0 0 1 0 4H9.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </>,
);

export const GearIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2M8 16l-2 2"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </>,
);

export const ChevronLeftIcon = makeIcon(
  <path
    d="M14.5 6l-6 6 6 6"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
);

export const ChevronRightIcon = makeIcon(
  <path
    d="M9.5 6l6 6-6 6"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
);

export const MoreIcon = makeIcon(
  <path
    d="M6 12h.01M12 12h.01M18 12h.01"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
  />,
);

export const ChevronDownIcon = makeIcon(
  <path
    d="M6 9l6 6 6-6"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  />,
);
