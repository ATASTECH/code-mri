"use client"

import type { PropsWithChildren } from "react"
import { createContext, useContext } from "react"
import type { UseReport } from "@/lib/report"
import { useReport } from "@/lib/report"

const ReportContext = createContext<UseReport | null>(null)

export function ReportProvider({ children }: PropsWithChildren) {
  const state = useReport()

  return (
    <ReportContext.Provider value={state}>{children}</ReportContext.Provider>
  )
}

export function useReportState() {
  const state = useContext(ReportContext)

  if (!state) {
    throw new Error("useReportState must be used inside ReportProvider")
  }

  return state
}
