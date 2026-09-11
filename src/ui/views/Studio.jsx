import { useState } from 'react'
import { Gallery } from '../media/Gallery.jsx'
import { Camera } from '../media/Camera.jsx'
import { Compress } from '../media/Compress.jsx'
import { Tube } from '../media/Tube.jsx'
import { IconImage, IconCamera, IconCompress, IconYouTube } from '../icons.jsx'

const TABS = [
  { id: 'library', label: 'Media', Icon: IconImage },
  { id: 'camera', label: 'Camera', Icon: IconCamera },
  { id: 'compress', label: 'Compress', Icon: IconCompress },
  { id: 'youtube', label: 'YouTube', Icon: IconYouTube },
]

/** The media half of the app: what you have, what you shoot, what you shrink,
    and the one surface that reaches outside the browser. */
export function Studio({ entities, onToast, onOpen }) {
  const [tab, setTab] = useState('library')

  return (
    <div className="stack">
      <header className="wtabs">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className="wtab"
            aria-current={tab === id}
            onClick={() => setTab(id)}
          ><Icon width={12} height={12} /> {label}</button>
        ))}
      </header>

      {tab === 'library' && <Gallery entities={entities} onToast={onToast} onOpen={onOpen} />}
      {tab === 'camera' && <Camera onToast={onToast} />}
      {tab === 'compress' && <Compress onToast={onToast} />}
      {tab === 'youtube' && <Tube entities={entities} onToast={onToast} />}
    </div>
  )
}
