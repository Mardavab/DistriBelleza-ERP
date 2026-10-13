# .opencode/

Configuración específica de OpenCode para este proyecto (DistriBelleza / GlowCosmetics).

## Carpetas

- **agents/**: Sub-agents personalizados para este proyecto. Cada `.md` define un agente con frontmatter (`mode`, `model`, `temperature`, `permission`) y prompt de sistema.
- **commands/**: Slash commands personalizados del proyecto. Vacío por ahora.
- **skills/**: Skills específicas del proyecto. Vacío por ahora.

## Equipo de agentes

| Agente | Modo | Modelo | Temperatura | Rol |
|---|---|---|---|---|
| `orquestador` | primary | `kimi-k3` | 0.2 | Planifica y delega. No escribe código. |
| `implementador` | subagent | `glm-5.2` | 0.2 | Escribe código y SQL de migraciones (sin aplicar). |
| `auditor` | subagent | `qwen3.7-max` | 0.1 | Revisa el diff (calidad + seguridad multi-tenant). Solo lectura. |
| `tester` | subagent | `minimax-m3` | 0.1 | Escribe y ejecuta pruebas Jest/Playwright. |
| `documentador` | subagent | `deepseek-v4-flash` | 0.3 | Actualiza docs/README/migraciones. Solo `.md` y `docs/`. |

## Flujo

```
orquestador (planifica) → implementador → tester → auditor → [corrección, máx. 2 ciclos] → documentador
```

## Uso

1. Abrir OpenCode en la raíz del repo y seleccionar `orquestador` con **Tab**.
2. Pedir la tarea (ej. "Añade filtro por categoría en el inventario").
3. Para llamar a un agente concreto: `@auditor revisa los cambios actuales`.

## Seguridad del flujo

- Ningún agente hace `commit`/`push` (subir = desplegar a producción). Tú revisas `git diff` y subes.
- Ningún agente lee `.env*` ni ejecuta `psql`/`supabase`. Las migraciones se generan como archivos SQL con su `RK_*`; las aplica el usuario a mano.
- `test:e2e:full` (backend real) está bloqueado para el `tester`.
- `*.env*` siempre denegado en permisos de lectura.

## Notas

- `opencode.json` permanece en la raíz del repo (config MCP de Supabase). Esta carpeta es para extensiones locales.
- Para ajustar permisos o comportamiento, edita el frontmatter YAML de cada agente. Reinicia la sesión de OpenCode para que tome los cambios.
