import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Player de áudio de uma mensagem (do lead ou da Sofia). O arquivo fica no bucket PRIVADO 'audios'
// (pasta = user_id do tenant); o link assinado vale 1h e só o dono da conta consegue gerar.
export default function AudioMensagem({ path }) {
    const [url, setUrl] = useState(null)
    const [erro, setErro] = useState(false)

    useEffect(() => {
        let vivo = true
        supabase.storage.from('audios').createSignedUrl(path, 3600).then(({ data, error }) => {
            if (!vivo) return
            if (error || !data?.signedUrl) setErro(true)
            else setUrl(data.signedUrl)
        })
        return () => { vivo = false }
    }, [path])

    if (erro) return <p className="text-[9px] text-slate-500 mb-1">🎙️ áudio indisponível</p>
    if (!url) return <p className="text-[9px] text-slate-500 mb-1">🎙️ carregando áudio…</p>
    return <audio controls preload="none" src={url} className="h-8 w-[240px] max-w-full mb-1" />
}
