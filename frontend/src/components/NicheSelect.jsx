import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { NICHE_DATA } from "@/data/niche-data"

export function NicheSelect({ onNicheSelect }) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState("")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value
            ? NICHE_DATA.find((niche) => niche.value === value)?.label
            : "Selecione um nicho..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Buscar nicho..." />
          <CommandList>
            <CommandEmpty>Nenhum nicho encontrado.</CommandEmpty>
            <CommandGroup>
              {NICHE_DATA.map((niche) => (
                <CommandItem
                  key={niche.value}
                  value={niche.label}
                  onSelect={(currentValue) => {
                    const selectedNiche = NICHE_DATA.find(n => n.label.toLowerCase() === currentValue.toLowerCase())
                    
                    setValue(selectedNiche ? selectedNiche.value : "")
                    setOpen(false)
                    
                    if (selectedNiche && onNicheSelect) {
                      onNicheSelect(selectedNiche)
                    }
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === niche.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {niche.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}