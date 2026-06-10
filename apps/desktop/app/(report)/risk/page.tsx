"use client"

import { RiskDashboard } from "@/components/screens/RiskDashboard"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"

const page = getReportPage("/risk")

export default function RiskPage() {
  const { report } = useReportState()

  if (!report) return null

  return (
    <ReportPage title={page.title} description={page.description}>
      <RiskDashboard report={report} />
    </ReportPage>
  )
}
