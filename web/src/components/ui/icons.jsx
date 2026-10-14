function Icon({
  size = 18,
  children,
  ...rest
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>;
}
export function LogoMark(props) {
  return <Icon {...props}>
      <path d="M12 2.5 20.5 8v8L12 21.5 3.5 16V8Z" />
      <path d="M12 2.5V12M3.5 8 12 12l8.5-4M12 12v9.5" />
    </Icon>;
}
export function PipelineIcon(props) {
  return <Icon {...props}>
      <path d="M3 5h18" />
      <path d="M6 12h12" />
      <path d="M10 19h4" />
    </Icon>;
}
export function LeadsIcon(props) {
  return <Icon {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3.2 2.5-5.5 5.5-5.5s5.5 2.3 5.5 5.5" />
      <path d="M16.5 4.8c1.4.4 2.4 1.7 2.4 3.2s-1 2.8-2.4 3.2" />
      <path d="M19 13.6c1.7.6 3 2.4 3 4.4" />
    </Icon>;
}
export function PersonAddIcon(props) {
  return <Icon {...props}>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" />
      <path d="M18.5 5v6M15.5 8h6" />
    </Icon>;
}
export function SitesIcon(props) {
  return <Icon {...props}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </Icon>;
}
export function CallsIcon(props) {
  return <Icon {...props}>
      <path d="M5 4.5h3.2l1.3 4-2 1.4a11.5 11.5 0 0 0 5.6 5.6l1.4-2 4 1.3V18a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 6.1 1.5 1.5 0 0 1 5 4.5Z" />
    </Icon>;
}
export function TeamIcon(props) {
  return <Icon {...props}>
      <circle cx="8.5" cy="7.5" r="3" />
      <circle cx="16" cy="8.5" r="2.3" />
      <path d="M3 19c0-3 2.5-5.2 5.5-5.2S14 16 14 19" />
      <path d="M15 14.2c2.3.3 4 2.2 4 4.8" />
    </Icon>;
}
export function ReportsIcon(props) {
  return <Icon {...props}>
      <path d="M4 20V10M11 20V4M18 20v-7" />
    </Icon>;
}
export function SettingsIcon(props) {
  // Deliberately short, thick teeth (vs. SunIcon's thin, longer rays) so the
  // two don't read as the same glyph when they sit next to each other, e.g.
  // in the sidebar's account menu (theme toggle vs. profile settings).
  return <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v1.6M12 18.4V20M20 12h-1.6M5.6 12H4M17.3 6.7l-1.1 1.1M7.8 16.2l-1.1 1.1M17.3 17.3l-1.1-1.1M7.8 7.8 6.7 6.7" strokeWidth={2.6} />
    </Icon>;
}
export function SearchIcon(props) {
  return <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20 15.2 15.2" />
    </Icon>;
}
export function RefreshIcon(props) {
  return <Icon {...props}>
      <path d="M20 6.5v5h-5" />
      <path d="M4 17.5v-5h5" />
      <path d="M18.2 10A6.5 6.5 0 0 0 6.7 7.4L4 10" />
      <path d="M5.8 14A6.5 6.5 0 0 0 17.3 16.6L20 14" />
    </Icon>;
}
export function BellIcon(props) {
  return <Icon {...props}>
      <path d="M6 10.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14.5 6 10.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Icon>;
}
export function PlusIcon(props) {
  return <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>;
}
export function ArrowUpIcon(props) {
  return <Icon {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>;
}
export function ArrowDownIcon(props) {
  return <Icon {...props}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Icon>;
}
export function PhoneIcon(props) {
  return <Icon {...props}>
      <path d="M5 4.5h3.2l1.3 4-2 1.4a11.5 11.5 0 0 0 5.6 5.6l1.4-2 4 1.3V18a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 6.1 1.5 1.5 0 0 1 5 4.5Z" />
    </Icon>;
}
export function WhatsAppIcon(props) {
  return <Icon {...props} strokeWidth={1.6}>
      <path d="M4.5 19.5 5.6 15.7A7.9 7.9 0 1 1 8.7 18.4Z" />
      <path d="M9 9.6c0-.5.4-1 1-1s.9.3 1.1.7c.3.6.9 1.7 1 1.9.1.3.1.5-.1.8-.2.3-.3.4-.6.7-.2.2-.4.4-.2.8.2.4 1 1.5 2 2.2 1 .8 1.8 1 2.2 1.1.4.1.6 0 .8-.2.2-.3.7-.9.9-1.2.2-.3.4-.2.7-.1.3.1 1.8.9 2.1 1s.5.2.6.4c.1.2.1 1-.3 1.9-.4.9-2 1.7-2.8 1.8-.7.1-1.5.2-4.9-1.1-3.9-1.6-6.4-5.5-6.6-5.8-.2-.3-1.5-2-1.5-3.7Z" />
    </Icon>;
}
export function TrendIcon(props) {
  return <Icon {...props}>
      <path d="M4 16 9.5 10.5 13.5 14.5 20 8" />
      <path d="M14.5 8h5.5v5.5" />
    </Icon>;
}
export function RupeeIcon(props) {
  return <Icon {...props}>
      <path d="M6 4.5h12M6 9h12M8 4.5c3.5 0 6 1.6 6 4.3S11.5 13 8 13h-.5L15 19.5" />
    </Icon>;
}
export function CloseIcon(props) {
  return <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>;
}
export function MenuIcon(props) {
  return <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>;
}
export function CheckIcon(props) {
  return <Icon {...props}>
      <path d="M4.5 12.5 9 17 19.5 6.5" />
    </Icon>;
}
export function ChevronRightIcon(props) {
  return <Icon {...props}>
      <path d="M9 5.5 15.5 12 9 18.5" />
    </Icon>;
}
export function ArrowRightIcon(props) {
  return <Icon {...props}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </Icon>;
}
export function SunIcon(props) {
  return <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.3M12 19.2v2.3M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </Icon>;
}
export function MoonIcon(props) {
  return <Icon {...props}>
      <path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a7 7 0 0 0 10.2 10.2Z" />
    </Icon>;
}
export function EyeIcon(props) {
  return <Icon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </Icon>;
}
export function PencilIcon(props) {
  return <Icon {...props}>
      <path d="M4 20l.9-4.2L15.6 5.1a1.8 1.8 0 0 1 2.5 0l1.8 1.8a1.8 1.8 0 0 1 0 2.5L9.2 20.1 4 20Z" />
      <path d="M13.8 6.9l3.3 3.3" />
    </Icon>;
}
export function TrashIcon(props) {
  return <Icon {...props}>
      <path d="M4.5 7h15M9.5 7V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7M18 7l-.7 12a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6 7" />
      <path d="M10 11v6M14 11v6" />
    </Icon>;
}
export function NoteIcon(props) {
  return <Icon {...props}>
      <path d="M5 4.5h14v11L15 19.5H5Z" />
      <path d="M8.5 9h7M8.5 12.5h4.5" />
    </Icon>;
}
export function FileTextIcon(props) {
  return <Icon {...props}>
      <path d="M7 3.5h7l4 4V20.5H7Z" />
      <path d="M10.5 10.5h5M10.5 13.5h5M10.5 16.5h3" />
    </Icon>;
}
export function PaperclipIcon(props) {
  return <Icon {...props}>
      <path d="M8.5 8.5v6.2a3.2 3.2 0 0 0 6.4 0V7.1a2.4 2.4 0 0 0-4.8 0v8.1a1.4 1.4 0 0 0 2.8 0V8.5" />
    </Icon>;
}
export function CalendarIcon(props) {
  return <Icon {...props}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </Icon>;
}
export function DownloadIcon(props) {
  return <Icon {...props}>
      <path d="M12 3.5v11M7.5 10 12 14.5 16.5 10" />
      <path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </Icon>;
}
export function AlertTriangleIcon(props) {
  return <Icon {...props}>
      <path d="M10.6 4.3 2.9 18a1.7 1.7 0 0 0 1.5 2.5h15.2a1.7 1.7 0 0 0 1.5-2.5L13.4 4.3a1.7 1.7 0 0 0-2.8 0Z" />
      <path d="M12 9.5v4M12 16.8v.2" />
    </Icon>;
}
export function InfoIcon(props) {
  return <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </Icon>;
}
export function ArrowDownLeftIcon(props) {
  return <Icon {...props}>
      <path d="M17 7 7 17M7 9v8h8" />
    </Icon>;
}
export function ArrowUpRightIcon(props) {
  return <Icon {...props}>
      <path d="M7 17 17 7M9 7h8v8" />
    </Icon>;
}
export function SendIcon(props) {
  return <Icon {...props}>
      <path d="M4.5 12 20 4.5 12.8 20l-2-6.8-6.3-1.2Z" />
      <path d="M11 13.2 20 4.5" />
    </Icon>;
}
export function LogOutIcon(props) {
  return <Icon {...props}>
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M16 16.5 20.5 12 16 7.5" />
      <path d="M20.5 12h-11" />
    </Icon>;
}
export function InboxIcon(props) {
  return <Icon {...props}>
      <path d="M4 12.5 6.2 5h11.6l2.2 7.5" />
      <path d="M4 12.5h5l1.3 2.5h3.4l1.3-2.5h5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-5.5Z" />
    </Icon>;
}
export function ClockIcon(props) {
  return <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </Icon>;
}
export function LocationPinIcon(props) {
  return <Icon {...props}>
      <path d="M12 21.5s7-6.4 7-12A7 7 0 0 0 5 9.5c0 5.6 7 12 7 12Z" />
      <circle cx="12" cy="9.3" r="2.4" />
    </Icon>;
}
export function UnitIcon(props) {
  return <Icon {...props}>
      <circle cx="8" cy="8" r="2.5" />
      <circle cx="16" cy="8" r="2.5" />
      <circle cx="12" cy="16" r="2.5" />
      <path d="M9.8 9.4 11 13.6M14.2 9.4 13 13.6M10.2 16h3.6" />
    </Icon>;
}
export function BuildingIcon(props) {
  return <Icon {...props}>
      <path d="M5.5 20.5V7.5A1.5 1.5 0 0 1 7 6h7a1.5 1.5 0 0 1 1.5 1.5v13" />
      <path d="M15.5 10.5H18a1.5 1.5 0 0 1 1.5 1.5v8.5" />
      <path d="M8.5 10h3.5M8.5 13.5h3.5M8.5 17h3.5M4 20.5h17" />
    </Icon>;
}
export function CountryIcon(props) {
  return <Icon {...props}>
      <path d="M6 21V4.5" />
      <path d="M6 5.5c3.8-2 6.2 2 10 0v9c-3.8 2-6.2-2-10 0Z" />
    </Icon>;
}
export function SiteColumnsIcon(props) {
  return <Icon {...props}>
      <path d="M4 9.5 12 5l8 4.5Z" />
      <path d="M6 10v8M10 10v8M14 10v8M18 10v8" />
      <path d="M4.5 18.5h15M3.5 21h17" />
    </Icon>;
}
export function CompanyIcon(props) {
  return <Icon {...props}>
      <path d="M4.5 20.5v-12L12 4l7.5 4.5v12" />
      <path d="M8 20.5V13h8v7.5M8 9.5h.1M12 9.5h.1M16 9.5h.1" />
      <path d="M10.5 16.5h3" />
    </Icon>;
}
export function CoffeeIcon(props) {
  return <Icon {...props}>
      <path d="M5 9h12v5a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 5 14V9Z" />
      <path d="M17 10.2h1.3a2.3 2.3 0 0 1 0 4.6H17" />
      <path d="M8 5.5c0 .8-.9 1-.9 2M11.5 5.5c0 .8-.9 1-.9 2" />
    </Icon>;
}
export function ShieldAlertIcon(props) {
  return <Icon {...props}>
      <path d="M12 3 19 6v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6Z" />
      <path d="M12 8.3v4M12 15.5v.2" />
    </Icon>;
}
export function LogInIcon(props) {
  return <Icon {...props}>
      <path d="M15 20h3.5A1.5 1.5 0 0 0 20 18.5v-13A1.5 1.5 0 0 0 18.5 4H15" />
      <path d="M8 7.5 3.5 12 8 16.5" />
      <path d="M3.5 12h11" />
    </Icon>;
}
export function InstagramIcon(props) {
  return <Icon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
    </Icon>;
}
export function LinkedinIcon(props) {
  return <Icon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <circle cx="8" cy="8.3" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8 11v6M12 17v-3.5c0-1.4 1-2.5 2.2-2.5s2 1.1 2 2.5V17M12 11v.3" />
    </Icon>;
}
export function FormIcon(props) {
  return <Icon {...props}>
      <path d="M6 3.5h9l3 3V20.5H6Z" />
      <path d="M9 10.5h6M9 13.5h6M9 16.5h4" />
    </Icon>;
}
export function ChannelsIcon(props) {
  return <Icon {...props}>
      <circle cx="6" cy="6.5" r="2.3" />
      <circle cx="6" cy="17.5" r="2.3" />
      <circle cx="18" cy="12" r="2.3" />
      <path d="M8 7.3 15.8 11M8 16.7 15.8 13" />
    </Icon>;
}
export function DeviceIcon(props) {
  return <Icon {...props}>
      <rect x="3.5" y="5" width="13" height="10" rx="1.5" />
      <path d="M8 18.5h6" />
      <path d="M18.5 8.5h2v8h-2Z" />
    </Icon>;
}
export function MicIcon(props) {
  return <Icon {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3.5M9 20.5h6" />
    </Icon>;
}
export function UploadIcon(props) {
  return <Icon {...props}>
      <path d="M12 20.5v-11M7.5 14 12 9.5 16.5 14" />
      <path d="M4.5 17v2A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </Icon>;
}
export function DuplicateIcon(props) {
  return <Icon {...props}>
      <rect x="4" y="4" width="12" height="12" rx="1.8" />
      <path d="M8.5 20h9.8A1.7 1.7 0 0 0 20 18.3V8.5" />
    </Icon>;
}
export function GaugeIcon(props) {
  return <Icon {...props}>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="M12 15 15.5 10" />
      <path d="M12 15v.1" />
    </Icon>;
}
export function PlayIcon(props) {
  return <Icon {...props} strokeLinejoin="round">
      <path d="M6.5 4.5v15l13-7.5Z" />
    </Icon>;
}
export function PauseIcon(props) {
  return <Icon {...props}>
      <path d="M7.5 5v14M16.5 5v14" />
    </Icon>;
}
export function StopIcon(props) {
  return <Icon {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </Icon>;
}
export function SkipForwardIcon(props) {
  return <Icon {...props} strokeLinejoin="round">
      <path d="M6 5v14l10-7Z" />
      <path d="M17.5 5v14" />
    </Icon>;
}
export function TrophyIcon(props) {
  return <Icon {...props}>
      <path d="M8 4.5h8v5a4 4 0 0 1-8 0Z" />
      <path d="M8 5.5H5.5a2 2 0 0 0 0 4H8M16 5.5h2.5a2 2 0 0 1 0 4H16" />
      <path d="M12 13.5v3M9 20.5h6M9.5 20.5c0-2 1-3.5 2.5-3.5s2.5 1.5 2.5 3.5" />
    </Icon>;
}
export function VideoIcon(props) {
  return <Icon {...props}>
      <rect x="3.5" y="6.5" width="12" height="11" rx="1.8" />
      <path d="M15.5 10.5 20.5 7.5v9l-5-3Z" />
    </Icon>;
}
export function LinkIcon(props) {
  return <Icon {...props}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M11 7.5 13 5.5a3 3 0 0 1 4.2 4.2l-2 2M13 16.5l-2 2a3 3 0 0 1-4.2-4.2l2-2" />
    </Icon>;
}
export function HistoryIcon(props) {
  return <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4.5h4.5" />
      <path d="M12 8v4.5l3 2" />
    </Icon>;
}
export function DialerIcon(props) {
  return <Icon {...props}>
      <circle cx="7" cy="7" r="1.4" />
      <circle cx="12" cy="7" r="1.4" />
      <circle cx="17" cy="7" r="1.4" />
      <circle cx="7" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="17" cy="12" r="1.4" />
      <path d="M9 20.5h6M12 16.5v4" />
      <path d="M9.5 16.5a2.5 2.5 0 0 1 5 0" />
    </Icon>;
}

export function VolumeIcon(props) {
  return (
    <Icon {...props}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Icon>
  );
}

export function VolumeMuteIcon(props) {
  return (
    <Icon {...props}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </Icon>
  );
}

export function RefreshCwIcon(props) {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </Icon>
  );
}

export function CopyIcon(props) {
  return (
    <Icon {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Icon>
  );
}

export function FollowUpIcon(props) {
  return (
    <Icon {...props}>
      <path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <circle cx="17" cy="17" r="4" />
      <path d="M17 15v2l1.5 1" />
    </Icon>
  );
}

export function SparklesIcon(props) {
  return (
    <Icon {...props}>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </Icon>
  );
}

export function ChevronDownIcon(props) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ChevronUpIcon(props) {
  return (
    <Icon {...props}>
      <path d="m18 15-6-6-6 6" />
    </Icon>
  );
}

export function MailIcon(props) {
  return (
    <Icon {...props}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Icon>
  );
}


export function BrainIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M12 5v13" />
    </Icon>
  );
}

export function XIcon(props) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  );
}

export function MicOffIcon(props) {
  return (
    <Icon {...props}>
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 5" />
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </Icon>
  );
}export function CheckSingleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function CheckDoubleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </Icon>
  );
}

export function TemplateIcon(props) {
  return (
    <Icon {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </Icon>
  );
}

export function MoreVerticalIcon(props) {
  return <Icon {...props}>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </Icon>;
}
export function FilterIcon(props) {
  return <Icon {...props}>
      <path d="M3 5h18l-7 8v6l-4-2v-4Z" />
    </Icon>;
}
export function DashboardIcon(props) {
  return <Icon {...props}>
      <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" />
      <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
    </Icon>;
}
export function ArchiveIcon(props) {
  return <Icon {...props}>
      <rect x="3" y="4" width="18" height="4.5" rx="1" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4" />
    </Icon>;
}
export function LockIcon(props) {
  return <Icon {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Icon>;
}
