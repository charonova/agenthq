import { useHashRoute, useOfficeStream } from './state/stream'
import { useOffices } from './state/store'
import { useAlerts } from './state/useAlerts'
import { useKeyboard } from './state/useKeyboard'
import { useMotion } from './state/useMotion'
import { useEffect } from 'react'
import { followNewSessions } from './state/sessions'
import { ChatPanel } from './ui/Chat'
import { EmptyState } from './ui/EmptyState'
import { Header } from './ui/Header'
import { NewSession } from './ui/NewSession'
import { ReplayBar } from './ui/ReplayBar'
import { SettingsPanel } from './ui/Settings'
import { SidePanel } from './ui/SidePanel'
import { Toast } from './ui/Toast'
import { WorldView } from './ui/WorldView'

export function App() {
  useOfficeStream()
  useHashRoute()
  useAlerts()
  useMotion()
  useKeyboard()
  useEffect(followNewSessions, [])
  const empty = useOffices((state) => state.connection === 'live' && state.offices.length === 0)
  return (
    <div className="app">
      <Header />
      <main className="layout">
        <section className="stage">
          {empty ? <EmptyState /> : <WorldView />}
          <ChatPanel />
          <Toast />
          <NewSession />
          <ReplayBar />
          <SettingsPanel />
        </section>
        <SidePanel />
      </main>
    </div>
  )
}
