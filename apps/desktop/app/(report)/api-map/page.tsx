"use client"

import { ApiMap } from "@/components/screens/ApiMap"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"

const page = getReportPage("/api-map")

export default function ApiMapPage() {
  const { report } = useReportState()

  if (!report) return null

  return (
    <ReportPage title={page.title} description={page.description}>
      <ApiMap report={report} />
    </ReportPage>
  )
}
