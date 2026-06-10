import type { ReactNode } from "react"
import { ReportProvider } from "@/components/report-provider"
import { ReportShell } from "@/components/report-shell"

export default function ReportLayout({ children }: { children: ReactNode }) {
  return (
    <ReportProvider>
      <ReportShell>{children}</ReportShell>
    </ReportProvider>
  )
}
