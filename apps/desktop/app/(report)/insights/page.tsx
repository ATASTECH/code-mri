"use client"

import { Insights } from "@/components/screens/Insights"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"

const page = getReportPage("/insights")

export default function InsightsPage() {
  const { activeTrend, report } = useReportState()

  if (!report) return null

  return (
    <ReportPage title={page.title} description={page.description}>
      <Insights
        nodeHistory={activeTrend?.nodeHistory ?? []}
        report={report}
      />
    </ReportPage>
  )
}
