import { useEffect, useState } from 'react'

const CONSULTA = '(max-width: 767px)'

/** true em tela de celular (< 768px). Reage a girar a tela / redimensionar. */
export function useIsMobile() {
    const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(CONSULTA).matches)
    useEffect(() => {
        if (!window.matchMedia) return
        const mq = window.matchMedia(CONSULTA)
        const aoMudar = () => setMobile(mq.matches)
        aoMudar()
        mq.addEventListener?.('change', aoMudar)
        return () => mq.removeEventListener?.('change', aoMudar)
    }, [])
    return mobile
}

/**
 * Área REALMENTE visível (descontando o teclado do celular). `100vh` ignora o teclado e esconde o campo
 * de mensagem atrás dele; visualViewport acompanha. Devolve { altura, topo } em px (ou null se não houver
 * suporte → quem usa cai no 100dvh).
 */
export function useAreaVisivel() {
    const ler = () => {
        const vv = typeof window !== 'undefined' ? window.visualViewport : null
        return vv ? { altura: Math.round(vv.height), topo: Math.round(vv.offsetTop) } : null
    }
    const [area, setArea] = useState(ler)
    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const atualizar = () => setArea(ler())
        vv.addEventListener('resize', atualizar)
        vv.addEventListener('scroll', atualizar)
        return () => { vv.removeEventListener('resize', atualizar); vv.removeEventListener('scroll', atualizar) }
    }, [])
    return area
}
