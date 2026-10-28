# Roadmap y estrategia de validación

La implementación futura se organizará en entregas verticales verificables. Primero se construye un libro manual fiable; después se conectan tickets y voz al mismo flujo; finalmente se añaden análisis y planificación. Ninguna fase necesita microservicios para considerarse completa.

## Resultado esperado

Al terminar el MVP, una persona podrá:

1. Autenticarse y configurar su contexto internacional.
2. Registrar y revisar ingresos/gastos por tres canales.
3. Comprender qué movimientos forman cada reporte.
4. Recibir una recomendación explicable después de un mes completo.
5. Ajustar seis destinos de ahorro y conservar la cuenta corriente virtual.
6. Identificar patrones de gastos pequeños y repetitivos.
7. Exportar o eliminar sus datos y revocar proveedores.

## Principios de entrega

- **Cortes verticales:** interfaz, caso de uso, dominio, persistencia, seguridad y pruebas se entregan juntos.
- **Manual antes que IA:** OCR y voz reutilizan el flujo manual; no crean un segundo libro de transacciones.
- **Fallo visible:** toda dependencia externa tiene timeout, estado y alternativa manual.
- **Seguridad continua:** autorización, retención y consentimiento no se posponen a la última fase.
- **Contratos antes que integración:** web, API, módulos y proveedores se conectan mediante interfaces verificadas.
- **Datos sintéticos:** ningún entorno de desarrollo o CI necesita información financiera real.
- **Sin fechas inventadas:** cada fase termina cuando cumple su puerta de salida, no por calendario.
- **Sin microservicios prematuros:** primero se miden API, worker, cola y base dentro del diseño modular.

## Definición de preparado

Una unidad de trabajo está preparada cuando dispone de:

- Requisito y criterio de aceptación identificados.
- Actor, resultado y fuera de alcance claros.
- Invariantes del dominio afectadas.
- Contrato de entrada/salida y errores relevantes.
- Amenazas, autorización, retención y datos sensibles evaluados.
- Estrategia de prueba y fixtures.
- Comportamiento ante fallo o cuota agotada.
- Métricas y logs necesarios sin contenido sensible.
- Límite de rollback conocido.

## Definición de terminado

Una unidad solo está terminada cuando:

- El comportamiento funcional y sus errores cumplen criterios de aceptación.
- Las pruebas unitarias, integración, contrato y experiencia aplicables pasan.
- La autorización negativa está probada, no solo el camino feliz.
- Reintentos y duplicados no cambian el resultado.
- Accesibilidad e internacionalización del flujo están verificadas.
- No existen dependencias prohibidas por Clean Architecture.
- Telemetría, cuota y fallback están presentes cuando hay proveedor externo.
- Migración y rollback son compatibles con datos existentes.
- Documentos y contrato público reflejan el comportamiento.
- La revisión puede comprender el cambio como una unidad independiente.

## Fase 0 — Fundamentos verificables

### Objetivo

Preparar el entorno y las fronteras que impiden que la implementación se convierta en un monolito acoplado.

### Unidades de trabajo

1. Inicializar repositorio y workspace con web (PWA) y API+worker como builds independientes.
2. Establecer módulos, capas, reglas de importación y revisión de principios SOLID.
3. Preparar configuración por entorno y gestión externa de secretos.
4. Incorporar PostgreSQL reproducible en local (o el proyecto Supabase gratuito), pg-boss y un adaptador de objetos compatible con Supabase Storage.
5. Preparar adaptadores simulados de identidad, OCR y voz para pruebas.
6. Definir contrato HTTP inicial, errores, correlación e idempotencia.
7. Preparar la base PWA: service worker (Workbox) e IndexedDB (Dexie) para la cola local.
8. Activar lint, typecheck, pruebas, escaneo de dependencias y builds en CI.
9. Crear fixtures sintéticas para monedas, zonas horarias, tickets y audios.

### No incluido

- Pantallas completas.
- Integración real con Azure.
- Recomendaciones financieras.
- Despliegue Kubernetes o cloud complejo.

### Puerta de salida

- Web y el proceso API+worker pueden construirse y verificarse por separado.
- Una prueba de arquitectura detecta imports prohibidos.
- PostgreSQL con pg-boss y el adaptador de objetos pueden reiniciarse sin perder el estado que declaradamente debe ser durable.
- La cola local de la PWA persiste recargas y se vacía correctamente.
- Ningún secreto es necesario para ejecutar pruebas ordinarias.
- El contrato de API tiene versionado y validación automática.
- Las fixtures no contienen datos personales reales.

## Fase 1 — Identidad, perfil y libro manual

### Objetivo

Entregar el núcleo financiero sin depender de OCR o voz.

### Unidades de trabajo

1. Integrar OIDC mediante Supabase Auth: usuario/contraseña, al menos un proveedor social (Google o Facebook) y passkey; validación de tokens y aprovisionamiento por issuer–subject.
2. Crear workspace con idioma, locale, zona horaria y moneda predeterminada.
3. Crear el catálogo inicial de categorías (Hogar, Comida, Transporte, Salud, Sueldo, etc.) y categorías personalizadas.
4. Registrar ingresos y gastos manuales con dinero exacto y fecha de negocio.
5. Implementar la cola local de la PWA y el endpoint de sincronización idempotente para registros manuales.
6. Listar, buscar, filtrar, editar y anular movimientos.
7. Conservar revisiones, origen e idempotencia.
8. Aplicar autorización por workspace en caso de uso y repositorio.
9. Añadir tabla accesible y estados vacíos/error.

### Requisitos cubiertos

- RF-001 a RF-016.
- RF-100 a RF-102 y RF-104 (cola offline de registros manuales).
- Base de RF-040, RF-041 y RF-044.
- RN-001 a RN-005 y RN-019.
- RNF-001 a RNF-006, RNF-009, RNF-010, RNF-014, RNF-018 y RNF-021.

### Validación

- Casos unitarios para dinero, moneda, fechas, estados y revisiones.
- Integración real con PostgreSQL.
- Contratos HTTP y cliente web.
- Pruebas de dos workspaces intentando acceder al mismo ID.
- Login por usuario/contraseña, proveedor social y passkey resolviendo el mismo workspace.
- Registro manual creado sin conexión, encolado y sincronizado una sola vez.
- Navegación completa por teclado y lector de pantalla en alta manual.
- Casos con EUR, USD, JPY y BHD para escala y presentación.
- Cambio de zona horaria que no altera el mes histórico.

### Puerta de salida

- CA-001 y CA-005 completos.
- Una petición repetida devuelve la misma transacción.
- Solo confirmado participa en una consulta de resumen básica.
- Editar/anular deja revisión y no rompe propiedad.
- No existe acceso a Prisma desde dominio/aplicación.

## Fase 2 — Tickets, archivos y OCR

### Objetivo

Convertir una imagen de ticket en un borrador revisable utilizando el mismo caso de uso de confirmación del Libro.

### Unidades de trabajo

1. Crear activo, captura, borrador y estados canónicos.
2. Autorizar subida firmada contra Supabase Storage, finalizar por checksum y aplicar cuotas.
3. Implementar cuarentena, tipo real, límites, normalización y eliminación de EXIF/GPS (escaneo de malware diferido a etapa 2).
4. Implementar encolado transaccional con pg-boss y reconciliación de jobs estancados.
5. Admitir imágenes encoladas offline en la PWA que entran en este flujo al sincronizar.
6. Procesar primero con un adaptador OCR determinista.
7. Integrar Azure Document Intelligence (capa F0) como adaptador opt-in.
8. Normalizar campos y confianza sin exponer tipos del proveedor.
9. Presentar revisión, corrección, confirmación, descarte y ruta manual.
10. Aplicar consentimiento y ciclo de vida de imágenes a 30 días.
11. Añadir métricas de cola, latencia, error, cuota y coste.

### Requisitos cubiertos

- RF-020 a RF-029.
- RF-070, RF-071 y RF-075 a RF-077 para imágenes.
- RF-100 a RF-105 para capturas de imagen encoladas offline.
- RN-006, RN-012, RN-017 y RN-019.
- RNF-003 a RNF-005, RNF-008, RNF-011 a RNF-017 y RNF-021.

### Validación

- Imágenes válidas, corruptas, sobredimensionadas, con MIME falso y con metadatos de ubicación.
- Fallos de almacenamiento antes y después de finalizar subida.
- Caída del proceso API+worker tras confirmar la transacción PostgreSQL que encoló el job; el job persiste y se retoma.
- Job ejecutado dos veces y respuesta de proveedor duplicada.
- Timeout, rate limit, error permanente y cuota agotada.
- Campos con confianza desconocida, baja y contradictoria.
- Confirmación simultánea desde dos pestañas.
- Eliminación de imagen dentro de sus 30 días conservando la transacción.
- Consentimiento rechazado y revocado.
- Pruebas de contrato Azure acotadas y separadas de CI ordinaria.

### Puerta de salida

- CA-002, CA-004, CA-011 y CA-012 completos para tickets.
- Un activo no validado nunca llega a OCR.
- Una captura origina como máximo una transacción.
- Desarrollo y CI funcionan sin Azure.
- La respuesta bruta del proveedor no cruza al dominio.
- La expiración a 30 días se puede demostrar con reloj controlado.

## Fase 3 — Voz e interpretación

### Objetivo

Transformar un clip corto en un borrador sin grabación continua, biometría ni dependencia de un LLM.

### Unidades de trabajo

1. Solicitar permiso y controlar inicio, parada, reproducción y descarte.
2. Subir audio privado con duración y tamaño acotados.
3. Normalizar formato en worker con límites de recursos.
4. Procesar primero con transcripciones deterministas de prueba.
5. Integrar Azure AI Speech como adaptador opt-in.
6. Crear analizador sensible a locale para español e inglés.
7. Asociar evidencia textual a tipo, importe, moneda, fecha, comercio y categoría.
8. Mantener campos dudosos vacíos y presentar confirmación explícita.
9. Aplicar consentimiento, borrado de audio dentro de su ventana de 30 días y fallback manual.
10. Medir precisión por campo, idioma y condición de audio.

### Requisitos cubiertos

- RF-030 a RF-037.
- RF-070 y RF-071 para voz.
- RN-006 y RN-012.
- RNF-003 a RNF-005, RNF-008, RNF-011 a RNF-017.

### Validación

- Permiso concedido, denegado y revocado durante una captura.
- Navegador sin API de micrófono.
- Clips vacíos, con ruido, formato no soportado, más de 60 segundos o más de 10 MB.
- Dictados completos, parciales y ambiguos en español e inglés.
- Importe con coma/punto decimal, moneda explícita/omitida y fecha relativa.
- Transcripción correcta con interpretación incompleta.
- Reintento, job duplicado y dos confirmaciones simultáneas.
- Eliminación del audio dentro de su ventana.
- Cuota agotada con texto manual reutilizable.
- Audio grabado sin conexión encolado en la PWA y procesado al sincronizar.

### Puerta de salida

- CA-003, CA-004, CA-011 y CA-012 completos para voz.
- Ningún campo sin evidencia se inventa.
- El audio se elimina a los 30 días de su captura o antes, por borrado anticipado.
- No hay voiceprint, clasificación de hablante ni grabación en segundo plano.
- Desarrollo y CI funcionan sin Azure.

## Fase 4 — Categorización, reportes e insights

### Objetivo

Convertir movimientos confirmados en reportes navegables y patrones accionables sin mezclar monedas.

### Unidades de trabajo

1. Implementar reglas, alias de comercio y preferencias explícitas por workspace.
2. Publicar eventos del Libro y proyecciones idempotentes de Insights.
3. Mostrar reportes mensuales por moneda y naturaleza de categoría.
4. Añadir categorías, comercios, evolución y movimientos sin categorizar.
5. Implementar presupuestos por categoría, moneda y período con ejecución, umbrales de aviso y ajuste versionado.
6. Permitir navegación del agregado al detalle.
7. Implementar política versionada de gastos pequeños y repetitivos.
8. Añadir descarte/silencio de patrones y recálculo por revisión.
9. Ofrecer tablas equivalentes, exportación tabular en `.csv` y `.xlsx` y accesibilidad.
10. Medir latencia, lag de proyección y calidad del dato.

### Requisitos cubiertos

- RF-040 a RF-058.
- RF-090 a RF-094 (presupuestos).
- RN-009 a RN-012.
- RNF-007, RNF-009, RNF-010, RNF-013 y RNF-015.

### Validación

- Proyección recibe el mismo evento más de una vez y fuera de orden.
- Reportes de EUR y USD permanecen separados.
- Hasta 10.000 movimientos por perfil bajo la carga de referencia.
- Cambio de categoría o anulación invalida el agregado correcto.
- Primer mes, varios meses, mes vacío y mes con déficit.
- Gasto aislado pequeño frente a patrón que cumple todos los umbrales.
- Presupuesto dentro, al umbral y superado; ajuste versionado sin reescribir histórico.
- Ítem pendiente de sincronización que no consume presupuesto ni participa en reportes.
- Exclusiones esenciales/fiscales y decisión `No es gasto hormiga`.
- Gráficos comprendidos mediante tabla, teclado, lector y sin depender del color.

### Puerta de salida

- CA-006, CA-010 y CA-013 completos.
- Reporte p95 menor de 2 s en la carga definida.
- Cada cifra enlaza a revisiones de transacción.
- Un insight no cambia categorías, ahorro ni planes.
- El porcentaje sin categorizar es visible.

## Fase 5 — Cierre mensual, ahorro y siete particiones

### Objetivo

Generar una recomendación prudente, versionada y editable a partir de un snapshot cerrado.

### Unidades de trabajo

1. Cerrar y reabrir período mediante snapshots inmutables.
2. Calcular ingresos, gastos, excedente, margen y capacidad por moneda.
3. Aplicar objetivo de referencia del 10% limitado por capacidad.
4. Calcular confianza y mostrar factores.
5. Detectar anomalías e ingresos irregulares sin descartarlos.
6. Crear plantilla de una cuenta corriente y seis cuentas de ahorro: Independencia Financiera 40%, Millonaria 30%, Año Sabático 10%, Compras Grandes 10%, Generosidad 5% e Impuestos 5%.
7. Calcular porcentajes/importes, redondeo y residuo exactos.
8. Permitir renombrar, ordenar, desactivar, redistribuir y versionar.
9. Diferenciar Cuenta Impuestos (reserva fiscal declarada) del concepto de fondo de emergencia para imprevistos.
10. Obtener aceptación explícita del aviso informativo y del plan.

### Requisitos cubiertos

- RF-060 a RF-069.
- RN-007 a RN-009, RN-013 y RN-014.
- RNF-009, RNF-010, RNF-014 y RNF-018.

### Validación

- Mes parcial e íntegro.
- Cero ingresos, déficit, excedente menor o mayor que el objetivo.
- Un mes, tres meses y seis meses con distinta calidad/variabilidad.
- Más de 20%, 10% y 5% sin categorizar.
- Ingreso extraordinario y período omitido.
- JPY sin decimales y BHD con tres; residuo entre seis bolsillos.
- Suma de 99,99%, 100% y 100,01%.
- Fondo de emergencia como bolsillo reorientado, meta baja/alcanzada.
- Cuenta Impuestos sin declaración de ingreso no retenido, con tasa declarada y superior al máximo permitido.
- Revisión de una transacción después de aceptar un plan.

### Puerta de salida

- CA-007, CA-008 y CA-009 completos.
- Un mes siempre muestra confianza baja.
- Ningún ahorro supera capacidad ni genera cuenta corriente proyectada negativa.
- Los seis importes suman exactamente el ahorro.
- Cuenta Impuestos no se presenta como fondo de imprevistos ni como cálculo tributario; el concepto de emergencia permanece diferenciado.
- Cambiar una política no modifica planes históricos.

## Fase 6 — Derechos, endurecimiento y despliegue

### Objetivo

Cerrar controles transversales y demostrar una operación segura, reproducible y de bajo costo.

### Unidades de trabajo

1. Exportación JSON, CSV y XLSX, y paquete opcional de medios.
2. Borrado de activo, transacción y cuenta con estados y reconciliación.
3. Retención automática de medios a 30 días, objetos huérfanos y rotación de backups.
4. Modo demo completo: seed por sesión, no-persistencia de cambios, expiración por logout, cierre de aplicación o 10 minutos de inactividad, y limpieza de la cola local.
5. CSP, CORS, cabeceras, rate limits y revisión de errores/logs.
6. Pruebas de carga, accesibilidad y seguridad sobre todos los flujos.
7. Backups y restauración en entorno aislado (pg_dump programado en free tier).
8. Rotación de secretos y recuperación operativa.
9. Dashboards mínimos, alertas, presupuesto y kill switches.
10. Despliegues independientes de web y del proceso API+worker.
11. Revisión DPA, residencia, textos de consentimiento y aviso legal antes de piloto público.

### Requisitos cubiertos

- RF-072 a RF-077 y cierre de RF-070/RF-071.
- RF-080 a RF-088 (modo demo), RN-018 y RN-020.
- RNF-020.
- Todos los RNF, especialmente RNF-003, RNF-004, RNF-012, RNF-013 y RNF-016.

### Validación

- Exportación con moneda, fechas, zona, origen y revisiones.
- URL de exportación expirada o utilizada por otro perfil.
- Borrado en sistemas activos, objetos, colas y backups dentro de ventanas.
- Restore probado sin copiar datos a desarrollo.
- Escaneo de secreto y dependencia.
- Revisión automatizada y manual de logs prohibidos.
- Fallos de PostgreSQL (incluida la cola pg-boss), objetos, OIDC y proveedores.
- Consumo por usuario y global contra presupuestos.
- Pruebas WCAG 2.2 AA en flujos críticos.
- Carga de API, reporte y cola contra SLOs documentados.

### Puerta de salida

- CA-014 completo y todos los criterios de seguridad aprobados.
- Restauración y rotación de secretos tienen evidencia.
- No hay datos reales en fixtures o CI.
- El coste máximo de proveedores puede detenerse sin desplegar código.
- Web, API y worker se promueven/retroceden de forma independiente.
- Los textos públicos no afirman cumplimiento legal no evaluado.

## Estrategia de pruebas

### Distribución

| Nivel | Objetivo | Dependencias |
|---|---|---|
| Dominio | Invariantes de dinero, tiempo, ahorro, confianza, bolsillos e insights | Ninguna infraestructura |
| Casos de uso | Autorización, estados, idempotencia y puertos | Dobles deterministas |
| Arquitectura | Importaciones y APIs públicas de módulos | Análisis estático |
| Persistencia | Mapeos, transacciones, unicidad y migraciones | PostgreSQL efímero |
| Cola | Encolado transaccional, reintentos, duplicados y dead-letter | PostgreSQL efímero con pg-boss |
| Objetos | Firma, cuarentena, lifecycle y propiedad | Supabase Storage local o mock |
| Contrato HTTP | Compatibilidad API–cliente, errores y versiones | OpenAPI publicado |
| Componentes | Formularios, permisos, estados, foco y tablas | Navegador simulado/real |
| End-to-end | Flujos verticales completos | Entorno integrado con proveedores simulados |
| Proveedor | Normalización frente a respuestas reales representativas | Ejecución opt-in y cuota limitada |
| Seguridad | Autenticación, autorización, archivos, headers, secretos y logs | Entorno aislado |
| Rendimiento | API, reportes, cola y workers contra carga de referencia | Entorno reproducible |
| Recuperación | Backup, restore, jobs huérfanos y borrado | Entorno de recuperación aislado |

### Casos financieros obligatorios

- Importe mínimo, máximo y escala inválida por moneda.
- Redondeo positivo, residuo y suma exacta.
- Cero ingreso, déficit y margen superior al excedente.
- Un mes incompleto y uno completo.
- Anomalía e ingreso irregular.
- Transacción revisada después de proyectarse.
- Varias monedas sin agregado común.
- Cambio de zona horaria y límite de mes con horario de verano.
- Seis porcentajes fuera y dentro de 100%.
- Reserva fiscal sin tasa proporcionada.
- Gasto pequeño aislado, patrón válido, esencial y silenciado.

### Casos de fallo obligatorios

- Petición, evento, job y callback duplicados.
- Evento fuera de orden.
- Caída del proceso tras confirmar la transacción que encoló el job y antes de ejecutarlo.
- Caída del worker tras llamar al proveedor y antes de persistir.
- Respuesta tardía después de descartar captura.
- Archivo eliminado mientras espera trabajo.
- Token expirado o firmado por issuer distinto.
- Objeto firmado para otro propietario.
- Cuota y presupuesto agotados.
- Política de retención ejecutada dos veces.

## Datos de prueba

- Exclusivamente sintéticos o anonimizados de forma irreversible.
- Monedas con cero, dos y tres decimales.
- Locales español e inglés con coma y punto decimal.
- Zonas horarias con y sin horario de verano.
- Historias de uno, tres y seis meses.
- Ingresos regulares, irregulares, extraordinarios y meses con déficit.
- Tickets nítidos, inclinados, recortados, con bajo contraste y campos contradictorios.
- Audios cortos con ruido, pausas, moneda omitida y fechas relativas.
- Archivos corruptos y metadatos sensibles.
- Colas offline con varios ítems, reconexiones intermitentes y cierre de la app con pendientes.

Una fixture real solo puede incorporarse con autorización, eliminación irreversible de identidad y revisión específica. La vía normal es generar casos sintéticos.

## Entornos

| Entorno | Proveedores | Datos | Propósito |
|---|---|---|---|
| Local | Simulados por defecto | Sintéticos | Desarrollo reproducible |
| CI | Simulados y servicios efímeros | Sintéticos | Verificación determinista |
| Integración externa | Azure/OIDC opt-in | Fixtures aprobadas | Contrato y precisión |
| Preproducción | Configuración equivalente a producción | Sintéticos representativos | Seguridad, carga y operación |
| Producción/piloto | Proveedores aprobados | Datos personales consentidos | Uso real controlado |

Las credenciales y cuotas son distintas por entorno. Nunca se restaura producción sobre local o CI.

## Trazabilidad de aceptación

| Criterio | Fase principal | Evidencia requerida |
|---|---|---|
| CA-001 | 1 | E2E manual y consulta de reporte básico |
| CA-002 | 2 | E2E ticket con borrador no confirmado |
| CA-003 | 3 | E2E dictado ambiguo y revisión |
| CA-004 | 2 y 3 | Pruebas de duplicado en API, cola, job y confirmación |
| CA-005 | 1 y todas | Matriz negativa de autorización por recurso |
| CA-006 | 4 | Reporte multimoneda separado |
| CA-007 | 5 | Política de un mes con confianza baja |
| CA-008 | 5 | Escenario de déficit y ahorro 0% |
| CA-009 | 5 | Validación y redondeo de seis bolsillos |
| CA-010 | 4 | Casos aislado, patrón, exclusión y silencio |
| CA-011 | 2 y 3 | Timeout/cuota con fallback manual |
| CA-012 | 2 y 3 | Eliminación de medio conservando transacción |
| CA-013 | 4 y 5 | Auditoría WCAG de tabla/gráfico |
| CA-014 | 6 | Exportación interoperable verificada |
| CA-015 | 1 | Primer acceso crea workspace único |
| CA-016 | 2 | Expiración de medio a 30 días y borrado anticipado |
| CA-017 | 6 | Sesiones demo concurrentes aisladas |
| CA-018 | 6 | Demo descarta cambios por logout, cierre o 10 min de inactividad |
| CA-019 | 2 y 3 | Extracción demo simulada sin llamadas a Azure |
| CA-020 | 1 | Registro offline encolado y confirmado una sola vez |
| CA-021 | 2 y 3 | Medio encolado offline procesado al sincronizar |
| CA-022 | 6 | Archivos `.csv` y `.xlsx` verificados |
| CA-023 | 4 | Presupuesto con ejecución, umbral y ajuste versionado |
| CA-024 | 1 | Login por contraseña, social y passkey al mismo workspace |

## Puertas de publicación

### Demo académica

- Flujos CA-001 a CA-024 demostrables con datos sintéticos.
- Al menos una prueba opt-in de OCR y voz real, sin depender de ella para repetir la demo.
- Arquitectura, dominio y riesgos explicables desde esta documentación.
- Ningún secreto o dato personal en repositorio.

### Piloto cerrado

- Fase 6 completa.
- DPA, región y consentimiento revisados.
- Backup/restore, borrado y respuesta a incidentes ensayados.
- Presupuestos, alertas y kill switches activos.
- Monitoreo de errores y precisión con usuarios consentidos.

### Producción comercial

- Revisión legal por jurisdicción.
- SLOs y soporte operativo aprobados.
- Threat model actualizado con evidencia del piloto.
- Proveedor de identidad, residencia y retención acordes al riesgo real.
- No se promociona como herramienta regulada o asesoramiento sin autorización aplicable.

## Revisión de microservicios

No forma parte del MVP. Después del piloto se revisan métricas de [Arquitectura de solución](03-arquitectura-solucion.md):

- API p95 frente a 750 ms.
- Reporte p95 frente a 2 s y 10.000 movimientos.
- Espera p95 de cola frente a 2 s en carga objetivo.
- Proporción de recursos entre Captura y API.
- Presupuesto de errores compartido.
- Conflictos de despliegue y propiedad de equipo.
- Necesidad de aislamiento regulatorio.

Antes de extraer Captura se debe demostrar que escalar el worker no resuelve el problema. Antes de extraer Insights se deben probar índices, proyecciones y réplica de lectura. Superar un umbral abre una revisión; no automatiza una migración.

## Unidades de revisión y commits futuros

Cada cambio futuro se dividirá por comportamiento completo, no por tipo de archivo:

- Identidad y perfil utilizable.
- Alta manual completa con pruebas.
- Subida privada y lifecycle verificables.
- Pipeline OCR hasta borrador revisable.
- Dictado hasta borrador revisable.
- Reporte mensual navegable.
- Gasto hormiga explicable.
- Recomendación y siete particiones.
- Exportación/borrado y endurecimiento.

Cada unidad incluye pruebas y documentación del comportamiento. Si una revisión supera aproximadamente 400 líneas authored, se divide por flujo o capacidad; no se comprime ni se eliminan pruebas para encajar. Los commits utilizarán mensajes convencionales y no incluirán atribución de IA.

## Rollback

- Migraciones son compatibles hacia atrás durante la ventana de despliegue.
- Nuevos campos comienzan opcionales y se completan antes de exigirlos.
- Integraciones externas tienen feature flag y kill switch.
- Web evita depender de una ruta hasta que la API compatible esté promovida.
- Un adaptador nuevo puede volver al anterior sin reinterpretar datos históricos.
- Una política financiera nueva crea versión; desactivarla conserva planes previos.
- Rollback del proceso API+worker no elimina jobs pendientes ni trabajos canónicos.

## Riesgos de ejecución

| Riesgo | Indicador temprano | Respuesta |
|---|---|---|
| Alcance crece hacia banca/pagos | Historias requieren credenciales o movimientos reales | Rechazar del MVP y abrir iniciativa regulatoria independiente |
| Proveedor poco preciso | Corrección alta por campo/idioma | Mejorar captura o adaptar proveedor; nunca auto-confirmar |
| Coste externo inesperado | Consumo por captura supera presupuesto | Reducir límites, caché segura, kill switch y manual |
| Free tier insuficiente o proveedor pausa el proyecto | Supabase inactivo 7 días o Render duerme el servicio | Ping programado de keep-alive, pg_dump programado y evaluación del plan pago mínimo |
| Reglas financieras confunden | Usuarios no entienden evidencia o confianza | Revisar lenguaje y política antes de añadir más automatización |
| Internacionalización incompleta | Datos cambian al cambiar locale/zona | Pruebas de dominio y no reinterpretación histórica |
| Datos de prueba sensibles | Fixture contiene comercio/persona real | Retirar, investigar y sustituir por sintético |
| Arquitectura se acopla | Imports o escrituras cruzan módulos | Fallar CI y corregir antes de nuevas capacidades |
| Accesibilidad llega tarde | Flujo solo funciona con ratón/gráfico | Incluir aceptación en cada fase |
| Cumplimiento se sobreafirma | Texto promete certificación global | Bloquear publicación hasta revisión jurídica |

## Próximo paso después de aprobar documentos

Comenzar Fase 0 únicamente cuando exista autorización explícita para implementar. Hasta entonces, estos documentos son la fuente de requisitos y decisiones; no implican que se haya creado código, infraestructura o cuentas externas.
