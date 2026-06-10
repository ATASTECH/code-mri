"use client"

import { Impact } from "@/components/screens/Impact"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"

const page = getReportPage("/impact")

export default function ImpactPage() {
  const { report } = useReportState()

  if (!report) return null

  return (
    <ReportPage title={page.title} description={page.description}>
      <div className="h-[calc(100svh-12rem)] min-h-[560px]">
        <Impact report={report} />
      </div>
    </ReportPage>
  )
}
