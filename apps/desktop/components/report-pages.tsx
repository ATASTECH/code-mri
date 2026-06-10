import {
  ActivityIcon,
  FlameIcon,
  GitBranchIcon,
  GitCompareArrowsIcon,
  GitPullRequestClosedIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  RadarIcon,
  RouteIcon,
  SettingsIcon,
} from "lucide-react"

export const REPORT_PAGES = [
  {
    href: "/overview",
    title: "Overview",
    description:
      "Project summary, stack, health score, and issue distribution.",
    icon: LayoutDashboardIcon,
  },
  {
    href: "/architecture",
    title: "Architecture Map",
    description:
      "Semantic backend, API, and frontend graph with raw files hidden.",
    icon: NetworkIcon,
  },
  {
    href: "/api-map",
    title: "API Map",
    description:
      "Endpoint chains joined through ViewSet, Serializer, Model, and caller.",
    icon: RouteIcon,
  },
  {
    href: "/impact",
    title: "Impact",
    description: "Select a node and trace everything affected downstream.",
    icon: RadarIcon,
  },
  {
    href: "/what-changed",
    title: "What Changed",
    description:
      "Compare the active scan with the previous successful scan.",
    icon: GitCompareArrowsIcon,
  },
  {
    href: "/dead-code",
    title: "Dead Code",
    description:
      "Candidate unused components, endpoints, and static-analysis warnings.",
    icon: GitPullRequestClosedIcon,
  },
  {
    href: "/circular",
    title: "Circular Dependencies",
    description:
      "Import cycles detected by strongly connected component analysis.",
    icon: GitBranchIcon,
  },
  {
    href: "/risk",
    title: "Risk",
    description: "Health score, deductions, and severity breakdown.",
    icon: ActivityIcon,
  },
  {
    href: "/insights",
    title: "Insights",
    description:
      "Hotspots, coverage, security candidates, and evidence-backed explanations.",
    icon: FlameIcon,
  },
] as const

export const PROJECT_SETTINGS_PAGE = {
  href: "/settings",
  title: "Project Settings",
  description: "Project automation and repository configuration.",
  icon: SettingsIcon,
} as const

const APP_PAGES = [...REPORT_PAGES, PROJECT_SETTINGS_PAGE] as const

export type ReportPageHref = (typeof APP_PAGES)[number]["href"]

export function getReportPage(pathname: string | null) {
  return APP_PAGES.find((page) => page.href === pathname) ?? REPORT_PAGES[0]
}
