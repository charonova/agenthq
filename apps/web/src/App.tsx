import { useHashRoute, useOfficeStream } from './state/stream'
import { useOffices } from './state/store'
import { useAlerts } from './state/useAlerts'
import { ChatPanel } from './ui/Chat'
import { EmptyState } from './ui/EmptyState'
import { Header } from './ui/Header'
import { SidePanel } from './ui/SidePanel'
import { Toast } from './ui/Toast'
import { WorldView } from './ui/WorldView'

export function App() {
  useOfficeStream()
  useHashRoute()
  useAlerts()
  const empty = useOffices((state) => state.connection === 'live' && state.offices.length === 0)
  return (
    <div className="app">
      <Header />
      <main className="layout">
        <section className="stage">
          {empty ? <EmptyState /> : <WorldView />}
          <ChatPanel />
          <Toast />
        </section>
        <SidePanel />
      </main>
    </div>
  )
}
