"use client"

import * as React from "react"
import type { ProjectRepoRole } from "@code-mri/shared-types"
import {
  FolderKanbanIcon,
  PlusIcon,
  RefreshCcwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react"
import { ReportPage } from "@/components/report-page"
import { getReportPage } from "@/components/report-pages"
import { useReportState } from "@/components/report-provider"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { ProjectRepoDraft, ProjectSummary } from "@/lib/report"

const page = getReportPage("/settings")

const ROLE_OPTIONS: Array<{ value: ProjectRepoRole; label: string }> = [
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "fullstack", label: "Fullstack" },
  { value: "worker", label: "Worker" },
  { value: "other", label: "Other" },
]

interface RepoRow extends ProjectRepoDraft {
  key: string
  role: ProjectRepoRole
}

function roleLabel(role: ProjectRepoRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Other"
}

function rowsFromProject(project: ProjectSummary): RepoRow[] {
  return project.repos.map((repo) => ({
    key: repo.id,
    id: repo.id,
    name: repo.name,
    root: repo.root,
    role: repo.role,
  }))
}

function draftSignature(name: string, repos: RepoRow[]): string {
  return JSON.stringify({
    name: name.trim(),
    repos: repos
      .filter((repo) => repo.root.trim().length > 0)
      .map((repo) => ({
        id: repo.id?.trim() || undefined,
        name: repo.name?.trim() || undefined,
        root: repo.root.trim(),
        role: repo.role,
      })),
  })
}

function projectSignature(project: ProjectSummary): string {
  return JSON.stringify({
    name: project.name,
    repos: project.repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      root: repo.root,
      role: repo.role,
    })),
  })
}

function statusBadge(project: ProjectSummary) {
  if (project.needsRefresh) return <Badge variant="secondary">Needs refresh</Badge>
  if (project.status === "error") return <Badge variant="destructive">Error</Badge>
  if (project.latestScanId) return <Badge variant="outline">Ready</Badge>
  return <Badge variant="secondary">New</Badge>
}

export function ProjectSettingsPage() {
  const { activeProjectId, projects } = useReportState()
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null

  if (!activeProject) {
    return (
      <ReportPage title={page.title} description={page.description}>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanbanIcon />
            </EmptyMedia>
            <EmptyTitle>No project selected</EmptyTitle>
            <EmptyDescription>
              Add or select a project from the sidebar.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ReportPage>
    )
  }

  return (
    <ProjectSettingsEditor
      key={activeProject.id}
      activeProject={activeProject}
    />
  )
}

function ProjectSettingsEditor({
  activeProject,
}: {
  activeProject: ProjectSummary
}) {
  const {
    refreshProject,
    scanningProjectId,
    updateProject,
    updateProjectSettings,
  } = useReportState()
  const [name, setName] = React.useState(() => activeProject.name)
  const [repos, setRepos] = React.useState<RepoRow[]>(() =>
    rowsFromProject(activeProject)
  )
  const [saving, setSaving] = React.useState(false)
  const [savingAutoScan, setSavingAutoScan] = React.useState(false)
  const nextRepoId = React.useRef(1)

  const isScanning = scanningProjectId === activeProject.id
  const linkedRepoCount = repos.filter(
    (repo) => repo.root.trim().length > 0
  ).length
  const canSave =
    name.trim().length > 0 && linkedRepoCount > 0
  const hasChanges =
    draftSignature(name, repos) !== projectSignature(activeProject)
  const staleRepoNames =
    activeProject.staleRepos.map((repo) => repo.name).join(", ")

  const updateRepo = (
    key: string,
    patch: Partial<Omit<RepoRow, "key">>,
  ) => {
    setRepos((current) =>
      current.map((repo) => (repo.key === key ? { ...repo, ...patch } : repo))
    )
  }

  const addRepo = () => {
    const next = nextRepoId.current++
    setRepos((current) => [
      ...current,
      {
        key: `new-repo-${Date.now()}-${next}`,
        name: "",
        root: "",
        role: "other",
      },
    ])
  }

  const removeRepo = (key: string) => {
    setRepos((current) => current.filter((repo) => repo.key !== key))
  }

  const saveAndRefresh = async () => {
    if (!activeProject || !canSave || saving || isScanning) return

    setSaving(true)
    try {
      await updateProject(activeProject.id, {
        name,
        repos: repos
          .filter((repo) => repo.root.trim().length > 0)
          .map((repo) => ({
            id: repo.id,
            name: repo.name,
            root: repo.root,
            role: repo.role,
          })),
      })
      await refreshProject(activeProject.id)
    } finally {
      setSaving(false)
    }
  }

  const updateAutoScan = async (checked: boolean) => {
    if (savingAutoScan) return

    setSavingAutoScan(true)
    try {
      await updateProjectSettings(activeProject.id, {
        autoScanOnChange: checked,
      })
    } finally {
      setSavingAutoScan(false)
    }
  }

  return (
    <ReportPage title={page.title} description={page.description}>
      <div className="flex flex-col gap-4">
        {activeProject.needsRefresh ? (
          <Alert>
            <RefreshCcwIcon className={cn(isScanning && "animate-spin")} />
            <AlertTitle>Repo updates detected</AlertTitle>
            <AlertDescription>
              {staleRepoNames
                ? `${staleRepoNames} changed.`
                : "One or more repositories changed."}
            </AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                disabled={isScanning}
                onClick={() => void refreshProject(activeProject.id)}
              >
                <RefreshCcwIcon
                  data-icon="inline-start"
                  className={cn(isScanning && "animate-spin")}
                />
                Refresh scan
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Project</CardTitle>
            <CardDescription>{activeProject.repoCount} repositories</CardDescription>
            <CardAction>{statusBadge(activeProject)}</CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="settings-project-name">
                  Project name
                </FieldLabel>
                <Input
                  id="settings-project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Auto scan on changes</FieldTitle>
                  <FieldDescription>
                    Start a project scan when selected repositories have changed.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={activeProject.autoScanOnChange}
                  disabled={savingAutoScan}
                  onCheckedChange={(checked) => void updateAutoScan(checked)}
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Repositories</CardTitle>
            <CardDescription>
              {linkedRepoCount} linked repositories
            </CardDescription>
            <CardAction>
              <Button type="button" variant="outline" size="sm" onClick={addRepo}>
                <PlusIcon data-icon="inline-start" />
                Add repo
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[min(62svh,620px)] pr-3">
              <FieldGroup className="gap-4">
                {repos.map((repo, index) => (
                  <Field
                    key={repo.key}
                    className="gap-3 rounded-lg border border-border bg-muted/20 p-3"
                  >
                    <div className="grid gap-3 md:grid-cols-[1fr_10rem_auto]">
                      <Input
                        aria-label="Repo name"
                        value={repo.name ?? ""}
                        onChange={(event) =>
                          updateRepo(repo.key, { name: event.target.value })
                        }
                        placeholder={index === 0 ? "Frontend" : "Repo name"}
                      />
                      <Select
                        value={repo.role}
                        onValueChange={(value) =>
                          updateRepo(repo.key, {
                            role: value as ProjectRepoRole,
                          })
                        }
                      >
                        <SelectTrigger aria-label="Repo role" className="w-full">
                          <SelectValue>{roleLabel(repo.role)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {ROLE_OPTIONS.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeRepo(repo.key)}
                        disabled={repos.length === 1}
                      >
                        <Trash2Icon />
                        <span className="sr-only">Remove repo</span>
                      </Button>
                    </div>
                    <Input
                      aria-label="Repo path"
                      value={repo.root}
                      onChange={(event) =>
                        updateRepo(repo.key, { root: event.target.value })
                      }
                      placeholder="/Users/tahaatas/workspace/acme-frontend"
                    />
                  </Field>
                ))}
              </FieldGroup>
            </ScrollArea>
          </CardContent>
          <Separator />
          <CardFooter className="justify-between gap-3">
            <Button
              variant="outline"
              disabled={isScanning}
              onClick={() => void refreshProject(activeProject.id)}
            >
              <RefreshCcwIcon
                data-icon="inline-start"
                className={cn(isScanning && "animate-spin")}
              />
              Refresh scan
            </Button>
            <Button
              disabled={!canSave || !hasChanges || saving || isScanning}
              onClick={() => void saveAndRefresh()}
            >
              <SaveIcon data-icon="inline-start" />
              Save & refresh scan
            </Button>
          </CardFooter>
        </Card>
      </div>
    </ReportPage>
  )
}
