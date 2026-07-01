// Predicado puro: ¿este Note es una tarea (accionable) o una nota (reflexión)?
// Usado por el editor, las listas de hubs y el endpoint /api/today.

export type TaskLikeNote = {
  dueDate: string | Date | null
  isImportant: boolean
  status: string
}

export function isTask(n: TaskLikeNote): boolean {
  if (n.dueDate) return true
  if (n.isImportant) return true
  if (n.status === 'ACTIVE' || n.status === 'IN_PROGRESS') return true
  return false
}
