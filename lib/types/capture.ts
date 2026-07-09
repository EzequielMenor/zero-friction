// Tipos para el flujo de captura.

export interface CaptureInput {
  text?: string
  content?: string
}

/** Resultado de parsear una captura con IA. */
export interface ParsedCapture {
  title?: string
  domain: string
  tags: string[]
  isExecutable: boolean
  dueDate?: string | null
  isImportant?: boolean
  recordType?: string
}
