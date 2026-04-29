import SafetyMap from './components/SafetyMap'
import { useWsConnection } from './services/websocket'

export default function App() {
  useWsConnection()

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SafetyMap />
    </div>
  )
}
