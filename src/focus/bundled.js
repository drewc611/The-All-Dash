/*
 * The bundled photographs.
 *
 * Seven, one per time-of-day band, every one a work of the United States
 * federal government - the National Park Service or the Fish and Wildlife
 * Service - which is public domain by statute rather than by somebody's
 * licence choice. That matters for a picture shipped inside an application:
 * a statute cannot be revoked the way a licence can, and the images stay
 * redistributable however this app is packaged, the Snap Store and the app stores
 * included. Each entry carries the page it came from so the claim is
 * checkable rather than asserted.
 *
 * They are files in public/, not imports, so none of this is in the
 * JavaScript bundle. A browser fetches exactly one photograph - the band it
 * is currently in - and the service worker caches it after that. The AVIF set
 * is 810KB on disk in total; a single photograph averages 118KB.
 *
 * `placeholder` is a 24px WebP inlined as a data URI, about 300 bytes. It is
 * what the fade starts from while the real photograph decodes, so the first
 * paint of this view is never an empty rectangle.
 */

/** Where the files live, relative to the app root. */
const DIR = 'wallpapers'

export const BUNDLED = [
  {
    id: 'bundled:dawn',
    band: 'dawn',
    title: 'Sunrise at the national park',
    credit: { author: 'Hillebrand Steve, U.S. Fish and Wildlife Service', licence: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Sunrise_at_the_national_park.jpg' },
    placeholder: 'data:image/webp;base64,UklGRngAAABXRUJQVlA4IGwAAADQAwCdASoYAA0APu1mq04ppaQiMAgBMB2JbACdAB6/cNd67WPtkYAA7sI6JJoL/oeLrRuyd5XUWrpzltJIc2gzupifOUBqsJiwkq9jEPtLWo68aGrlBo+/5/FdxkOArYZ4/TAUAbDqEt4YAAA=',
    note: 'first light',
  },
  {
    id: 'bundled:morning',
    band: 'morning',
    title: 'Early morning fog blankets the low lying area between Onion Portage and the Baird Mountains. (c506c2f7-1dd8-b71c-0797-a4d613c6a250)',
    credit: { author: 'NPS Photo', licence: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Early_morning_fog_blankets_the_low_lying_area_between_Onion_Portage_and_the_Baird_Mountains._(c506c2f7-1dd8-b71c-0797-a4d613c6a250).jpg' },
    placeholder: 'data:image/webp;base64,UklGRm4AAABXRUJQVlA4IGIAAACwAwCdASoYAA0APu1iqU2ppaQiMAgBMB2JZQCdACHhgDZbNXMT3AD+8EHtpj+E1bewYJ9e9zGmhNsLtQChfiKhV6w1cRJ25K99PGT/wgnvhmxTZRYrl0L3cAhXTQg5ZoAAAA==',
    note: 'mid-morning',
  },
  {
    id: 'bundled:midday',
    band: 'midday',
    title: 'Backcountry Desert Landscape (54268531959)',
    credit: { author: 'Joshua Tree National Park', licence: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Backcountry_Desert_Landscape_(54268531959).jpg' },
    placeholder: 'data:image/webp;base64,UklGRpIAAABXRUJQVlA4IIYAAABQBACdASoYAA0APu1iqU2ppaQiMAgBMB2JZgCdH8IwBb/4DedeRc2zEKYAAPeLMRO7AXJL/KvGG4MhPA2ruDQ8nZJsd73XPMbEbHBpH55TP592bPlbJt9l3n6onrAKPPvzq2SA+m/JY1smvTwRrh+RF71st6MKRMG5qsnYYUibFHICMqRwAA==',
    note: 'overhead sun',
  },
  {
    id: 'bundled:afternoon',
    band: 'afternoon',
    title: 'Electric Peak from Swan Lake Flat on sunny afternoon (53940944431)',
    credit: { author: 'YellowstoneNPS', licence: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Electric_Peak_from_Swan_Lake_Flat_on_sunny_afternoon_(53940944431).jpg' },
    placeholder: 'data:image/webp;base64,UklGRqQAAABXRUJQVlA4IJgAAABwBACdASoYAA0APu1iqU2ppaQiMAgBMB2JaACdMoMpA0jtwlY6fvUa7vdSAAD+34n1854/bz6wQzdtb7AU+f/22ISVSYoUovd9hv7GM8h6l4zGesWDQ4MtduO79rv0VeOe7mmoH/aE85TbfsBUlOud/RnAn21ieq4vR66sb9+cj/EAbam5RtoV4S6ER+jocpkaYPOp3PoAAA==',
    note: 'late afternoon',
  },
  {
    id: 'bundled:golden',
    band: 'golden',
    title: 'Joshua trees along Geology Tour Road at sunset (51147929849)',
    credit: { author: 'Joshua Tree National Park', licence: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Joshua_trees_along_Geology_Tour_Road_at_sunset_(51147929849).jpg' },
    placeholder: 'data:image/webp;base64,UklGRnAAAABXRUJQVlA4IGQAAADwAwCdASoYAA0APu1oqk6ppiQiMAgBMB2JQBOnf9gYFOKlV2RWebKAAM3tZ2ah1qv2DZHXkbqJwGALu3ECq5XiWDpHqcy+KeZ9Q2LIhShXfUZU0pEEjrWUY0DyYWTqB1HFgAAA',
    note: 'golden hour',
  },
  {
    id: 'bundled:dusk',
    band: 'dusk',
    title: 'Venus Over Dunes (39916414910)',
    credit: { author: 'Great Sand Dunes National Park and Preserve', licence: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Venus_Over_Dunes_(39916414910).jpg' },
    placeholder: 'data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAACwAwCdASoYAA0APu1iqk2ppaQiMAgBMB2JZACdMoAEZxGYYj/rAAD+7Hiv78VTN14yHMPe3Uqzcd7GyABUH5myLGB4hFjWsCidCSuAAAA=',
    note: 'after sunset',
  },
  {
    id: 'bundled:night',
    band: 'night',
    title: 'Stars above a Joshua tree (53433925526)',
    credit: { author: 'Joshua Tree National Park', licence: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Stars_above_a_Joshua_tree_(53433925526).jpg' },
    placeholder: 'data:image/webp;base64,UklGRkwAAABXRUJQVlA4IEAAAADQAwCdASoYAA0APu1mq04ppaQiMAgBMB2JYwAASrD7tFFtd00r1eAA/vDfrfDPjaF1LUMNDYrkLANJ6Y5WsQAA',
    note: 'full dark',
  },
]

/*
 * AVIF where the browser takes it, WebP otherwise.
 *
 * Roughly a third smaller for the same quality on these photographs - the
 * midday frame is 200KB as AVIF and 308KB as WebP. The check runs once and is
 * cached, because canPlayType-style probing per image would be silly.
 */
let preferred = null

export function format() {
  if (preferred) return preferred
  if (typeof document === 'undefined') return (preferred = 'webp')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const avif = canvas.toDataURL('image/avif').startsWith('data:image/avif')
  return (preferred = avif ? 'avif' : 'webp')
}

/** The bundled set as the wallpaper picker wants it. */
export const bundledPictures = (ext = format()) =>
  BUNDLED.map((p) => ({ ...p, url: `${DIR}/${p.band}.${ext}`, own: false }))

