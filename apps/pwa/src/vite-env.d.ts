/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAP_TILE_URL?: string
  readonly VITE_ENABLE_EXPERIMENTAL_ACOUSTIC?: string
  readonly VITE_ENABLE_EXPERIMENTAL_CIRCLES?: string
  readonly VITE_ENABLE_SAFE_CIRCLE_LOCATION?: string
  readonly VITE_ENABLE_EXPERIMENTAL_INSIGHTS?: string
  readonly VITE_ENABLE_EXPERIMENTAL_PHOTOS?: string
  readonly VITE_ENABLE_EXPERIMENTAL_ROUTING?: string
  readonly VITE_ENABLE_CHAT?: string
  readonly VITE_CHAT_INBOX_RELAY_URL?: string
  readonly VITE_CHAT_COMMUNITY_RELAY_URL?: string
  readonly VITE_CHAT_DISCOVERY_RELAYS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'react-map-gl' {
  import type { ReactNode, CSSProperties } from 'react'

  interface MapProps {
    mapboxAccessToken?: string
    initialViewState?: { longitude: number; latitude: number; zoom: number }
    style?: CSSProperties
    mapStyle?: string
    children?: ReactNode
    [key: string]: unknown
  }

  interface MarkerProps {
    longitude: number
    latitude: number
    children?: ReactNode
    [key: string]: unknown
  }

  interface PopupProps {
    longitude: number
    latitude: number
    onClose?: () => void
    children?: ReactNode
    [key: string]: unknown
  }

  export default function Map(props: MapProps): JSX.Element
  export function Marker(props: MarkerProps): JSX.Element
  export function Popup(props: PopupProps): JSX.Element
}
