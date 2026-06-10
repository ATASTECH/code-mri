"use client"

import { Overview } from "@/components/screens/Overview"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"

const page = getReportPage("/overview")

export default function OverviewPage() {
  const {
    activeProjectId,
    activeRegressionAlerts,
    activeTrend,
    projects,
    report,
  } = useReportState()

  if (!report) return null

  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null

  return (
    <ReportPage title={page.title} description={page.description}>
      <Overview
        activeProject={activeProject}
        activeRegressionAlerts={activeRegressionAlerts}
        activeTrend={activeTrend}
        report={report}
      />
    </ReportPage>
  )
}
