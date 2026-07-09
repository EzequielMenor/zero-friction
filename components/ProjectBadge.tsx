// Badge de proyecto — informativo, no clickeable en MVP (D7).
// Si project es null, no renderiza nada.

interface Props {
  project: { id: string; name: string; status: string } | null
}

const STATUS_STYLES: Record<string, string> = {
  IDEATION:    'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  ACTIVE:      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  MAINTENANCE: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ARCHIVED:    'bg-gray-300 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export default function ProjectBadge({ project }: Props) {
  if (!project) return null

  const truncated = project.name.length > 20
    ? project.name.slice(0, 20) + '…'
    : project.name

  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${STATUS_STYLES[project.status]}`}
      title={`${project.name} · ${project.status}`}
      role="status"
      aria-label={`Proyecto: ${project.name}, estado ${project.status}`}
    >
      {truncated}
    </span>
  )
}
