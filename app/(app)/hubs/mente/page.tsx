'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { NotePanel, type NoteItem } from '@/components/NotePanel'

// ─── Types ───────────────────────────────────────────────────────────────────

interface GraphNode extends SimulationNodeDatum {
  id: string
  title: string
  domain: string
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  similarity: number
}

interface GraphData {
  nodes: { id: string; title: string; domain: string }[]
  links: { source: string; target: string; similarity: number }[]
}

// ─── Domain colors ────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  ESPIRITUAL: '#D4A843',  // Gold
  PERSONAL: '#A78BDB',    // Purple
  APRENDIZAJE: '#60A5FA', // Blue
  PROYECTOS: '#34D399',   // Emerald
  REGISTROS: '#FB923C',    // Orange
}

function nodeColor(domain: string): string {
  return DOMAIN_COLORS[domain] ?? '#6B7280'
}

// ─── Graph Canvas ─────────────────────────────────────────────────────────────

interface GraphCanvasProps {
  nodes: GraphNode[]
  links: GraphLink[]
  onNodeClick: (id: string) => void
}

function GraphCanvas({ nodes, links, onNodeClick }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode, GraphLink>> | null>(null)
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const nodesRef = useRef<GraphNode[]>(nodes)
  const linksRef = useRef<GraphLink[]>(links)
  const draggingRef = useRef<{ node: GraphNode; dx: number; dy: number } | null>(null)
  const hoveredNodeRef = useRef<string | null>(null)

  // Keep refs in sync
  nodesRef.current = nodes
  linksRef.current = links

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    const { x: tx, y: ty, k } = transformRef.current

    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(k, k)

    // Draw links
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.25)'
    ctx.lineWidth = 1 / k
    for (const link of linksRef.current) {
      const s = link.source as GraphNode
      const t = link.target as GraphNode
      if (s.x == null || s.y == null || t.x == null || t.y == null) continue
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(t.x, t.y)
      ctx.stroke()
    }

    // Draw nodes
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue
      const isHovered = hoveredNodeRef.current === node.id
      const r = isHovered ? 10 : 7

      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
      ctx.fillStyle = nodeColor(node.domain)
      ctx.fill()

      if (isHovered) {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2 / k
        ctx.stroke()

        // Label
        ctx.font = `${11 / k}px sans-serif`
        ctx.fillStyle = '#E3E2E2'
        ctx.textAlign = 'center'
        ctx.fillText(node.title || 'Sin título', node.x, node.y + (16 / k))
      }
    }

    ctx.restore()
  }, [])

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    canvas.width = w
    canvas.height = h

    // Update D3 center force dynamically on resize
    if (simulationRef.current) {
      const centerForce = simulationRef.current.force('center') as any
      if (centerForce) {
        centerForce.x(w / 2).y(h / 2)
      }
      simulationRef.current.alpha(0.3).restart()
    }
  }, [])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)

    const canvas = canvasRef.current
    const width = canvas ? canvas.width : 800
    const height = canvas ? canvas.height : 600

    const simulation = forceSimulation<GraphNode, GraphLink>(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(120))
      .force('charge', forceManyBody().strength(-300))
      .force('center', forceCenter(width / 2, height / 2))
      .force('x', forceX(width / 2).strength(0.08))
      .force('y', forceY(height / 2).strength(0.08))
      .force('collide', forceCollide(30))
      .on('tick', draw)

    simulationRef.current = simulation

    return () => {
      simulation.stop()
      window.removeEventListener('resize', resize)
    }
  }, [nodes, links, draw, resize])

  const getNodeAt = useCallback((px: number, py: number): GraphNode | null => {
    const { x: tx, y: ty, k } = transformRef.current
    const canvas = canvasRef.current
    if (!canvas) return null

    const wx = (px - tx) / k
    const wy = (py - ty) / k

    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue
      const dx = wx - node.x
      const dy = wy - node.y
      if (dx * dx + dy * dy < 144) return node // 12px radius
    }
    return null
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const px = e.clientX - rect.left
    const py = e.clientY - rect.top

    if (draggingRef.current) {
      const { node, dx, dy } = draggingRef.current
      const { x: tx, y: ty, k } = transformRef.current
      node.x = (px - tx) / k - dx
      node.y = (py - ty) / k - dy
      simulationRef.current?.alpha(0.3).restart()
      draw()
      return
    }

    const node = getNodeAt(px, py)
    const prev = hoveredNodeRef.current
    if (node?.id !== prev) {
      hoveredNodeRef.current = node?.id ?? null
      canvasRef.current!.style.cursor = node ? 'pointer' : 'grab'
      draw()
    }
  }, [getNodeAt, draw])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const node = getNodeAt(px, py)

    if (node) {
      const { x: tx, y: ty, k } = transformRef.current
      draggingRef.current = {
        node,
        dx: (px - tx) / k - (node.x ?? 0),
        dy: (py - ty) / k - (node.y ?? 0),
      }
      canvasRef.current!.style.cursor = 'grabbing'
    }
  }, [getNodeAt])

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null
    if (canvasRef.current) {
      canvasRef.current.style.cursor = hoveredNodeRef.current ? 'pointer' : 'grab'
    }
  }, [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const node = getNodeAt(px, py)
    if (node) onNodeClick(node.id)
  }, [getNodeAt, onNodeClick])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    const t = transformRef.current

    const newK = Math.max(0.2, Math.min(4, t.k * factor))
    t.x = px - (px - t.x) * (newK / t.k)
    t.y = py - (py - t.y) * (newK / t.k)
    t.k = newK

    draw()
  }, [draw])

  // Pan by dragging background
  const panRef = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null)

  const handlePanStart = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const node = getNodeAt(px, py)
    if (node) return // don't pan when clicking on node

    panRef.current = {
      startX: px,
      startY: py,
      startTx: transformRef.current.x,
      startTy: transformRef.current.y,
    }
    canvasRef.current!.style.cursor = 'grabbing'
  }, [getNodeAt])

  const handlePanMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panRef.current) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      transformRef.current.x = panRef.current.startTx + (px - panRef.current.startX)
      transformRef.current.y = panRef.current.startTy + (py - panRef.current.startY)
      draw()
    }
  }, [draw])

  const handlePanEnd = useCallback(() => {
    panRef.current = null
    if (canvasRef.current) {
      canvasRef.current.style.cursor = hoveredNodeRef.current ? 'pointer' : 'grab'
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full touch-none"
      style={{ cursor: 'grab', background: '#0B0B0C' }}
      onMouseMove={(e) => {
        handleMouseMove(e)
        handlePanMove(e)
      }}
      onMouseDown={(e) => {
        handleMouseDown(e)
        handlePanStart(e)
      }}
      onMouseUp={() => {
        handleMouseUp()
        handlePanEnd()
      }}
      onMouseLeave={() => {
        handleMouseUp()
        handlePanEnd()
      }}
      onClick={handleClick}
      onWheel={handleWheel}
    />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MentePage() {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [noteDetail, setNoteDetail] = useState<NoteItem | null>(null)

  const loadGraph = useCallback(async () => {
    try {
      const res = await fetch('/api/graph')
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()
      setGraphData(json)
    } catch {
      setError('No se pudo cargar el grafo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGraph()
  }, [loadGraph])

  // When a node is clicked, fetch full note details
  const handleNodeClick = useCallback(async (id: string) => {
    if (selectedNoteId === id && noteDetail) return
    setSelectedNoteId(id)
    try {
      const res = await fetch(`/api/notes/${id}`)
      if (!res.ok) throw new Error('Failed to load note')
      const json = await res.json()
      setNoteDetail(json)
    } catch {
      setNoteDetail(null)
    }
  }, [selectedNoteId, noteDetail])

  const handleClosePanel = useCallback(() => {
    setSelectedNoteId(null)
    setNoteDetail(null)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#5A5A5A] text-sm animate-pulse">Cargando grafo…</div>
      </div>
    )
  }

  if (error || !graphData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="border border-graphite-border bg-graphite-card px-4 py-3 text-sm text-[#E3E2E2]">
          {error ?? 'Error desconocido.'}
        </div>
      </div>
    )
  }

  const { nodes, links } = graphData

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Header overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 p-6 pointer-events-none">
        <div className="flex items-center gap-3">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#A68966" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="2" />
            <circle cx="6" cy="6" r="1.5" />
            <circle cx="18" cy="6" r="1.5" />
            <circle cx="6" cy="18" r="1.5" />
            <circle cx="18" cy="18" r="1.5" />
            <line x1="10" y1="10.5" x2="7.5" y2="7.5" />
            <line x1="14" y1="10.5" x2="16.5" y2="7.5" />
            <line x1="10" y1="13.5" x2="7.5" y2="16.5" />
            <line x1="14" y1="13.5" x2="16.5" y2="16.5" />
          </svg>
          <h1 className="font-serif text-2xl text-[#E3E2E2]">Mente</h1>
        </div>
        <p className="text-[11px] tracking-[0.15em] uppercase text-[#5A5A5A] mt-1 ml-1">
          {nodes.length} nodos · {links.length} vínculos
        </p>
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-6 z-10 bg-graphite-card/90 backdrop-blur-sm border border-graphite-border px-4 py-3 pointer-events-none">
        <p className="text-[10px] tracking-[0.15em] uppercase text-[#5A5A5A] mb-2">Dominios</p>
        <div className="space-y-1">
          {Object.entries(DOMAIN_COLORS).map(([domain, color]) => (
            <div key={domain} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[11px] text-[#A1A1AA]">
                {domain === 'ESPIRITUAL' ? 'Espiritual' :
                 domain === 'PERSONAL' ? 'Personal' :
                 domain === 'APRENDIZAJE' ? 'Aprendizaje' :
                 domain === 'PROYECTOS' ? 'Proyectos' : 'Registros'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Graph */}
      <GraphCanvas
        nodes={nodes as GraphNode[]}
        links={links as GraphLink[]}
        onNodeClick={handleNodeClick}
      />

      {noteDetail && (
        <NotePanel
          note={noteDetail}
          onClose={handleClosePanel}
          onUpdate={(updated) => {
            setNoteDetail(updated)
            loadGraph()
          }}
          onDelete={() => {
            setNoteDetail(null)
            loadGraph()
          }}
        />
      )}
    </div>
  )
}
