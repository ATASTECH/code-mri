"use client"

import { DeadCode } from "@/components/screens/DeadCode"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"

const page = getReportPage("/dead-code")

export default function DeadCodePage() {
  const { report } = useReportState()

  if (!report) return null

  return (
    <ReportPage title={page.title} description={page.description}>
      <DeadCode report={report} />
    </ReportPage>
  )
}
