"use client"

import * as React from "react"
import type { ProjectRepoRole } from "@code-mri/engine"
import {
  ChevronsUpDownIcon,
  FolderKanbanIcon,
  PlusIcon,
  RefreshCcwIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useReportState } from "@/components/report-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  ScrollArea,
} from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import type { ProjectRepoDraft, ProjectSummary } from "@/lib/report"

const ROLE_OPTIONS: Array<{ value: ProjectRepoRole; label: string }> = [
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "fullstack", label: "Fullstack" },
  { value: "worker", label: "Worker" },
  { value: "other", label: "Other" },
]

interface RepoFormRow extends ProjectRepoDraft {
  key: string
  role: ProjectRepoRole
}

function statusLabel(project: ProjectSummary | null): string {
  if (!project) return "No project"
  if (project.needsRefresh) return "Needs refresh"
  if (project.status === "error") return "Scan error"
  if (project.latestScanId) return "Latest report"
  return "Not scanned"
}

function scanDate(project: ProjectSummary): string {
  if (!project.lastScannedAt) return "No scan yet"

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(project.lastScannedAt))
}

function projectBadge(project: ProjectSummary) {
  if (project.needsRefresh) return <Badge variant="secondary">Needs refresh</Badge>
  if (project.status === "error") return <Badge variant="destructive">Error</Badge>
  if (project.latestScanId) return <Badge variant="outline">Ready</Badge>
  return <Badge variant="secondary">New</Badge>
}

function roleLabel(role: ProjectRepoRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Other"
}

function AddProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { createProject, scanningProjectId } = useReportState()
  const [name, setName] = React.useState("")
  const [repos, setRepos] = React.useState<RepoFormRow[]>([
    {
      key: "repo-1",
      name: "Frontend",
      root: "",
      role: "frontend",
    },
  ])
  const nextRepoId = React.useRef(2)
  const isSubmitting = scanningProjectId === "new"
  const canSubmit =
    name.trim().length > 0 && repos.some((repo) => repo.root.trim().length > 0)

  const updateRepo = (
    key: string,
    patch: Partial<Omit<RepoFormRow, "key">>,
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
        key: `repo-${next}`,
        name: "",
        root: "",
        role: "other",
      },
    ])
  }

  const removeRepo = (key: string) => {
    setRepos((current) => current.filter((repo) => repo.key !== key))
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || isSubmitting) return

    await createProject({
      name,
      repos: repos
        .filter((repo) => repo.root.trim().length > 0)
        .map((repo, index) => ({
          id: repo.name || `repo-${index + 1}`,
          name: repo.name,
          root: repo.root,
          role: repo.role,
        })),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-0 p-0 sm:max-w-2xl">
        <form className="flex min-h-0 flex-col" onSubmit={submit}>
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription className="sr-only">
              Bind one logical project to every local repo that should be scanned together.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[min(68svh,560px)] px-6">
            <FieldGroup className="gap-5 pb-5">
              <Field>
                <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                <Input
                  id="project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Acme platform"
                />
              </Field>
              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>Repositories</FieldLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addRepo}
                  >
                    <PlusIcon data-icon="inline-start" />
                    Add repo
                  </Button>
                </div>
                <FieldGroup className="gap-3">
                  {repos.map((repo, index) => (
                    <Field
                      key={repo.key}
                      className="gap-3 rounded-lg border border-border bg-muted/20 p-3"
                    >
                      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto]">
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
              </Field>
            </FieldGroup>
          </ScrollArea>
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              <RefreshCcwIcon
                data-icon="inline-start"
                className={cn(isSubmitting && "animate-spin")}
              />
              Create & scan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ProjectSwitcher() {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const {
    activeProjectId,
    projects,
    refreshProject,
    selectProject,
    scanningProjectId,
  } = useReportState()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null
  const isRefreshing =
    !!activeProject && scanningProjectId === activeProject.id

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                />
              }
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <FolderKanbanIcon />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {activeProject?.name ?? "Add project"}
                </span>
                <span className="truncate text-xs">
                  {activeProject
                    ? `${activeProject.repoCount} repos - ${statusLabel(activeProject)}`
                    : "Connect local repos"}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--anchor-width) min-w-72 rounded-lg"
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>Projects</DropdownMenuLabel>
                {projects.length === 0 ? (
                  <DropdownMenuItem
                    onClick={() => setDialogOpen(true)}
                    className="gap-2"
                  >
                    <PlusIcon />
                    Add first project
                  </DropdownMenuItem>
                ) : (
                  projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => void selectProject(project.id)}
                      className="items-start gap-3 p-2.5"
                    >
                      <div className="mt-0.5 flex size-7 items-center justify-center rounded-md border border-border bg-background">
                        <FolderKanbanIcon className="size-4" />
                      </div>
                      <div className="grid min-w-0 flex-1 gap-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">
                            {project.name}
                          </span>
                          {projectBadge(project)}
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          {project.repoCount} repos - {scanDate(project)}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={!activeProject}
                  onClick={() => router.push("/settings")}
                  className="gap-2"
                >
                  <SettingsIcon />
                  Project settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!activeProject || !!scanningProjectId}
                  onClick={() => {
                    if (activeProject) void refreshProject(activeProject.id)
                  }}
                  className="gap-2"
                >
                  <RefreshCcwIcon
                    className={cn(isRefreshing && "animate-spin")}
                  />
                  Refresh current
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDialogOpen(true)}
                  className="gap-2"
                >
                  <PlusIcon />
                  Add project
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
