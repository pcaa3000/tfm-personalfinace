# Plataforma de finanzas personales

Aplicación web orientada a registrar ingresos y gastos, convertir tickets y dictados en transacciones revisables y transformar el historial confirmado en recomendaciones financieras explicables.

## Estado

El proyecto se encuentra en fase de definición. Este repositorio contiene únicamente la documentación de producto y arquitectura; todavía no existe implementación ni configuración ejecutable.

## Decisión principal

La solución comenzará como un **monolito modular con Clean Architecture**, no como un conjunto de microservicios. El frontend, la API y el worker de procesamiento serán desplegables independientes, pero los módulos de negocio permanecerán juntos hasta que el escalado, el aislamiento de fallos o la organización del equipo justifiquen una extracción.

Esta decisión reduce coste y complejidad sin cerrar la evolución futura.

## Capacidades del MVP

- Un workspace financiero personal y aislado para cada usuario registrado.
- Registro manual de ingresos y gastos.
- Captura de tickets desde cámara o almacenamiento local.
- Dictado de movimientos mediante micrófono.
- Conversión de OCR y voz en borradores que la persona usuaria debe confirmar.
- Retención común de tickets y audios configurable durante 1, 2 o 3 meses.
- Categorías predeterminadas, personalizadas y sugeridas mediante reglas explicables.
- Reportes por período y moneda.
- Detección configurable de gastos pequeños y repetitivos.
- Recomendación de ahorro tras un período mensual cerrado.
- Siete bolsillos virtuales con distribución adaptable del ahorro.
- Usuario demo con datos sintéticos reiniciados en cada nueva sesión.

## Principios del producto

1. **Aislamiento por workspace.** La identidad autenticada determina un único contexto financiero; ningún recurso cruza su frontera.
2. **La persona confirma.** Ninguna inferencia externa se convierte automáticamente en una transacción válida.
3. **Las recomendaciones se explican.** Cada sugerencia muestra los datos, reglas, supuestos y nivel de confianza utilizados.
4. **Privacidad por defecto.** Imágenes, audios y datos financieros tienen minimización, retención y eliminación explícitas.
5. **Internacional desde el dominio.** Moneda, idioma, configuración regional, zona horaria y fecha de negocio no son detalles de presentación.
6. **Demo honesta y reproducible.** Los resultados simulados se identifican como tales y una nueva sesión recupera la semilla original.
7. **Escalado con evidencia.** No se introducen microservicios, Kubernetes o streaming distribuido antes de necesitarlos.

## Stack de referencia

| Capa | Tecnología propuesta |
|---|---|
| Web | TypeScript, React, Vite, Material UI, Recharts |
| API | Node.js LTS, NestJS, REST y OpenAPI |
| Datos | PostgreSQL y Prisma como adaptador |
| Trabajos | BullMQ y Redis persistente |
| Archivos | Almacenamiento compatible con S3; MinIO en local |
| Identidad | OpenID Connect; Keycloak como referencia |
| OCR | Azure AI Document Intelligence mediante un puerto sustituible |
| Voz | Azure AI Speech mediante un puerto sustituible |
| Observabilidad | Logs estructurados y OpenTelemetry |

La selección completa, sus límites y alternativas están en [Stack tecnológico](docs/02-stack-tecnologico.md).

## Recorrido recomendado

1. [Requisitos del producto](docs/01-requisitos-producto.md): qué debe resolver el sistema y qué queda fuera.
2. [Stack tecnológico](docs/02-stack-tecnologico.md): tecnologías, responsabilidades y decisiones.
3. [Arquitectura de solución](docs/03-arquitectura-solucion.md): módulos, capas, flujos y evolución.
4. [Modelo de dominio financiero](docs/04-modelo-dominio-financiero.md): conceptos, invariantes y recomendaciones.
5. [Seguridad y privacidad](docs/05-seguridad-privacidad.md): amenazas, controles y tratamiento de datos.
6. [Roadmap y validación](docs/06-roadmap-validacion.md): orden de entrega, pruebas y puertas de salida.

## Límites explícitos del MVP

- Cada usuario registrado tiene un solo workspace personal; no hay colaboración, miembros ni múltiples workspaces.
- Los siete bolsillos son una simulación de planificación; no son cuentas bancarias reales.
- No hay conexión bancaria, open banking, pagos, transferencias ni custodia de fondos.
- No se mezclan importes de monedas distintas sin una conversión explícita y trazable.
- No se ofrece asesoramiento financiero, fiscal, legal ni de inversión profesional.
- No se usa un LLM como requisito para clasificar movimientos o recomendar ahorro.
- Los servicios de OCR y voz pueden degradar a revisión o entrada manual cuando fallen o alcancen su cuota.
- La cuenta demo usa credenciales compartidas, pero cada sesión recibe un workspace efímero independiente.
- En demo, cámara y micrófono permanecen en el navegador; la extracción es simulada, visible y nunca se envía a Azure.
