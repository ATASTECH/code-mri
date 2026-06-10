import type { ComponentType, SVGProps } from "react"
import { Django } from "@/components/ui/svgs/django"
import { Docker } from "@/components/ui/svgs/docker"
import { NextjsIconDark } from "@/components/ui/svgs/nextjsIconDark"
import { ReactLight } from "@/components/ui/svgs/reactLight"
import { Typescript } from "@/components/ui/svgs/typescript"
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"

type LogoComponent = ComponentType<SVGProps<SVGSVGElement>>

const STACK_LOGOS: Record<
  string,
  {
    label: string
    Logo: LogoComponent
  }
> = {
  django: {
    label: "Django",
    Logo: Django,
  },
  docker: {
    label: "Docker",
    Logo: Docker,
  },
  "next.js": {
    label: "Next.js",
    Logo: NextjsIconDark,
  },
  nextjs: {
    label: "Next.js",
    Logo: NextjsIconDark,
  },
  react: {
    label: "React",
    Logo: ReactLight,
  },
  typescript: {
    label: "TypeScript",
    Logo: Typescript,
  },
}

function normalizeStackName(name: string) {
  return name.trim().toLowerCase()
}

export function stackLabel(name: string) {
  return STACK_LOGOS[normalizeStackName(name)]?.label ?? name
}

export function StackLogoIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const stack = STACK_LOGOS[normalizeStackName(name)]

  if (!stack) {
    return null
  }

  const { Logo } = stack

  return <Logo aria-hidden className={cn("size-5 shrink-0", className)} />
}

export function StackLogoItem({ name }: { name: string }) {
  return (
    <Item variant="outline" size="sm">
      <ItemMedia className="size-9 rounded-xl bg-muted/50">
        <StackLogoIcon name={name} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{stackLabel(name)}</ItemTitle>
      </ItemContent>
    </Item>
  )
}
