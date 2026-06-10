"use client"

import { ArchitectureMap } from "@/components/screens/ArchitectureMap"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"

const page = getReportPage("/architecture")

export default function ArchitecturePage() {
  const { report } = useReportState()

  if (!report) return null

  return (
    <ReportPage title={page.title} description={page.description}>
      <div className="h-[calc(100svh-12rem)] min-h-[560px]">
        <ArchitectureMap report={report} />
      </div>
    </ReportPage>
  )
}
