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

// Colocamos os dados AQUI MESMO, sem precisar de arquivos extras!
const NICHE_DATA = [
  { value: "mercado", label: "Supermercados & Minimercados", keywords: "mercado" },
  { value: "acougue", label: "Açougues & Frigoríficos", keywords: "acougue" },
  { value: "distribuidora", label: "Distribuidoras & Conveniências", keywords: "distribuidora" },
  { value: "sorveteria", label: "Sorveterias & Açaiterias", keywords: "sorveteria" },
  { value: "padaria", label: "Padarias & Confeitarias", keywords: "padaria" },
  { value: "lavanderia", label: "Lavanderias Comerciais", keywords: "lavanderia" },
  { value: "marcenaria", label: "Marcenarias & Serralherias", keywords: "marcenaria" },
  { value: "petshop", label: "Pet Shops & Banho/Tosa", keywords: "petshop" },
  { value: "restaurante", label: "Restaurantes & Lanchonetes", keywords: "restaurante" },
  { value: "clinica", label: "Clínicas Médicas & Estética", keywords: "clinica" },
  { value: "odontologia", label: "Clínicas Odontológicas", keywords: "odontologia" },
  { value: "farmacia", label: "Farmácias & Drogarias", keywords: "farmacia" },
  { value: "beleza", label: "Salões de Beleza & Barbearias", keywords: "beleza" },
  { value: "oficina", label: "Oficinas & Auto Centers", keywords: "oficina" },
  { value: "posto", label: "Postos de Combustível", keywords: "posto" },
  { value: "academia", label: "Academias & Crossfit", keywords: "academia" },
  { value: "hotel", label: "Hotéis & Pousadas", keywords: "hotel" },
  { value: "industria", label: "Indústrias & Fábricas", keywords: "industria" }
]

export default function NicheSelect({ onNicheSelect }) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState("")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-16 bg-black/40 border-white/10 text-white font-bold text-base px-6 rounded-2xl focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500 transition-all shadow-inner hover:bg-black/60 hover:text-amber-400"
        >
          {value
            ? NICHE_DATA.find((niche) => niche.value === value)?.label
            : "Selecione um nicho..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0 bg-[#111111] border-white/10 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.8)]">
        <Command className="bg-transparent text-white">
          <CommandInput 
            placeholder="Buscar nicho..." 
            className="border-none focus:ring-0 text-white placeholder:text-slate-500 h-12"
          />
          <CommandList className="max-h-[300px] custom-scrollbar">
            <CommandEmpty className="py-6 text-center text-sm text-slate-500">Nenhum nicho encontrado.</CommandEmpty>
            <CommandGroup>
              {NICHE_DATA.map((niche) => (
                <CommandItem
                  key={niche.value}
                  value={niche.label}
                  className="pl-4 py-3 text-sm font-bold text-slate-200 focus:bg-amber-600/20 focus:text-amber-400 cursor-pointer rounded-xl mx-1 transition-colors data-[selected=true]:bg-amber-600/20 data-[selected=true]:text-amber-400"
                  onSelect={(currentValue) => {
                    // Pega o objeto completo selecionado
                    const selectedNiche = NICHE_DATA.find(n => n.label.toLowerCase() === currentValue.toLowerCase())
                    
                    setValue(selectedNiche ? selectedNiche.value : "")
                    setOpen(false)
                    
                    // Envia exatamente no formato que o App.jsx precisa ({ keywords, label })
                    if (selectedNiche && onNicheSelect) {
                      onNicheSelect({ keywords: selectedNiche.keywords, label: selectedNiche.label })
                    }
                  }}
                >
                  <Check
                    className={cn(
                      "mr-3 h-4 w-4 text-amber-500",
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