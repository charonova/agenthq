import { useEffect, useState } from 'react'

/** The current time, refreshed every few seconds, for "2m ago" labels. */
export function useNow(every = 5000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}
