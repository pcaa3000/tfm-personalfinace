# Stack tecnológico recomendado

La propuesta utiliza TypeScript en web y API, PostgreSQL como fuente de verdad y adaptadores sustituibles para identidad, archivos, OCR y voz. El objetivo no es acumular herramientas: es entregar un TFM reproducible, desplegable en **capa gratuita (free tier)** para menos de 20 usuarios, con límites suficientes para escalar a **AWS** en una segunda etapa sin reescribir el dominio.

## Decisión

- **Frontend:** React y Vite como PWA estática desplegable de forma independiente, con cola local offline sobre IndexedDB.
- **Backend:** NestJS sobre Node.js LTS; API REST y worker comparten **un solo proceso** en el MVP (módulos separados, mismo despliegue).
- **Arquitectura:** monolito modular con Clean Architecture y principios SOLID; dominio y casos de uso libres de frameworks.
- **Persistencia:** PostgreSQL gestionado por Supabase; Prisma solo dentro de adaptadores.
- **Asincronía:** pg-boss sobre el mismo PostgreSQL — el job se encola en la misma transacción del caso de uso (outbox sin relay ni Redis).
- **Archivos:** Supabase Storage (API compatible con S3, privado, ciclo de vida ≤30 días).
- **Identidad:** OpenID Connect mediante Supabase Auth (usuario/contraseña, Google, Facebook, passkeys); la pareja issuer–subject aísla al proveedor.
- **Aislamiento:** un workspace financiero personal por identidad y uno efímero por sesión demo.
- **Demo:** misma API/casos de uso con semilla y adaptadores mock; medios reales permanecen en el navegador; los cambios no persisten al terminar la sesión.
- **OCR y voz:** Azure AI Document Intelligence y Azure AI Speech en capa gratuita F0, detrás de puertos propios.
- **Analítica:** consultas y agregados en PostgreSQL, con políticas deterministas.
- **Despliegue inicial:** web en hosting estático gratuito (Vercel), API+worker en un servicio contenerizado gratuito (Render o Koyeb), datos en Supabase. Sin Redis, Keycloak, MinIO ni Kubernetes en esta etapa.

## Criterios de selección

| Criterio | Consecuencia técnica |
|---|---|
| Equipo pequeño y sin ecosistema impuesto | Un lenguaje principal (TypeScript) reduce cambios de contexto y duplicación de conocimientos frente a Python o Go |
| Free tier con <20 usuarios | Servicios gestionados con capa gratuita generosa; ninguna pieza operada a mano (Redis, Keycloak, MinIO) mientras exista sustituto gestionado |
| Frontend y backend separados | No se utiliza un framework full-stack como frontera de negocio ni se acopla el despliegue web al de la API |
| Datos financieros | Se priorizan integridad transaccional, tipos decimales, auditoría y consultas relacionales |
| OCR y voz lentos o falibles | Se procesan fuera de la petición HTTP y siempre producen borradores revisables |
| Presupuesto de TFM | Se usan servicios gestionados solo donde aportan precisión; todos tienen cuotas y fallback manual |
| Alcance internacional | Moneda, locale, idioma, zona horaria y fecha de negocio son explícitos |
| Evolución futura | Los proveedores quedan detrás de puertos y los contextos poseen sus datos e interfaces públicas |
| Aislamiento | Cada recurso se resuelve desde un workspace servidor; una cuenta demo compartida no comparte datos entre sesiones |
| Seguridad | La aplicación no administra contraseñas ni expone archivos como objetos públicos |

## Organización del repositorio

Se recomienda un monorepo con espacios de trabajo técnicos de `pnpm`. Este uso pertenece al código y no debe confundirse con el workspace financiero de una persona. Monorepo significa compartir coordinación, no desplegar todo junto ni compartir datos entre usuarios.

### Unidades desplegables

| Unidad | Responsabilidad | Dependencias permitidas |
|---|---|---|
| Web (PWA) | Interfaz, captura del navegador, cola local offline, validación de experiencia y consumo de API | Cliente generado desde el contrato público; nunca Prisma ni módulos internos de API |
| API + worker | HTTP, autorización, validación de entrada, casos de uso síncronos y consulta de estados; en el mismo proceso, handlers de trabajos pg-boss (OCR, voz, mantenimiento y agregados) | Módulos de aplicación y adaptadores configurados en composición |

### Compartición permitida

- Cliente HTTP generado y modelos del contrato público.
- Utilidades técnicas estables de observabilidad, configuración y pruebas.
- Catálogos de traducción cuando tengan la misma propiedad y ciclo de publicación.

### Compartición prohibida

- Entidades de dominio entre web y API.
- Tipos generados por Prisma fuera del adaptador de persistencia.
- Modelos de respuesta de Azure, Supabase o S3 fuera de sus adaptadores.
- Acceso de un módulo a tablas, repositorios o servicios internos de otro módulo.

No se incorpora Nx inicialmente. Los espacios de trabajo técnicos y reglas de importación son suficientes para el TFM; un orquestador de monorepo se justificará cuando el grafo de builds o el tiempo de CI lo requieran.

## Workspace financiero y modo demo

El workspace financiero es una entidad de dominio y aislamiento, no una carpeta ni una unidad desplegable. No se crea un servicio de tenancy en el MVP.

| Pieza | Responsabilidad |
|---|---|
| PostgreSQL (Supabase) | Estado canónico de workspace, expiración de medios, sesión demo y versión de semilla |
| Supabase Auth (OIDC) | Identidad personal, proveedores sociales, passkeys, rol demo, sesiones concurrentes y logout |
| API | Resolver el workspace desde identidad/sesión y construir un contexto no controlado por cliente |
| Worker | Expiración de medios a 30 días y limpieza idempotente de workspaces demo terminados |
| Web (PWA) | Mostrar workspace actual, política y marca demo; mantener preview demo únicamente en memoria local; vaciar cola local al terminar la sesión |
| Seeder | Materializar datos sintéticos versionados una sola vez por sesión demo |
| Adaptadores mock | Simular OCR/voz y errores sin acceder a Azure ni interpretar el medio local |

Para usuarios personales, `(issuer, subject)` resuelve el único workspace persistente, sin importar si el acceso fue por usuario/contraseña, proveedor social o passkey. Para demo, la identidad compartida se combina con `sid` o con un identificador servidor ligado a la sesión validada. La misma sesión recupera el mismo workspace; una sesión nueva obtiene otro. La sesión demo expira por logout, cierre de la aplicación o **10 minutos de inactividad**, y las modificaciones realizadas nunca persisten.

## Frontend

### Base

| Tecnología | Uso | Límite |
|---|---|---|
| TypeScript | Contratos locales, estados y validación estática | No sustituye validación en tiempo de ejecución |
| React | Composición de pantallas y componentes | No contiene reglas financieras canónicas |
| Vite | Desarrollo y build estático | Sus variables públicas nunca contienen secretos |
| React Router | Navegación y protección de rutas en experiencia | La seguridad real siempre se aplica en la API |
| TanStack Query | Estado remoto, caché, invalidación y reintentos de lectura | No es almacén canónico ni persiste tokens |
| React Hook Form y Zod | Formularios y validación de entrada | Los esquemas web no se reutilizan como entidades de dominio |
| Material UI | Formularios, navegación, tablas, diálogos y tema responsive | Cada uso debe verificar accesibilidad, no asumirla por la librería |
| Recharts | Tendencias y distribuciones SVG | Todo gráfico tendrá tabla o resumen textual equivalente |
| react-i18next | Textos, plurales, namespaces y carga de idiomas | Moneda, número y fecha se formatean con `Intl`, no mediante traducciones |
| Workbox / vite-plugin-pwa | Service worker, instalación PWA y caché del shell estático | No es repositorio de negocio; solo caché de presentación |
| Dexie (IndexedDB) | Cola local de registros y capturas pendientes de sincronización | Se vacía al terminar la sesión; los ítems pendientes no alimentan reportes |
| ExcelJS | Generación de reportes `.xlsx` en cliente o API según volumen | Los importes se exportan como decimales con moneda explícita |

### Decisiones de experiencia

- Cámara y micrófono se habilitan solo en HTTPS o entorno local compatible.
- Si una capacidad no existe, la interfaz ofrece selección de archivo o entrada manual.
- En demo, el preview de cámara/micrófono permanece en memoria del navegador y se descarta sin upload; el backend recibe solo un identificador de escenario sintético.
- La PWA es instalable y mantiene una **cola local offline** en IndexedDB: registros manuales, imágenes y audios capturados sin red se encolan con clave de idempotencia generada en el cliente y se sincronizan al recuperar conexión. Solo se encolan altas nuevas; la edición o anulación de datos existentes requiere conexión.
- Los ítems `pendientes de sincronización` se muestran con ese estado y no participan en reportes, presupuestos ni recomendaciones hasta su confirmación en servidor.
- La cola local se vacía al cerrar sesión y, en modo demo, al terminar la sesión por logout, cierre de la aplicación o 10 minutos de inactividad.
- Los tokens no se persisten en `localStorage`. El flujo exacto debe mantener credenciales fuera de almacenamiento accesible a scripts y cumplir la política del proveedor OIDC.
- Las tablas, navegación por teclado, estados de foco y mensajes de error forman parte de la aceptación, no de una fase estética posterior.

## API y backend

### Node.js y NestJS

Se utilizará una versión LTS activa de Node.js y una versión estable soportada de NestJS al iniciar la implementación.

NestJS aporta composición modular, inyección de dependencias, validación HTTP, OpenAPI, health checks y adaptadores de transporte. No define el dominio.

| Elemento NestJS | Ubicación permitida |
|---|---|
| Controllers, DTO HTTP, pipes e interceptors | Adaptador de entrada HTTP |
| Guards y validación de claims | Adaptador de seguridad HTTP |
| Módulos y tokens de inyección | Raíz de composición |
| Configuración de Prisma, pg-boss, S3-compatible, Supabase Auth y Azure | Adaptadores de infraestructura |
| Decoradores de framework | Prohibidos en dominio y aplicación |

Los casos de uso reciben dependencias por constructor mediante puertos propios. La raíz de composición los conecta con adaptadores NestJS; no se utiliza el contenedor del framework como localizador de servicios dentro del dominio.

### Contrato HTTP

- REST JSON con versión mayor en ruta, comenzando por `/api/v1` durante la implementación.
- La API es propietaria de la descripción OpenAPI.
- El cliente web consume el contrato publicado mediante tipos generados con `openapi-typescript` (solo tipos, sin pipeline de cliente runtime); no se comparte la implementación de DTO internos. La generación de un cliente completo se evalúa en etapa 2.
- Un cambio compatible puede añadir campos opcionales. Eliminar, renombrar o cambiar semántica requiere una nueva versión mayor y una ventana de migración.
- Errores, paginación, correlación e idempotencia tendrán formatos comunes.
- El frontend llama directamente a la API; no se incorpora gateway mientras exista una sola API pública.

## Persistencia

### PostgreSQL (Supabase)

PostgreSQL será la fuente de verdad para workspaces, vínculos de identidad/sesión, expiración de medios, transacciones, trabajos, presupuestos, planes y revisiones. En etapa 1 se usa **Supabase** (PostgreSQL gestionado, free tier de 500 MB); la misma base hospeda la cola pg-boss.

- Todo registro financiero o derivado incluye un `workspace_id` inmutable y validado por su repositorio.
- Una restricción garantiza un workspace personal por identidad y un workspace demo por sesión.
- El dinero se almacena como decimal con precisión definida y código ISO 4217.
- La fecha de negocio y la zona horaria original se conservan separadas de instantes técnicos en UTC.
- Una base física puede contener esquemas lógicos por contexto durante el monolito.
- Cada módulo es el único autorizado para escribir sus tablas.
- No se permiten consultas de escritura cruzadas ni repositorios compartidos.
- Relaciones dentro del mismo contexto pueden usar claves foráneas; referencias entre contextos se resuelven mediante interfaces públicas y eventos.
- Las proyecciones de lectura pueden combinar datos de forma controlada, sin convertirse en una ruta de escritura.

### Prisma

Prisma se selecciona por productividad, migraciones y acceso tipado a PostgreSQL, con estas restricciones:

- Cliente y tipos generados solo existen en adaptadores de persistencia.
- Cada repositorio traduce explícitamente registros a entidades o valores de dominio.
- El dominio no conoce IDs, enums o decimales propios de Prisma.
- Las migraciones se serializan para la base compartida y cada cambio declara el módulo propietario.
- Una transacción técnica no debe atravesar varios contextos como solución habitual; los flujos entre módulos usan casos de uso y, cuando corresponda, trabajos encolados en la misma transacción.

Si Prisma impide expresar una consulta analítica o migración segura, se permite SQL encapsulado en infraestructura. La herramienta no gobierna el modelo financiero.

## Trabajos asíncronos y fiabilidad

### pg-boss sobre PostgreSQL

En el MVP no se despliega Redis ni BullMQ: la cola es **pg-boss**, que almacena trabajos en tablas del mismo PostgreSQL y los entrega a workers mediante `SELECT FOR UPDATE SKIP LOCKED` con `LISTEN/NOTIFY`. Resuelve colas, concurrencia, reintentos con backoff exponencial, dead-letter, rate limiting y tareas programadas sin añadir infraestructura:

- Los jobs viven en la base que ya se opera y respalda.
- Los handlers corren en el mismo proceso que la API en etapa 1.
- La entrega es **al menos una vez**; las guardas de idempotencia de negocio se mantienen igual.

### Relación entre encolado transaccional y estado canónico

pg-boss permite encolar el job dentro de la misma transacción PostgreSQL que el cambio de negocio, lo que reduce el patrón outbox a una sola escritura atómica:

1. El caso de uso guarda el cambio de negocio, su `workspace_id`, el estado inicial del trabajo y encola el job con identificador determinista en una misma transacción PostgreSQL.
2. Si la transacción confirma, el job existe; si falla, no queda intención huérfana. No hay relay separado ni ventana de doble escritura.
3. El worker reclama o crea en PostgreSQL una ejecución única por captura, tipo y versión de procesamiento.
4. El resultado y el siguiente encolado se guardan juntos; una respuesta duplicada observa el resultado existente y no repite el efecto.
5. La reconciliación se limita a recuperar jobs estancados o expirados según las políticas de pg-boss.

El estado de la cola sirve para operar los trabajos. El estado PostgreSQL decide qué ocurrió para el negocio.

### Política de fallos

| Tipo de fallo | Comportamiento |
|---|---|
| Timeout, indisponibilidad o límite temporal | Reintento exponencial con jitter y máximo configurable |
| Rate limit del proveedor | Respetar espera indicada y presupuesto de consumo |
| Archivo inválido o campo no interpretable | Fallo permanente y ruta manual, sin reintento automático infinito |
| Agotamiento de reintentos | Estado fallido recuperable y dead-letter de pg-boss |
| Mensaje o respuesta duplicada | Guardas de unicidad e idempotencia; no duplica borrador ni transacción |
| Cuota agotada o kill switch activo | No invocar proveedor; informar degradación y conservar entrada manual |

Si en etapa 2 el throughput lo justifica, el puerto de cola se sustituye por Amazon SQS o BullMQ sobre ElastiCache sin tocar el dominio.

## Archivos y almacenamiento

Se utiliza una API compatible con S3 para no guardar binarios en el disco de API/worker ni aumentar las copias de seguridad de PostgreSQL.

- **Supabase Storage** implementa el contrato en etapa 1 (API S3-compatible, buckets privados, 1 GB en free tier).
- Los buckets son privados y cifrados en reposo cuando la plataforma lo permita.
- La API crea el activo y emite una URL firmada de subida vinculada a workspace, clave, tipo, tamaño y expiración esperados.
- El cliente sube directamente y confirma checksum; la API verifica metadatos antes de encolar. Si la captura se hizo sin conexión, el cliente la envía desde la cola local al recuperar red y sigue el mismo flujo.
- Un objeto comienza en cuarentena y solo se procesa después de validar tipo real, dimensiones y páginas; el escaneo de malware/poliglotas se difiere a etapa 2.
- Todo activo guarda un `expires_at` fijo de **30 días desde la captura**; no existe configuración que lo extienda.
- Las URLs de lectura son breves, autorizadas por workspace/recurso y nunca permanentes.
- El ciclo de vida elimina objetos temporales, huérfanos, vencidos o pertenecientes a un workspace terminado y registra el resultado en PostgreSQL.

Guardar archivos en el sistema local o como `bytea` simplificaría la primera demo, pero acoplaría escalado, backups y retención. Supabase Storage cubre el free tier del MVP y el mismo contrato migra a Amazon S3 en etapa 2.

## Identidad y autorización

### Protocolo

- OpenID Connect con Authorization Code y PKCE para la web.
- La API actúa como resource server y valida firma mediante JWKS, issuer, audience, expiración y algoritmo permitido.
- La identidad local se vincula mediante la pareja inmutable issuer–subject, nunca solo por correo electrónico.
- Para personal, esa pareja resuelve el único workspace; para demo, el rol y la sesión `sid` resuelven un workspace efímero independiente.
- El logout termina la sesión local, revoca el workspace demo asociado y solicita cierre en el proveedor cuando el protocolo lo permite; la sesión demo también expira por cierre de la aplicación o 10 minutos de inactividad.
- Los roles son mínimos; la pertenencia de cada recurso se valida contra el workspace derivado por servidor.

### Proveedor

**Supabase Auth** es el adaptador de etapa 1: OIDC compatible, usuario/contraseña, proveedores sociales (Google, Facebook u otros habilitados en consola), passkeys/WebAuthn y recuperación gestionada, sin infraestructura propia que operar.

El dominio solo conserva issuer y subject, por lo que sustituir el proveedor (por ejemplo por Amazon Cognito o Keycloak endurecido en etapa 2) no modifica reglas financieras ni casos de uso.

Las capacidades concretas de passkeys y MFA dependen del soporte vigente del proveedor al implementar; se verifican en Fase 0 antes de comprometer la experiencia de registro.

## OCR, voz e interpretación

### OCR

Azure AI Document Intelligence con el modelo preconstruido de tickets es el adaptador inicial porque devuelve comercio, fecha, totales, impuestos, partidas y confianza por campo con amplia cobertura de idiomas.

El puerto propio recibe una referencia privada al activo y devuelve un resultado neutral. Claves, IDs del proveedor, tipos SDK y respuesta bruta permanecen en infraestructura.

### Voz

Azure AI Speech convierte clips cortos en texto. Un adaptador de normalización limita duración y transforma formatos del navegador a un formato aceptado con límites de CPU, memoria y tiempo.

La transcripción no crea una transacción. Un analizador determinista por locale intenta reconocer tipo, importe, moneda, fecha, comercio y categoría; cualquier campo no justificable queda vacío.

### Reproducibilidad y coste

- Desarrollo y pruebas usan adaptadores deterministas con fixtures anonimizadas; no requieren credenciales ni red.
- Las pruebas de contrato contra Azure son opt-in, acotadas y nunca parte de cada ejecución local.
- Producción aplica cuotas por usuario y globales, límite de páginas, tamaño y duración, timeout y kill switch.
- El sistema mantiene entrada manual y puede conservar el borrador parcial.
- No se promete que un free tier permanezca disponible.

Tesseract o Faster Whisper permitirían procesamiento local, pero añadirían modelos, memoria, CPU y otro ecosistema operativo. Se mantienen como posibles adaptadores futuros si privacidad, volumen o coste justifican su operación.

## Categorías y analítica

La primera versión utiliza:

- Categorías globales localizadas y categorías propias.
- Normalización de comercio y reglas de palabras clave.
- Preferencias por comercio aprendidas de correcciones explícitas del mismo perfil.
- PostgreSQL para agregados mensuales, tendencias y detalle navegable.
- Políticas puras para ahorro, confianza, bolsillos y gastos hormiga.

No se incorpora motor ML, base vectorial, data lake ni LLM obligatorio. Primero se necesita un conjunto de datos confirmado y una métrica que demuestre que las reglas no alcanzan la precisión requerida.

## Observabilidad

| Nivel | MVP | Evolución |
|---|---|---|
| Logs | JSON estructurado a stdout con correlación y redacción | Agregación gestionada y alertas |
| Salud | Liveness, readiness y dependencias críticas | SLOs por capacidad |
| Métricas | Peticiones, latencia, errores, cola, proveedores y consumo | Backend Prometheus compatible |
| Trazas | Correlación en logs estructurados | OpenTelemetry y collector cuando el diagnóstico lo justifique (etapa 2) |

No se despliega plataforma de observabilidad ni se instrumenta OpenTelemetry en el MVP: con el volumen del free tier no aporta diagnóstico que los logs no den. El estándar se conserva y el backend de trazas se activa en etapa 2.

## Estrategia de pruebas

| Nivel | Herramientas | Objetivo |
|---|---|---|
| Unidad | Vitest | Entidades, valores, políticas y casos de uso sin NestJS ni red |
| Componentes | React Testing Library | Formularios, estados, accesibilidad y errores |
| Integración | Vitest y servicios efímeros | PostgreSQL (con pg-boss), Supabase Storage local/mock y adaptadores de persistencia |
| Offline PWA | Vitest + Playwright | Cola IndexedDB, orden de sincronización, idempotencia y reconexión |
| Contrato HTTP | OpenAPI y cliente generado | Compatibilidad entre despliegues de web y API |
| Proveedores | Fixtures más pruebas opt-in | Normalización estable sin consumir cuota ordinaria |
| End-to-end | Playwright | Registro, captura, confirmación, reportes y planificación |
| Accesibilidad | axe y pruebas manuales | WCAG 2.2 AA, teclado, foco y alternativas a gráficos |

## Despliegue de referencia

### Desarrollo

- Web y el proceso Node.js (API + worker) ejecutados desde el workspace.
- PostgreSQL local o el proyecto Supabase gratuito; Supabase Storage y Supabase Auth configurados con credenciales de desarrollo.
- Adaptadores simulados por defecto para OCR y voz.
- Servicios externos habilitados solo con credenciales fuera del repositorio.

### Etapa 1 — MVP en free tier (<20 usuarios)

| Capa | Servicio gratuito | Límite relevante |
|---|---|---|
| Web y PWA | **Vercel** (Hobby) | Uso personal/no comercial; assets estáticos y CDN incluidos |
| API + worker | **Render** o **Koyeb** (un solo proceso contenerizado) | Render free duerme a los 15 min sin tráfico y demora ~1 min en despertar; aceptable para el piloto, con ping de health-check si molesta en demos |
| Base de datos | **Supabase** Postgres | 500 MB, pausa tras 7 días de inactividad, sin backups automáticos (se documenta `pg_dump` programado) |
| Cola | **pg-boss** en el mismo Postgres | Sin servicio adicional |
| Archivos | **Supabase Storage** | 1 GB, buckets privados, ciclo de vida ≤30 días |
| Identidad | **Supabase Auth** | 50k MAU; Google, Facebook y passkeys |
| OCR / voz | **Azure AI** capa F0 | ~500 páginas/mes de Document Intelligence y ~5 h/mes de Speech; mocks por defecto |

La web no convive con la API en Vercel porque sus functions son invocaciones efímeras (300 s máx. en Hobby) sin proceso persistente: el worker de la cola necesita un proceso continuo que pollee PostgreSQL, y los Daemons de Vercel solo conceden ~10 vCPU-horas/mes en el plan gratuito — suficiente para probar, no para operar. Un host de contenedores con proceso persistente resuelve ambas necesidades en el free tier.

### Etapa 2 — producción y escalado (AWS)

| Capa | Sustitución | Nota |
|---|---|---|
| Web y PWA | Amazon S3 + CloudFront | El artefacto estático no cambia |
| API + worker | Amazon ECS Fargate o App Runner, procesos separados | El bootstrap se divide; el código de negocio no |
| PostgreSQL | Amazon RDS / Aurora | Migración estándar de PostgreSQL; mismo esquema |
| Cola | Amazon SQS o BullMQ sobre ElastiCache (Redis) | Solo cambia el adaptador del puerto de cola |
| Archivos | Amazon S3 | Mismo contrato S3-compatible y URLs firmadas |
| Identidad | Amazon Cognito u OIDC gestionado | El dominio conserva issuer–subject |
| OCR / voz | Azure en plan pago, o Amazon Textract / Transcribe | Detrás de los mismos puertos |
| Observabilidad | OpenTelemetry + backend de métricas/trazas | Se activa con la telemetría ya prevista |

La extracción de microservicios se evalúa solo con las métricas y umbrales de [Arquitectura de solución](03-arquitectura-solucion.md); nunca antes de necesitarla.

### No incluido inicialmente

- Kubernetes y service mesh.
- Kafka u otro log distribuido.
- Redis/BullMQ, Keycloak y MinIO como piezas operadas a mano (sus roles ya están cubiertos por Supabase y pg-boss; se evalúan en etapa 2 si el volumen lo justifica).
- Base por microservicio antes de extraer servicios.
- Multi-región activa-activa.
- Data warehouse o plataforma ML.
- OpenTelemetry backend, escaneo de malware y generación de cliente OpenAPI (diferidos a endurecimiento).

## Alternativas relevantes

| Alternativa | Ventaja | Motivo para no elegirla ahora |
|---|---|---|
| Python (Django/FastAPI) | Ecosistema de datos y scripting maduro | Duplicar lenguaje entre web y API aumenta cambio de contexto sin beneficio para este dominio |
| Go | Rendimiento y binarios simples | Curva de productividad y menor ecosistema de componentes/formularios que TypeScript full-stack |
| Spring Boot | Ecosistema empresarial y operación madura | Mayor cambio de contexto sin equipo JVM ni requisito que lo compense |
| Backend en Vercel Functions | Mismo hosting que la web | Funciones efímeras sin proceso persistente para el worker de cola; Daemons ≈10 vCPU-h/mes en Hobby |
| Keycloak autogestionado | OIDC abierto y completo | Requiere operar JVM, base y TLS propios; Supabase Auth cubre OAuth/passkeys en free tier |
| Redis + BullMQ | Cola de alto throughput | Infraestructura extra que el volumen del MVP no justifica; pg-boss resuelve la misma necesidad en Postgres |
| Next.js | SSR, rutas servidor y plataforma full-stack | El producto autenticado no necesita SEO/SSR y podría difuminar la separación con la API |
| MongoDB | Esquema flexible | Menor ajuste para integridad relacional, decimales, auditoría y reportes financieros |
| Microservicios desde el inicio | Despliegue y escalado aislados | Multiplica fallos, contratos, observabilidad y consistencia sin carga demostrada |
| Cola solo en memoria | Menor infraestructura | Pierde trabajos al reiniciar y no soporta procesamiento fiable |
| Procesamiento síncrono de OCR/voz | Flujo aparentemente simple | Acopla latencia y disponibilidad externa a HTTP y empeora reintentos |
| LLM para toda clasificación | Mayor flexibilidad lingüística | Coste, privacidad, no determinismo y falta de datos confirmados |

## Política de versiones y suministro

- Elegir la versión LTS o estable soportada al iniciar cada fase, nunca previews.
- Fijar versiones exactas mediante lockfile durante la implementación.
- No adoptar una publicación con menos de siete días salvo parche de seguridad evaluado y aprobado.
- Revisar compatibilidad de Node.js, NestJS, Prisma y PostgreSQL como conjunto.
- Mantener actualizaciones de seguridad y probar migraciones/restauración antes de promover.
- Registrar cualquier cambio de tecnología o major version como decisión arquitectónica.

## Referencias oficiales verificadas

- [NestJS: módulos](https://docs.nestjs.com/modules)
- [NestJS: microservicios](https://docs.nestjs.com/microservices/basics)
- [NestJS: colas](https://docs.nestjs.com/techniques/queues)
- [Vite: build de producción](https://vite.dev/guide/build.html)
- [Prisma ORM](https://www.prisma.io/docs/orm)
- [pg-boss](https://pgboss.io/)
- [Supabase Auth](https://supabase.com/docs/guides/auth) y [Supabase Storage](https://supabase.com/docs/guides/storage)
- [Vite PWA / Workbox](https://vite-pwa-org.netlify.app/)
- [Dexie (IndexedDB)](https://dexie.org/)
- [ExcelJS](https://github.com/exceljs/exceljs)
- [Render free tier](https://render.com/docs/free)
- [Azure AI Document Intelligence](https://learn.microsoft.com/azure/ai-services/document-intelligence/)
- [Azure AI Speech](https://learn.microsoft.com/azure/ai-services/speech-service/)
- [OpenTelemetry](https://opentelemetry.io/docs/) (referencia de etapa 2)

## Siguiente documento

La distribución concreta de estas piezas y sus flujos está en [Arquitectura de solución](03-arquitectura-solucion.md).
