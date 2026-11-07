# Plataforma de finanzas personales (web y PWA)

Aplicación web y PWA móvil orientada a registrar ingresos y gastos (manualmente, por foto de ticket o por dictado de voz), operar sin conexión con sincronización diferida y transformar el historial confirmado en presupuestos ajustables, detección de gastos hormiga y planes de ahorro en siete cuentas virtuales.

## Estado

El proyecto se encuentra en fase de definición. Este repositorio contiene únicamente la documentación de producto y arquitectura; todavía no existe implementación ni configuración ejecutable.

## Decisión principal

La solución comenzará como un **monolito modular con Clean Architecture y principios SOLID**, desplegado inicialmente sobre servicios con **capa gratuita generosa (free tier)** para validar el MVP con baja complejidad operativa (menos de 20 usuarios). El dominio permanece desacoplado mediante puertos y adaptadores para escalar en una segunda etapa a **AWS** o extraer microservicios solo cuando las métricas lo justifiquen.

## Capacidades del MVP

- **Espacio financiero aislado (workspace)** para cada usuario autenticado.
- **Autenticación flexible:** usuario y contraseña, proveedores sociales (Google, Facebook, etc.) y passkeys.
- **Registro multicanal de ingresos y gastos:** carga manual, fotografía o subida de tickets de consumo (OCR) y dictado por micrófono (voz a texto).
- **Retención acotada de medios:** imágenes y audios disponibles por un **máximo de 30 días**, con eliminación automática al vencer o borrado anticipado por la persona.
- **PWA con soporte offline:** almacenamiento local (IndexedDB) para consulta sin conexión y **cola local de sincronización** para registros manuales, imágenes y audios capturados sin red.
- **Clasificación por categorías:** catálogo inicial (Hogar, Comida, Transporte, Salud, Sueldo, etc.) y categorías personalizadas por usuario.
- **Sugerencia de ahorro y 7 cuentas virtuales:** cuando `Ingresos > Gastos`, sugerencia de porcentaje de ahorro mensual (referencia inicial 10% de los ingresos) distribuido en la Cuenta Corriente (ingresos restantes) y 6 cuentas de ahorro con porcentajes ajustables:
  1. Cuenta Corriente — ingresos operativos no asignados al ahorro.
  2. Cuenta Independencia Financiera — 40% del ahorro; capital de largo plazo cuyos intereses pueden consumirse.
  3. Cuenta Millonaria — 30% del ahorro; proyecto o negocio.
  4. Cuenta Año Sabático — 10% del ahorro; descanso o experiencia planificada.
  5. Cuenta de las Compras Grandes — 10% del ahorro; compras al contado y metas concretas.
  6. Cuenta de Generosidad — 5% del ahorro; regalar dinero o donaciones.
  7. Cuenta Impuestos — 5% del ahorro; obligaciones fiscales estimadas. Los gastos imprevistos se cubren por el concepto separado de fondo de emergencia.
- **Reportes, gastos hormiga y presupuestos:** historial de ingresos y gastos, detección de gastos pequeños y repetitivos, presupuestos ajustables por categoría con seguimiento de ejecución, y exportación de reportes en **`.csv` y `.xlsx`**.
- **Modo demo temporal:** usuario demo que inicia sesión con datos semilla precargados; los cambios realizados durante la sesión **no persisten** y se descartan al cerrar sesión, cerrar la aplicación o tras **10 minutos de inactividad**.

## Principios del producto

1. **Aislamiento por workspace.** Cada usuario autenticado opera únicamente sobre su propio espacio financiero.
2. **La persona confirma.** Ninguna inferencia de OCR o voz ni una sincronización diferida altera los reportes como transacción confirmada sin validación.
3. **Las recomendaciones se explican.** Cada sugerencia de ahorro, alerta de presupuesto o detección de gasto hormiga expone los datos y reglas aplicadas.
4. **Privacidad y retención máxima de 30 días.** Imágenes y audios caducan como máximo a los 30 días sin afectar las transacciones confirmadas.
5. **Offline-first pragmático en móvil.** La PWA permite registrar movimientos, fotos y audios sin conexión y los sincroniza de forma idempotente al recuperar red.
6. **Simplicidad en etapa 1, escalabilidad en etapa 2.** Sin sobreingeniería inicial (sin Redis, Kubernetes ni microservicios prematuros en el MVP), pero con contratos listos para migrar a AWS.

## Stack de referencia (etapa 1 — MVP free tier / etapa 2 — producción AWS)

| Capa | Etapa 1: MVP (free tier, <20 usuarios) | Etapa 2: producción y escalado (AWS) |
|---|---|---|
| Web y PWA | TypeScript, React, Vite, Material UI, Recharts, Workbox + IndexedDB (Dexie), alojado en **Vercel free** | Amazon S3 + CloudFront |
| API y worker | Node.js LTS, Hono (API REST + worker en un proceso), alojado en **Render / Koyeb free** | AWS ECS Fargate / App Runner (API y worker separados) |
| Base de datos | **Supabase PostgreSQL** (free tier) + Drizzle ORM como adaptador | Amazon RDS / Aurora PostgreSQL |
| Cola asíncrona | **pg-boss** sobre el mismo PostgreSQL (sin Redis en el MVP) | Amazon SQS o BullMQ sobre Amazon ElastiCache (Redis) |
| Archivos | **Supabase Storage** (API S3-compatible, privado, ciclo de vida ≤30 días) | Amazon S3 con políticas de ciclo de vida |
| Identidad | **Supabase Auth** (email/contraseña, Google, Facebook, passkeys; OIDC) | Amazon Cognito o proveedor OIDC dedicado |
| OCR y voz | **Azure AI Document Intelligence** y **Azure AI Speech** (capa gratuita F0) | Azure en plan estándar o Amazon Textract / Transcribe |
| Exportación | Reportes en **`.csv` y `.xlsx`** (ExcelJS) | Procesamiento asíncrono en worker dedicado si crece el volumen |

La justificación técnica del stack, la comparación entre TypeScript, Python y Go y la ruta de migración se detallan en [Stack tecnológico](docs/02-stack-tecnologico.md).

## Recorrido recomendado

1. [Requisitos del producto](docs/01-requisitos-producto.md): alcance funcional, PWA offline, 7 cuentas, presupuestos, exportación y modo demo.
2. [Stack tecnológico](docs/02-stack-tecnologico.md): elección de herramientas free tier, justificación de lenguaje y evolución a AWS.
3. [Arquitectura de solución](docs/03-arquitectura-solucion.md): Clean Architecture, principios SOLID, módulos, sincronización offline y flujos.
4. [Modelo de dominio financiero](docs/04-modelo-dominio-financiero.md): categorías, presupuestos, ahorro, 7 cuentas virtuales y gastos hormiga.
5. [Seguridad y privacidad](docs/05-seguridad-privacidad.md): amenazas, OAuth social y passkeys, almacenamiento local en PWA y retención máxima de 30 días.
6. [Roadmap y validación](docs/06-roadmap-validacion.md): fases de entrega, pruebas y criterios de aceptación.

## Límites explícitos del MVP

- Cada usuario registrado tiene un único espacio financiero personal; no hay cuentas familiares compartidas ni permisos multiusuario.
- Las siete cuentas son particiones virtuales de planificación; no son cuentas bancarias reales ni mueven dinero.
- No hay conexión bancaria automática (open banking), pagos ni transferencias.
- Las imágenes y audios se conservan como máximo 30 días desde su captura; la persona puede borrarlos antes sin perder la transacción confirmada.
- No se requiere un LLM para clasificar movimientos, ajustar presupuestos ni recomendar ahorro.
- En el modo demo, cualquier modificación vive únicamente durante la sesión activa y se descarta al cerrar sesión, cerrar la aplicación o cumplir 10 minutos de inactividad.
