"use client"

import { Circular } from "@/components/screens/Circular"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"

const page = getReportPage("/circular")

export default function CircularPage() {
  const { report } = useReportState()

  if (!report) return null

  return (
    <ReportPage title={page.title} description={page.description}>
      <Circular report={report} />
    </ReportPage>
  )
}
