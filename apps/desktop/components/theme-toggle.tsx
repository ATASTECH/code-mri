"use client"

import * as React from "react"
import { LaptopIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const themeOptions = [
  {
    value: "system",
    label: "System",
    icon: LaptopIcon,
  },
  {
    value: "light",
    label: "Light",
    icon: SunIcon,
  },
  {
    value: "dark",
    label: "Dark",
    icon: MoonIcon,
  },
] as const

function subscribeToMount() {
  return () => {}
}

function getClientSnapshot() {
  return true
}

function getServerSnapshot() {
  return false
}

function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme()
  const mounted = React.useSyncExternalStore(
    subscribeToMount,
    getClientSnapshot,
    getServerSnapshot
  )
  const selectedTheme = mounted ? theme : "system"
  const activeTheme =
    themeOptions.find((option) => option.value === selectedTheme) ??
    themeOptions[0]
  const ActiveIcon = activeTheme.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" />}>
        <ActiveIcon />
        <span className="sr-only">Theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup value={selectedTheme} onValueChange={setTheme}>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          {themeOptions.map((option) => {
            const Icon = option.icon

            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <Icon />
                {option.label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ThemeToggle }
