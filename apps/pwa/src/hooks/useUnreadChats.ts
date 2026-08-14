import { useAppSelector } from '../store'

/** Total unread across all channels, for nav badges. */
export function useUnreadChats(): number {
  return useAppSelector(s => Object.values(s.chat.unread).reduce((sum, n) => sum + n, 0))
}
