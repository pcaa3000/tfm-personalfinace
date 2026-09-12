# Arquitectura de solución

La plataforma se construirá como un monolito modular con tres unidades desplegables propias —web, API y worker— y límites de dominio preparados para una extracción posterior. La prioridad es proteger la integridad financiera y mantener bajo el coste operativo, no simular una arquitectura de gran empresa antes de necesitarla.

## Vista ejecutiva

| Decisión | Resultado |
|---|---|
| Estilo inicial | Monolito modular con Clean Architecture por contexto |
| Frontera cliente | Aplicación React/Vite separada de una API REST versionada |
| Procesamiento lento | Worker independiente y colas durables |
| Fuente de verdad | PostgreSQL |
| Binarios | Almacenamiento privado compatible con S3 |
| Consistencia | Fuerte dentro de un agregado; eventual entre módulos asíncronos |
| Proveedores externos | Puertos y adaptadores anticorrupción |
| Evolución | Escalar procesos primero; extraer servicios solo con métricas y prerrequisitos |

## Prioridades de calidad

1. **Integridad:** una captura, reintento o fallo parcial no puede duplicar un movimiento.
2. **Seguridad y privacidad:** cada acceso está ligado al propietario y cada dato sensible tiene finalidad y retención.
3. **Explicabilidad:** inferencias y recomendaciones conservan evidencia, versión y confianza.
4. **Mantenibilidad:** dominio y aplicación permanecen independientes de frameworks y proveedores.
5. **Coste:** la aplicación funciona con bajo volumen y puede degradar a entrada manual.
6. **Portabilidad:** identidad, archivos, OCR y voz se sustituyen mediante contratos internos.
7. **Escalabilidad:** web, API y workers escalan de forma independiente antes de separar datos y servicios.

## Contexto del sistema

La persona usuaria interactúa con la web. La web consume una única API pública y carga activos mediante URLs firmadas. La API coordina casos de uso y estado canónico. El worker procesa outbox, OCR, voz y proyecciones. Keycloak u otro proveedor compatible autentica. Azure procesa documentos o audio solo después de autorización y dentro de las cuotas configuradas.

Ningún proveedor externo puede escribir directamente en las tablas de negocio ni confirmar transacciones.

## Contenedores lógicos

| Contenedor | Responsabilidad | Estado propio | Escalado |
|---|---|---|---|
| Web | Experiencia, formularios, permisos de cámara/micrófono, revisión y visualización | Estado efímero y caché no canónica | CDN y caché estática |
| API | HTTP, autorización, validación, comandos síncronos y consultas | Ninguno en disco local | Réplicas sin estado |
| Worker | Relay de outbox, validación de activos, OCR, voz, reintentos, mantenimiento y agregados | Ninguno en disco local | Concurrencia y réplicas por cola |
| PostgreSQL | Datos canónicos, revisiones, estados de trabajos, planes, proyecciones y outbox | Persistente | Índices, pooling, réplicas de lectura cuando proceda |
| Redis | Coordinación operativa de BullMQ | Cola persistente, no negocio canónico | Instancia gestionada o clúster al necesitarlo |
| Almacenamiento S3 | Imágenes, documentos y audios privados | Objetos con ciclo de vida | Servicio de objetos |
| Proveedor OIDC | Credenciales, sesiones, recuperación y factores | Identidad externa | Responsabilidad del proveedor |
| Azure Document Intelligence | Extracción OCR de tickets | Respuesta externa temporal | Cuotas y límites del proveedor |
| Azure AI Speech | Transcripción de audio | Respuesta externa temporal | Cuotas y límites del proveedor |
| Observabilidad | Logs, métricas, trazas y alertas | Telemetría sin contenido financiero | Backend activado según entorno |

### Fronteras de despliegue

- Web, API y worker tienen artefactos y pipelines independientes.
- API y worker pueden compartir paquetes de aplicación mientras sigan en el monolito, pero no proceso ni disco local.
- No existe gateway en el MVP: la web llama a una sola API versionada.
- Redis, PostgreSQL y objetos son dependencias de red, nunca directorios del contenedor.
- OCR y voz no forman parte de la transacción HTTP que acepta una captura.

## Módulos del monolito

Los módulos son fronteras de negocio, no microservicios anticipados.

| Módulo | Responsabilidad | Datos que posee | Interfaz pública interna |
|---|---|---|---|
| Perfil e identidad | Vincular identidad externa, preferencias, locale, zona horaria y consentimientos | Perfil, vínculo issuer–subject, preferencias y consentimientos | Consultar contexto del propietario y actualizar preferencias |
| Libro de transacciones | Crear, confirmar, revisar, anular y consultar ingresos/gastos | Transacción, revisiones y referencias de origen | Registrar, revisar, anular y resumir movimientos confirmados |
| Captura | Gestionar activos, trabajos, respuestas de proveedor y borradores | Activo, trabajo, ejecución, extracción y borrador | Crear captura, finalizar subida, procesar, revisar y descartar |
| Categorización | Mantener categorías y sugerencias explicables | Categoría, regla, alias de comercio y preferencia | Validar categoría y sugerir clasificación |
| Insights | Crear proyecciones y detectar patrones | Resumen mensual, insight, evidencia y descarte | Consultar reportes, detalle y calidad del dato |
| Planificación financiera | Calcular ahorro, confianza y planes de bolsillos | Recomendación, versión de política, plan y asignaciones | Generar, explicar, ajustar y aceptar plan |

### Límites obligatorios

- Captura no crea transacciones mediante acceso a tablas. Entrega un borrador confirmado al caso de uso público del Libro.
- Categorización no modifica movimientos; devuelve una sugerencia o valida una elección.
- Insights no corrige el Libro; consume eventos y expone evidencias que enlazan a movimientos.
- Planificación no consulta tablas del Libro ni de Insights; recibe un snapshot financiero versionado.
- Perfil no se confunde con Keycloak: credenciales y sesiones permanecen fuera de la base de negocio.
- Ningún módulo importa el repositorio, servicio interno o modelo Prisma de otro.

## Clean Architecture dentro de cada módulo

### Capas

| Capa | Contenido | Puede depender de |
|---|---|---|
| Dominio | Entidades, value objects, invariantes, políticas y eventos de dominio | Lenguaje y un shared kernel mínimo |
| Aplicación | Casos de uso, puertos de entrada/salida, autorización contextual y transacciones lógicas | Dominio |
| Adaptadores de entrada | Controllers HTTP, handlers de worker, tareas programadas y mapeo de DTO | Aplicación y dominio para mapeo |
| Adaptadores de salida | Repositorios Prisma, BullMQ, S3, Azure, OIDC, reloj y telemetría | Puertos de aplicación y modelos externos |
| Composición | Módulos NestJS, configuración e inyección concreta | Todas las capas para ensamblarlas |

La dirección es hacia el dominio. Dominio y aplicación no importan React, NestJS, Prisma, BullMQ, Redis, SDK de Azure, S3 ni Keycloak.

### Shared kernel permitido

El shared kernel se limita a conceptos estables y sin infraestructura:

- Dinero y código de moneda.
- Identificador de propietario.
- Fecha de negocio, instante UTC y zona horaria.
- Identificador, versión y metadatos mínimos de evento.
- Resultado y error de dominio sin semántica HTTP.

Una regla financiera específica, DTO, categoría o entidad no entra en el shared kernel.

### Mapeos obligatorios

| Frontera | Mapeo |
|---|---|
| HTTP → aplicación | DTO validado a comando o consulta del caso de uso |
| Aplicación → HTTP | Resultado neutral a respuesta y error HTTP |
| Prisma → dominio | Registro y decimal de infraestructura a entidad/value object |
| Proveedor → aplicación | Respuesta bruta a extracción o transcripción neutral |
| Dominio → evento | Evento interno a contrato de integración versionado |

### Control de dependencias

Durante la implementación se deben aplicar:

- Paquetes o rutas separadas por módulo y capa.
- Reglas estáticas que prohíban imports externos desde dominio/aplicación.
- API pública explícita por módulo; los archivos internos no son importables desde otros módulos.
- Pruebas de arquitectura que fallen ante dependencias prohibidas.
- Revisiones que rechacen decoradores NestJS o tipos Prisma en el núcleo.

## Comunicación entre módulos

### Síncrona

Se utiliza una interfaz pública de aplicación cuando la respuesta forma parte del mismo flujo y puede conservar una transacción local clara. No se invoca un controller ni un repositorio ajeno.

Ejemplos:

- Libro solicita a Categorización validar que una categoría pertenece al perfil.
- Captura solicita a Libro confirmar un borrador después de la aprobación humana.
- Planificación consulta un snapshot publicado por Insights.

### Asíncrona

Se utiliza outbox cuando un hecho debe sobrevivir a reinicios o disparar trabajo fuera de la petición. El evento se escribe con el cambio de negocio en PostgreSQL y un relay lo publica a BullMQ.

| Evento conceptual | Emisor | Consumidor principal |
|---|---|---|
| Perfil configurado | Perfil | Categorización y presentación de valores predeterminados |
| Captura finalizada | Captura | Worker de validación y extracción |
| Borrador de extracción disponible | Captura | Web mediante consulta/notificación de estado |
| Captura fallida | Captura | Web y operación |
| Transacción confirmada | Libro | Insights |
| Transacción revisada o anulada | Libro | Insights y Planificación para invalidación |
| Período mensual cerrado | Insights | Planificación |
| Plan aceptado | Planificación | Historial y presentación |

Los contratos incluyen ID de evento, versión, tipo, instante, propietario lógico, correlación y referencia del agregado. No incluyen imagen, audio, transcripción completa, token ni nota libre.

### Transacciones y consistencia

- Un caso de uso modifica un agregado y su outbox en una única transacción PostgreSQL.
- No se sostiene una transacción de base mientras se llama a Azure, S3, OIDC o Redis.
- Un flujo entre módulos puede ser eventualmente consistente y debe mostrar su estado.
- Reportes y recomendaciones conservan la versión del snapshot utilizado.
- Una revisión posterior invalida proyecciones y planes afectados en lugar de modificarlos silenciosamente.

## Propiedad de datos

| Esquema lógico | Propietario | Escritura permitida |
|---|---|---|
| Perfil | Perfil e identidad | Solo sus repositorios |
| Libro | Libro de transacciones | Solo sus repositorios |
| Captura | Captura | Solo sus repositorios y handlers propios |
| Categorización | Categorización | Solo sus repositorios |
| Insights | Insights | Proyectores e interfaces públicas del módulo |
| Planificación | Planificación financiera | Casos de uso y proyectores propios |
| Integración | Relay técnico | Outbox creada por el módulo emisor y actualizada por relay |

Se utilizará una base física en el MVP para mantener transacciones, backups y operación simples. La separación se aplica mediante propiedad de esquemas/tablas, permisos cuando sean viables y reglas de importación.

### Prisma

- Puede existir un cliente generado común en infraestructura, pero cada módulo encapsula sus modelos y repositorios.
- Los tipos generados no se exportan desde el adaptador.
- Una migración declara módulo propietario y no añade escrituras cruzadas.
- No se crean claves foráneas entre contextos como mecanismo de integración. Se prefieren referencias estables y validación mediante la interfaz propietaria.
- Las lecturas analíticas cruzadas se canalizan mediante proyecciones; nunca habilitan escrituras fuera del propietario.

## Contrato público de la API

### Grupos de capacidades

| Grupo | Módulo responsable |
|---|---|
| Perfil y preferencias | Perfil e identidad |
| Transacciones | Libro de transacciones |
| Activos, capturas y borradores | Captura |
| Categorías y sugerencias | Categorización |
| Reportes e insights | Insights |
| Recomendaciones y planes | Planificación financiera |

### Política

- Versión mayor en ruta y descripción OpenAPI propiedad de API.
- IDs opacos, paginación consistente y timestamps con zona o UTC inequívoco.
- Clave de idempotencia para altas que el cliente pueda repetir.
- Respuestas asíncronas con ID de recurso y estado consultable.
- Errores con código estable, mensaje localizable por la web, correlación y detalles no sensibles.
- Deprecación documentada antes de retirar campos o rutas.

La web no utiliza modelos internos del backend. Su cliente se regenera desde el contrato publicado y puede desplegarse sin recompilar la API.

## Identidad y sesión

### Flujo

1. La web inicia Authorization Code con PKCE contra el proveedor OIDC usando una redirect URI registrada para el entorno.
2. El proveedor autentica y devuelve el resultado a la web.
3. La web utiliza un access token de vida corta sin persistirlo en almacenamiento accesible a scripts.
4. La API valida firma, issuer, audience, expiración, algoritmo y claims mínimos contra metadatos/JWKS confiables.
5. La API resuelve o aprovisiona un perfil por la pareja issuer–subject y obtiene un identificador interno.
6. Cada caso de uso recibe ese propietario desde el contexto autenticado; nunca acepta un propietario libre enviado por el cliente.
7. El logout limpia el estado local y solicita cierre de sesión OIDC cuando esté soportado.

### Roles

- `usuario`: acceso exclusivo a recursos propios.
- `operación`: salud y telemetría técnica, sin permiso ordinario para leer contenido financiero.

No se define un superusuario con acceso implícito a todas las finanzas. Una función excepcional de soporte requeriría diseño, consentimiento y auditoría propios fuera del MVP.

### Sustitución de proveedor

El vínculo issuer–subject, la validación estándar y el adaptador de claims aíslan Keycloak. Cambiar a un proveedor gestionado requiere migrar configuración e identidades, no entidades financieras ni casos de uso.

## Flujo de registro manual

1. La web obtiene moneda y zona horaria predeterminadas del perfil.
2. La persona completa y revisa el formulario.
3. La API valida formato, autorización, categoría y clave de idempotencia.
4. Libro crea una transacción confirmada y su evento outbox en una misma transacción.
5. El relay publica el evento.
6. Insights actualiza el período correspondiente.
7. La web invalida sus consultas y muestra el dato confirmado.

## Flujo de ticket

### Autorización y subida

1. La web solicita crear una captura con nombre, tamaño, tipo declarado y checksum cuando sea posible.
2. La API valida propietario, cuota y política, crea un activo en estado `esperando subida` y reserva una clave de objeto no predecible.
3. La API emite una URL firmada breve limitada a clave, método, tamaño y tipo esperados.
4. La web sube directamente al bucket privado y notifica finalización.
5. La API comprueba existencia, tamaño y checksum mediante el almacenamiento; una clave ajena no puede asociarse a la captura.
6. El activo pasa a `cuarentena` y se registra un evento outbox.

### Validación y OCR

1. El relay crea un job determinista a partir del evento.
2. El worker reclama una ejecución única en PostgreSQL.
3. Descarga a almacenamiento temporal acotado, verifica firma real, decodificación, dimensiones, páginas y política de malware.
4. Elimina metadatos innecesarios o genera una copia normalizada cuando la política lo exija.
5. Invoca el puerto OCR con timeout, límite de consumo y correlación.
6. El adaptador traduce comercio, fecha, moneda, totales, partidas y confianza a un modelo neutral.
7. Captura conserva respuesta normalizada, evidencia mínima y un borrador; la respuesta bruta tiene retención breve y restringida.
8. El estado pasa a `requiere revisión` y la web puede consultarlo.

### Confirmación

1. La persona revisa y corrige todos los campos relevantes.
2. Captura marca una versión del borrador como aprobada.
3. El caso de uso público de Libro crea la transacción con una referencia de origen única.
4. Una restricción de unicidad impide confirmar dos transacciones para la misma captura.
5. El evento `Transacción confirmada` actualiza Insights.
6. El activo original sigue su preferencia de conservación o eliminación.

## Flujo de voz

1. La web solicita permiso y muestra grabación activa, duración y controles.
2. La persona reproduce o descarta antes de enviar.
3. Se crea y sube un activo de audio mediante el mismo protocolo privado.
4. El worker valida formato/duración y normaliza el audio con límites de recursos.
5. El puerto de voz devuelve texto, idioma y metadatos disponibles.
6. El analizador por locale propone campos y adjunta evidencia textual por campo.
7. Lo ambiguo queda vacío; no se infiere una moneda distinta de la expresada o predeterminada sin indicarlo.
8. La persona corrige y confirma mediante el mismo flujo del Libro.
9. El audio puede eliminarse sin borrar transcripción revisada ni transacción confirmada, conforme a consentimiento y retención.

## Estados canónicos

### Activo y captura

| Estado | Significado | Salidas válidas |
|---|---|---|
| Esperando subida | Existe autorización, todavía no hay objeto verificado | Cuarentena, vencido, descartado |
| Cuarentena | El objeto existe y espera validación | En cola, rechazado, descartado |
| En cola | Existe intención durable de procesamiento | Procesando, fallido |
| Procesando | Un worker posee una ejecución renovable | Requiere revisión, reintento, fallido |
| Requiere revisión | Hay borrador disponible | Confirmado, descartado, reprocesamiento versionado |
| Confirmado | Un borrador originó una transacción | Activo conservado o eliminado |
| Fallido | No se obtuvo borrador utilizable | Reintento autorizado, entrada manual, descartado |
| Descartado | La persona abandonó la captura | Eliminación del activo |

El estado de conservación del objeto se controla por separado para permitir eliminar el binario sin alterar el historial financiero.

### Trabajo

| Estado PostgreSQL | Significado |
|---|---|
| Pendiente | Outbox creada; puede no existir aún job Redis |
| Despachado | Redis confirmó el job |
| En ejecución | Un worker adquirió la ejecución |
| Esperando reintento | Fallo transitorio dentro del límite |
| Completado | Resultado persistido e idempotente |
| Fallido permanente | Error no reintentable o presupuesto agotado |
| Revisión operativa | Inconsistencia o agotamiento de reintentos requiere intervención |

BullMQ puede mantener estados operativos más detallados, pero no decide el estado visible de negocio.

## Idempotencia y reconciliación

| Frontera | Clave o guarda |
|---|---|
| Petición de alta | Clave de idempotencia ligada a propietario, operación y hash de entrada |
| Activo | Clave de objeto, captura y checksum únicos por propietario |
| Outbox → BullMQ | ID de evento como ID determinista de job |
| Ejecución OCR/voz | Captura, tipo de proceso y versión únicos |
| Confirmación | Referencia de origen de captura única en Libro |
| Proyección | ID y versión de evento procesado por consumidor |
| Plan mensual | Perfil, moneda, período y versión de snapshot |

Los reintentos pueden repetir lectura y cómputo; no pueden repetir el efecto observable. Un reconciliador compara outbox, estado PostgreSQL y cola para recuperar eventos no despachados, jobs estancados o resultados no aplicados.

No se usa una ventana temporal de deduplicación como única garantía: las guardas de negocio persisten mientras exista el recurso.

## Cierre mensual, reportes y planificación

1. Insights consume eventos del Libro y mantiene proyecciones por propietario, moneda y período.
2. Al cerrar el mes, verifica movimientos pendientes, proporción sin categorizar y declaración de integridad.
3. Crea un snapshot inmutable con versión y referencias a las transacciones incluidas.
4. Calcula reportes y candidatos a gasto hormiga.
5. Publica el cierre para Planificación.
6. Planificación aplica una política versionada y genera recomendación, confianza y seis asignaciones.
7. La persona ajusta porcentajes y acepta una versión del plan.
8. Una revisión de transacción invalida el snapshot y marca recomendaciones derivadas como desactualizadas; no reescribe silenciosamente una decisión aceptada.

Los agregados son separados por moneda. Una futura moneda de reporte necesitará un contexto de tipos de cambio con fuente y fecha propias.

## Fallos y degradación

| Fallo | Respuesta del sistema |
|---|---|
| PostgreSQL no disponible | Rechaza escrituras y no presenta confirmación falsa |
| Redis no disponible | El cambio y outbox pueden quedar pendientes; el relay reanuda al recuperar la cola |
| Worker cae | El lock vence, el job puede repetirse y las guardas idempotentes evitan efectos duplicados |
| Almacenamiento no disponible | No finaliza subida ni encola un objeto no verificado |
| Azure temporalmente no disponible | Reintentos acotados y estado visible |
| Cuota de Azure agotada | Kill switch o rechazo controlado con ruta manual |
| Keycloak no disponible | Nuevos logins fallan; la API valida tokens vigentes según caché segura de claves y política definida |
| Proyección retrasada | La transacción sigue siendo canónica; el reporte muestra estado de actualización |
| Archivo malicioso o inválido | Se mantiene aislado, no se envía al proveedor y se elimina según política |

## Despliegue

### Entorno local

- Web, API y worker desde el workspace.
- PostgreSQL, Redis y MinIO mediante contenedores.
- Keycloak como perfil opcional o proveedor OIDC de desarrollo equivalente.
- Adaptadores deterministas de OCR y voz por defecto.
- Servicios Azure solo en pruebas opt-in con secretos externos al repositorio.

### Despliegue económico del TFM

- Web en hosting estático/CDN.
- API y worker como servicios contenerizados separados.
- PostgreSQL gestionado con backups y pooling.
- Redis persistente con AOF/noeviction.
- Bucket privado con lifecycle.
- OIDC gestionado o Keycloak endurecido según recursos medidos.
- OCR/voz con presupuesto, alertas y kill switch.

### Escalado antes de microservicios

1. Aumentar réplicas sin estado de API.
2. Ajustar índices, consultas y pooling de PostgreSQL.
3. Escalar workers por tipo de cola y límites del proveedor.
4. Separar concurrencia de tickets y audio.
5. Introducir proyecciones/materialización de reportes.
6. Añadir réplica de lectura si los reportes lo justifican.
7. Solo después evaluar separación de proceso, datos y despliegue de un contexto.

## Evolución a microservicios

### Prerrequisitos obligatorios

Un módulo no se extrae hasta cumplir todos:

- API pública interna explícita y sin imports de internals.
- Cero escrituras directas sobre sus tablas desde otros módulos.
- Eventos versionados e idempotentes con observabilidad de lag y errores.
- Datos propietarios identificados y plan de migración/backfill ensayado.
- SLO y carga de referencia medidos en el monolito.
- Pipeline, despliegue, secretos, backups y rollback independientes preparados.
- Beneficio esperado superior al coste de red, consistencia, operación y pruebas.

### Disparadores medibles

La extracción requiere al menos un impulsor fuerte y una decisión arquitectónica registrada:

| Impulsor | Umbral inicial de revisión |
|---|---|
| Latencia API | El módulo provoca incumplir p95 de 750 ms en tres pruebas de carga consecutivas después de optimizar consultas y proceso |
| Reportes | p95 supera 2 s con 10.000 transacciones por perfil después de índices y proyecciones |
| Cola de captura | Espera p95 para comenzar un job supera 2 s a carga objetivo aun escalando workers, o la API necesita menos de un tercio de sus recursos |
| Aislamiento de fallos | Fallos del módulo consumen más de la mitad del presupuesto de errores de otra capacidad durante un período operativo revisado |
| Escalado desigual | El módulo necesita al menos tres veces más réplicas o recursos que la API durante carga sostenida |
| Despliegue | Cambios del módulo bloquean repetidamente releases ajenos y ya existe propiedad de equipo independiente |
| Cumplimiento | Retención, región o acceso exigen una frontera de datos y operación separada |

Los umbrales abren una revisión; no ordenan una migración automática. Deben ajustarse mediante una decisión registrada si cambia la carga de referencia.

### Primeras candidatas

1. **Captura:** solo después de agotar el escalado del worker. Es candidata por carga, dependencia de proveedores y fallos diferentes; no por moda.
2. **Insights:** candidata si consultas y proyecciones afectan al Libro después de optimización y réplica de lectura.
3. **Planificación:** permanecerá junto al dominio mientras su carga sea baja; su extracción ofrece poco beneficio inicial.
4. **Perfil e identidad:** Keycloak ya es externo, pero el perfil local no merece un servicio propio en el MVP.

### Proceso de extracción

1. Congelar y versionar el contrato público del módulo.
2. Crear un adaptador remoto detrás de la misma interfaz interna.
3. Preparar base propietaria, backfill verificado y captura de cambios mediante outbox.
4. Ejecutar comparación de lecturas y métricas sin doble escritura no controlada.
5. Cambiar el tráfico por una ruta reversible.
6. Retirar acceso a tablas antiguas solo después de reconciliar datos.
7. Mantener HTTP para consultas/comandos y eventos para hechos; introducir otro broker únicamente si BullMQ deja de satisfacer contratos entre servicios.

Una base compartida entre servicios sería una transición temporal, no el resultado aceptado.

## Trazabilidad arquitectónica

| Requisitos | Módulos y contenedores principales |
|---|---|
| RF-001 a RF-005 | Web, API, proveedor OIDC, Perfil |
| RF-010 a RF-016 | Web, API, Libro, PostgreSQL |
| RF-020 a RF-029 | Web, API, Worker, Captura, S3, Redis, OCR |
| RF-030 a RF-037 | Web, API, Worker, Captura, S3, Redis, voz |
| RF-040 a RF-044 | Web, API, Categorización, PostgreSQL |
| RF-050 a RF-058 | Web, API, Worker, Insights, PostgreSQL |
| RF-060 a RF-069 | Web, API, Planificación, Insights |
| RF-070 a RF-074 | Todos los contenedores con datos y proveedores externos |
| RNF-001 a RNF-004 | OIDC, API, almacenamiento y observabilidad |
| RNF-005 a RNF-008 | PostgreSQL, outbox, Redis, worker y proyecciones |
| RNF-009 a RNF-010 | Web, contratos y perfil |
| RNF-011 a RNF-018 | Puertos, composición, despliegues y contratos versionados |

## Restricciones conscientes

- El monolito modular requiere disciplina: las carpetas no crean fronteras si se permiten imports o tablas cruzadas.
- Redis, MinIO y Keycloak añaden infraestructura. Se mantienen porque trabajos, binarios e identidad son capacidades centrales; cada servicio tendrá perfil opcional o sustitución gestionada.
- Un adaptador simulado hace reproducible el desarrollo, pero no demuestra precisión real. Las pruebas opt-in deben medir ejemplos representativos y anonimizados.
- Los umbrales de microservicios son puertas de revisión y necesitan telemetría real antes de aplicarse.
- La arquitectura internacional no equivale a soporte inmediato de todas las leyes, monedas e idiomas.

## Documentos relacionados

- [Requisitos del producto](01-requisitos-producto.md)
- [Stack tecnológico](02-stack-tecnologico.md)
- [Modelo de dominio financiero](04-modelo-dominio-financiero.md)
- [Seguridad y privacidad](05-seguridad-privacidad.md)
- [Roadmap y validación](06-roadmap-validacion.md)
