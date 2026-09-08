/* 16px stroke icons, drawn inline so there is no icon dependency and they
   inherit currentColor everywhere. */

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

const make = (paths) => (props) => (
  <svg {...base} {...props}>{paths}</svg>
)

export const IconToday = make(<><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></>)
export const IconTimeline = make(<><path d="M2 4h9M2 8h6M2 12h11" /><circle cx="13" cy="4" r="1.2" /><circle cx="10" cy="8" r="1.2" /></>)
export const IconChart = make(<><path d="M2 13.5h12" /><path d="M4 13V8M7.5 13V4M11 13v-3" /></>)
export const IconLibrary = make(<><path d="M3 2.5h5l1.5 2H13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" /></>)
export const IconSettings = make(<><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" /></>)
export const IconSearch = make(<><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>)
export const IconPlus = make(<path d="M8 3v10M3 8h10" />)
export const IconClose = make(<path d="m4 4 8 8M12 4l-8 8" />)
export const IconCheck = make(<path d="m3.5 8.5 3 3 6-7" />)
export const IconDash = make(<path d="M4 8h8" />)
export const IconChevron = make(<path d="m6 4 4 4-4 4" />)
export const IconUp = make(<path d="m4 10 4-4 4 4" />)
export const IconDown = make(<path d="m4 6 4 4 4-4" />)
export const IconBell = make(<><path d="M8 2a4 4 0 0 0-4 4c0 3-1 4-1 4h10s-1-1-1-4a4 4 0 0 0-4-4Z" /><path d="M6.5 12.5a1.6 1.6 0 0 0 3 0" /></>)
export const IconUpload = make(<><path d="M8 10.5V2.5M5 5.5 8 2.5l3 3" /><path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" /></>)
export const IconDoc = make(<><path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5L9 1.5Z" /><path d="M9 1.5v4h4" /></>)
export const IconFlag = make(<><path d="M4 14V2.5h8l-2 3 2 3H4" /></>)
export const IconAlert = make(<><path d="M8 2.5 14.5 13.5h-13L8 2.5Z" /><path d="M8 6.5v3M8 11.6v.01" /></>)
export const IconUsers = make(<><circle cx="6" cy="6" r="2.3" /><path d="M2 13.5c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" /><path d="M10.5 4.2a2.3 2.3 0 0 1 0 4M11.5 10.3c1.6.4 2.5 1.6 2.5 3.2" /></>)
export const IconClock = make(<><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>)
export const IconTrash = make(<><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9" /></>)
export const IconGrid = make(<><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></>)
export const IconSpark = make(<><path d="M8 1.5 9.6 6l4.4 1.6L9.6 9.2 8 13.6 6.4 9.2 2 7.6 6.4 6 8 1.5Z" /></>)
export const IconCommand = make(<><path d="M5.5 2.5a1.5 1.5 0 1 0 1.5 1.5v8a1.5 1.5 0 1 0 1.5-1.5H4a1.5 1.5 0 1 0 1.5 1.5V4A1.5 1.5 0 1 0 4 5.5h8" /></>)

export const STATUS_ICON = {
  good: IconCheck,
  warning: IconAlert,
  serious: IconAlert,
  critical: IconAlert,
  info: IconSpark,
}
