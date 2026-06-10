"use client"

import type { ChangeEvent, PropsWithChildren } from "react"
import { usePathname } from "next/navigation"
import { AlertCircleIcon, RefreshCcwIcon, UploadIcon } from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

function LoadingState() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-[420px]" />
    </div>
  )
}

export function ReportShell({ children }: PropsWithChildren) {
  const pathname = usePathname()
  const page = getReportPage(pathname)
  const isSettingsPage = pathname === "/settings"
  const {
    activeProjectId,
    error,
    loadFromText,
    loading,
    projects,
    refreshProject,
    report,
    scanningProjectId,
  } = useReportState()
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null
  const isActiveProjectScanning =
    !!activeProject && scanningProjectId === activeProject.id
  const staleRepoNames =
    activeProject?.staleRepos.map((repo) => repo.name).join(", ") ?? ""

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (file) {
      void file.text().then(loadFromText)
    }

    event.target.value = ""
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>Code MRI</BreadcrumbPage>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{page.title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {report ? (
              <>
                <Badge variant="outline">{report.project.name}</Badge>
                <Badge variant="secondary">
                  Health {report.scores.health}/100
                </Badge>
              </>
            ) : null}
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<label htmlFor="report-file" />}
            >
              <UploadIcon data-icon="inline-start" />
              Load report
            </Button>
            <Input
              id="report-file"
              type="file"
              accept="application/json"
              className="hidden"
              onChange={onFile}
            />
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
          {loading ? <LoadingState /> : null}
          {!loading && error && report ? (
            <Alert>
              <AlertCircleIcon />
              <AlertTitle>Scan status</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!loading && report && activeProject?.needsRefresh ? (
            <Alert>
              <AlertCircleIcon />
              <AlertTitle>
                {activeProject.autoScanOnChange
                  ? isActiveProjectScanning
                    ? "Repo updates detected, scanning..."
                    : "Repo updates detected"
                  : "Repo updates detected"}
              </AlertTitle>
              <AlertDescription>
                {staleRepoNames
                  ? `${staleRepoNames} changed. Scan refresh needed.`
                  : "One or more repositories changed. Scan refresh needed."}
              </AlertDescription>
              {!activeProject.autoScanOnChange ? (
                <AlertAction>
                  <Button
                    size="sm"
                    disabled={isActiveProjectScanning}
                    onClick={() => void refreshProject(activeProject.id)}
                  >
                    <RefreshCcwIcon
                      data-icon="inline-start"
                      className={cn(isActiveProjectScanning && "animate-spin")}
                    />
                    Refresh scan
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          ) : null}
          {!loading && !report && !isSettingsPage ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>No report loaded</AlertTitle>
              <AlertDescription>
                {error ?? "Load a Code MRI JSON report to view analysis pages."}
              </AlertDescription>
            </Alert>
          ) : null}
          {!loading && (report || isSettingsPage) ? children : null}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
