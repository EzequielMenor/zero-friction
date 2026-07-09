# Refactor Note → Note + Task — Archive

## Estado
- **Producción**: ✅ validado (tsc, prisma, greps)
- **Tests**: ⚠️ pendientes (ver TODOs)

## Artefactos
- [ADR](ADR.md) — Decisión arquitectónica
- [Spec](spec.md) — Contrato mínimo
- [Deep Think](deep-think.md) — Análisis pre-codebase
- [Design](design.md) — Diseño de arquitectura
- [Tasks](tasks.md) — Descomposición en tareas
- [Apply Progress](apply-progress.md) — Progreso de implementación
- [Fixes Applied](fixes-applied.md) — Correcciones post-judge review
- [Test Report](test-report.md) — Reporte de tests
- [Verify Report](verify-report.md) — Verificación final

## TODOs
1. Configurar `test-setup.ts` con `setupAuthMocks`/`createParams`
2. Implementar 6 test files faltantes (backfill, dashboard, process, parse-capture, snapshots)
3. Aplicar Migration A + backfill + Migration B en staging con snapshot pre-deploy

## Pipeline
`brain-deep-think → brain-spec → brain-design → brain-tasks → brain-apply → brain-test → brain-archive` ✅
