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

export const IconMic = make(<><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2M5.5 14.5h5" /></>)
export const IconSend = make(<><path d="M2.5 8 13.5 2.5 9.5 13.5 8 8.8 2.5 8Z" /><path d="M8 8.8 13.5 2.5" /></>)
export const IconStop = make(<rect x="4" y="4" width="8" height="8" rx="1.5" />)
export const IconPlay = make(<path d="M5.5 3.2 12 8l-6.5 4.8V3.2Z" />)

/* ------------------------------------------------------------------ media */

export const IconPause = make(<><rect x="4.5" y="3.5" width="2.5" height="9" rx="1" /><rect x="9" y="3.5" width="2.5" height="9" rx="1" /></>)
export const IconPrev = make(<><path d="M12.5 3.5 6.5 8l6 4.5v-9Z" /><path d="M4 3.5v9" /></>)
export const IconNext = make(<><path d="M3.5 3.5 9.5 8l-6 4.5v-9Z" /><path d="M12 3.5v9" /></>)
export const IconShuffle = make(<><path d="M2.5 4h2.2l6.6 8h2.2M2.5 12h2.2l2.3-2.8M9.4 6.3 11.3 4h2.2" /><path d="m12 2.5 1.9 1.5L12 5.5M12 10.5l1.9 1.5-1.9 1.5" /></>)
export const IconRepeat = make(<><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h6.2" /><path d="m10 2.3 2 1.7-2 1.7" /><path d="M13 9.5a2.5 2.5 0 0 1-2.5 2.5H4.3" /><path d="m6 13.7-2-1.7 2-1.7" /></>)
export const IconRepeatOne = make(<><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h6.2" /><path d="m10 2.3 2 1.7-2 1.7" /><path d="M13 9.5a2.5 2.5 0 0 1-2.5 2.5H4.3" /><path d="m6 13.7-2-1.7 2-1.7" /><path d="M7.6 6.6 8.6 6v4" /></>)
export const IconVolume = make(<><path d="M2.5 6v4h2.3L8 12.8V3.2L4.8 6H2.5Z" /><path d="M10.4 5.8a3 3 0 0 1 0 4.4M12.2 4a5.5 5.5 0 0 1 0 8" /></>)
export const IconMute = make(<><path d="M2.5 6v4h2.3L8 12.8V3.2L4.8 6H2.5Z" /><path d="m10.5 6.5 3 3M13.5 6.5l-3 3" /></>)
export const IconCamera = make(<><path d="M2 5.5h2.6L6 3.5h4l1.4 2H14v7.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V5.5Z" /><circle cx="8" cy="9" r="2.4" /></>)
export const IconVideo = make(<><rect x="1.5" y="4" width="9" height="8" rx="1.5" /><path d="m10.5 8.2 4-2.2v4.4l-4-2.2Z" /></>)
export const IconMusic = make(<><path d="M6 12V3.6l7-1.4v8.3" /><circle cx="4.3" cy="12" r="1.8" /><circle cx="11.3" cy="10.5" r="1.8" /></>)
export const IconYouTube = make(<><rect x="1.5" y="3.5" width="13" height="9" rx="3" /><path d="m6.8 6.3 3.4 1.9-3.4 1.9V6.3Z" /></>)
export const IconCompress = make(<><path d="M6.5 2.5v3h-3M9.5 13.5v-3h3" /><path d="m2.8 2.8 3.7 2.7M13.2 13.2 9.5 10.5" /><path d="M13.5 6.5h-3v-3M2.5 9.5h3v3" /><path d="m13.2 2.8-2.7 3.7M2.8 13.2l2.7-3.7" /></>)
export const IconDownload = make(<><path d="M8 2.5v8M5 7.5 8 10.5l3-3" /><path d="M2.5 11v2.5h11V11" /></>)
/* ------------------------------------------------------------------ stash */

export const IconStar = make(<path d="M8 1.8 9.9 5.9l4.5.6-3.3 3.1.8 4.4L8 11.9l-3.9 2.1.8-4.4L1.6 6.5l4.5-.6L8 1.8Z" />)
export const IconEye = make(<><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2.1" /></>)
export const IconArchive = make(<><rect x="1.8" y="2.8" width="12.4" height="3" rx="1" /><path d="M3 5.8v6.4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.8" /><path d="M6.3 8.4h3.4" /></>)
export const IconRefresh = make(<><path d="M13.2 7a5.2 5.2 0 0 0-9.1-2.4L2.8 6" /><path d="M2.8 2.9V6h3.1" /><path d="M2.8 9a5.2 5.2 0 0 0 9.1 2.4L13.2 10" /><path d="M13.2 13.1V10h-3.1" /></>)
export const IconInbox = make(<><path d="M1.8 8.6 3.4 3.2a1 1 0 0 1 1-.7h7.2a1 1 0 0 1 1 .7l1.6 5.4" /><path d="M1.8 8.6v3.6a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1V8.6h-3.6a2.4 2.4 0 0 1-4.8 0H1.8Z" /></>)
export const IconBulb = make(<><path d="M8 1.8a4 4 0 0 0-2.4 7.2c.5.4.8 1 .8 1.6v.4h3.2v-.4c0-.6.3-1.2.8-1.6A4 4 0 0 0 8 1.8Z" /><path d="M6.6 13.2h2.8M7 14.5h2" /></>)
export const IconGlobe = make(<><circle cx="8" cy="8" r="6.2" /><path d="M1.8 8h12.4" /><path d="M8 1.8a9.5 9.5 0 0 1 0 12.4A9.5 9.5 0 0 1 8 1.8Z" /></>)

export const IconImage = make(<><rect x="1.8" y="3" width="12.4" height="10" rx="1.5" /><circle cx="5.6" cy="6.4" r="1.1" /><path d="m2.4 11.4 3.4-3.2 2.6 2.4 2.3-2 3 2.8" /></>)
export const IconPulse = make(<path d="M1.5 8.5h3l2-5 3 9 2-6 1.2 2h1.8" />)
export const IconMap = make(<><circle cx="3" cy="8" r="1.8" /><circle cx="13" cy="3.5" r="1.8" /><circle cx="13" cy="12.5" r="1.8" /><path d="M4.7 7.3 11.3 4.2M4.7 8.7l6.6 3.1" /></>)
export const IconSpeaker = make(<><path d="M2.5 6v4h2.5L9 13V3L5 6H2.5Z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" /></>)
export const IconBrain = make(<><path d="M6.5 2.5a2 2 0 0 0-2 2v.6A2.3 2.3 0 0 0 3 7.3a2.3 2.3 0 0 0 .6 3.4A2.2 2.2 0 0 0 6.5 13.5h1.5v-11h-1.5Z" /><path d="M9.5 2.5a2 2 0 0 1 2 2v.6a2.3 2.3 0 0 1 1.5 2.2 2.3 2.3 0 0 1-.6 3.4 2.2 2.2 0 0 1-2.9 2.8H8v-11h1.5Z" /><path d="M5.5 6.5h2M8.5 9.5h2" /></>)
export const IconLink = make(<><path d="M6.5 9.5 9.5 6.5" /><path d="M7.5 4.5 9 3a2.5 2.5 0 0 1 3.5 3.5L11 8M8.5 11.5 7 13a2.5 2.5 0 0 1-3.5-3.5L5 8" /></>)

export const STATUS_ICON = {
  good: IconCheck,
  warning: IconAlert,
  serious: IconAlert,
  critical: IconAlert,
  info: IconSpark,
}
