"use client"

import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"
import { WhatChanged } from "@/components/screens/WhatChanged"

const page = getReportPage("/what-changed")

export default function WhatChangedPage() {
  const { activeReportDiff, report } = useReportState()

  if (!report) return null

  return (
    <ReportPage title={page.title} description={page.description}>
      <WhatChanged payload={activeReportDiff} />
    </ReportPage>
  )
}
