# Stack tecnológico recomendado

La propuesta utiliza TypeScript en web y API, PostgreSQL como fuente de verdad y adaptadores sustituibles para identidad, archivos, OCR y voz. El objetivo no es acumular herramientas: es entregar un TFM reproducible con límites suficientes para evolucionar sin reescribir el dominio.

## Decisión

- **Frontend:** React y Vite como aplicación estática desplegable de forma independiente.
- **Backend:** NestJS sobre Node.js LTS como API REST y proceso worker.
- **Arquitectura:** monolito modular con dominio y casos de uso libres de frameworks.
- **Persistencia:** PostgreSQL; Prisma solo dentro de adaptadores.
- **Asincronía:** BullMQ y Redis persistente, coordinados con un outbox en PostgreSQL.
- **Archivos:** almacenamiento privado compatible con S3; MinIO para desarrollo.
- **Identidad:** OpenID Connect; Keycloak como referencia sustituible.
- **Aislamiento:** un workspace financiero personal por identidad y uno efímero por sesión demo.
- **Demo:** misma API/casos de uso con semilla y adaptadores mock; medios reales permanecen en el navegador.
- **OCR y voz:** Azure AI Document Intelligence y Azure AI Speech detrás de puertos propios.
- **Analítica:** consultas y agregados en PostgreSQL, con políticas deterministas.
- **Despliegue inicial:** frontend estático, API y worker en contenedores; sin Kubernetes.

## Criterios de selección

| Criterio | Consecuencia técnica |
|---|---|
| Equipo pequeño y sin ecosistema impuesto | Un lenguaje principal reduce cambios de contexto y duplicación de conocimientos |
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
| Web | Interfaz, captura del navegador, validación de experiencia y consumo de API | Cliente generado desde el contrato público; nunca Prisma ni módulos internos de API |
| API | HTTP, autorización, validación de entrada, casos de uso síncronos y consulta de estados | Módulos de aplicación y adaptadores configurados en composición |
| Worker | Relay de outbox, OCR, voz, mantenimiento y agregados asíncronos | Los mismos puertos de aplicación, con adaptadores de cola y proveedor |

### Compartición permitida

- Cliente HTTP generado y modelos del contrato público.
- Utilidades técnicas estables de observabilidad, configuración y pruebas.
- Catálogos de traducción cuando tengan la misma propiedad y ciclo de publicación.

### Compartición prohibida

- Entidades de dominio entre web y API.
- Tipos generados por Prisma fuera del adaptador de persistencia.
- Modelos de respuesta de Azure, Keycloak, Redis o S3 fuera de sus adaptadores.
- Acceso de un módulo a tablas, repositorios o servicios internos de otro módulo.

No se incorpora Nx inicialmente. Los espacios de trabajo técnicos y reglas de importación son suficientes para el TFM; un orquestador de monorepo se justificará cuando el grafo de builds o el tiempo de CI lo requieran.

## Workspace financiero y modo demo

El workspace financiero es una entidad de dominio y aislamiento, no una carpeta ni una unidad desplegable. No se crea un servicio de tenancy en el MVP.

| Pieza | Responsabilidad |
|---|---|
| PostgreSQL | Estado canónico de workspace, política de retención, sesión demo y versión de semilla |
| Keycloak/OIDC | Identidad personal, rol demo, sesiones concurrentes y logout |
| API | Resolver el workspace desde identidad/sesión y construir un contexto no controlado por cliente |
| Worker | Expiración de medios y limpieza idempotente de workspaces demo terminados |
| Web | Mostrar workspace actual, política y marca demo; mantener preview demo únicamente en memoria local |
| Seeder | Materializar datos sintéticos versionados una sola vez por sesión demo |
| Adaptadores mock | Simular OCR/voz y errores sin acceder a Azure ni interpretar el medio local |

Para usuarios personales, `(issuer, subject)` resuelve el único workspace persistente. Para demo, la identidad compartida se combina con `sid` o con un identificador servidor ligado a la sesión validada. La misma sesión recupera el mismo workspace; una sesión nueva obtiene otro.

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

### Decisiones de experiencia

- Cámara y micrófono se habilitan solo en HTTPS o entorno local compatible.
- Si una capacidad no existe, la interfaz ofrece selección de archivo o entrada manual.
- En demo, el preview de cámara/micrófono permanece en memoria del navegador y se descarta sin upload; el backend recibe solo un identificador de escenario sintético.
- La PWA se limita en el MVP a instalación y caché del shell estático. No se guarda información financiera sensible en almacenamiento offline ni se prometen capturas pendientes sin conexión.
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
| Configuración de Prisma, Redis, S3 y Azure | Adaptadores de infraestructura |
| Decoradores de framework | Prohibidos en dominio y aplicación |

Los casos de uso reciben dependencias por constructor mediante puertos propios. La raíz de composición los conecta con adaptadores NestJS; no se utiliza el contenedor del framework como localizador de servicios dentro del dominio.

### Contrato HTTP

- REST JSON con versión mayor en ruta, comenzando por `/api/v1` durante la implementación.
- La API es propietaria de la descripción OpenAPI.
- El cliente web se genera a partir del contrato publicado; no se comparte la implementación de DTO internos.
- Un cambio compatible puede añadir campos opcionales. Eliminar, renombrar o cambiar semántica requiere una nueva versión mayor y una ventana de migración.
- Errores, paginación, correlación e idempotencia tendrán formatos comunes.
- El frontend llama directamente a la API; no se incorpora gateway mientras exista una sola API pública.

## Persistencia

### PostgreSQL

PostgreSQL será la fuente de verdad para workspaces, vínculos de identidad/sesión, políticas de retención, transacciones, trabajos, planes, revisiones y outbox.

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
- Una transacción técnica no debe atravesar varios contextos como solución habitual; los flujos entre módulos usan casos de uso y, cuando corresponda, outbox.

Si Prisma impide expresar una consulta analítica o migración segura, se permite SQL encapsulado en infraestructura. La herramienta no gobierna el modelo financiero.

## Trabajos asíncronos y fiabilidad

### BullMQ y Redis

BullMQ resuelve colas, concurrencia, reintentos, rate limiting y workers separados. Redis se configura como infraestructura durable de trabajos, no como caché descartable:

- Persistencia AOF habilitada.
- Política de memoria `noeviction`.
- Autenticación y TLS fuera del entorno local.
- Monitorización de trabajos activos, fallidos, demorados y estancados.
- Retención acotada de metadatos completados y fallidos.

BullMQ ofrece entrega **al menos una vez**. No se promete exactly-once.

### Relación entre outbox, BullMQ y estado canónico

1. El caso de uso guarda el cambio de negocio, su `workspace_id`, el estado inicial del trabajo y un evento de outbox en una misma transacción PostgreSQL.
2. El relay bloquea un evento pendiente y crea un job BullMQ con un identificador determinista derivado del evento.
3. Solo después de la confirmación de Redis, el relay marca el evento como despachado.
4. Si el relay cae entre ambos pasos, el reintento utiliza el mismo identificador y la deduplicación evita una segunda intención lógica.
5. El worker reclama o crea en PostgreSQL una ejecución única por captura, tipo y versión de procesamiento.
6. El resultado y el siguiente evento se guardan juntos; una respuesta duplicada observa el resultado existente y no repite el efecto.
7. Un reconciliador recupera eventos pendientes, trabajos estancados y estados PostgreSQL sin job operativo.

El estado de BullMQ sirve para operar la cola. El estado PostgreSQL decide qué ocurrió para el negocio.

### Política de fallos

| Tipo de fallo | Comportamiento |
|---|---|
| Timeout, indisponibilidad o límite temporal | Reintento exponencial con jitter y máximo configurable |
| Rate limit del proveedor | Respetar espera indicada y presupuesto de consumo |
| Archivo inválido o campo no interpretable | Fallo permanente y ruta manual, sin reintento automático infinito |
| Agotamiento de reintentos | Estado fallido recuperable y cola de revisión operativa |
| Mensaje o respuesta duplicada | Guardas de unicidad e idempotencia; no duplica borrador ni transacción |
| Cuota agotada o kill switch activo | No invocar proveedor; informar degradación y conservar entrada manual |

Una cola respaldada por PostgreSQL sería una alternativa más ligera si el entorno de despliegue no puede ofrecer Redis persistente. Esa sustitución debe decidirse antes de implementar trabajos; no se simulará durabilidad con Redis efímero.

## Archivos y almacenamiento

Se utiliza una API compatible con S3 para no guardar binarios en el disco de API/worker ni aumentar las copias de seguridad de PostgreSQL.

- MinIO implementa el contrato en desarrollo local.
- Los buckets son privados y cifrados en reposo cuando la plataforma lo permita.
- La API crea el activo y emite una URL firmada de subida vinculada a workspace, clave, tipo, tamaño y expiración esperados.
- El cliente sube directamente y confirma checksum; la API verifica metadatos antes de encolar.
- Un objeto comienza en cuarentena y solo se procesa después de validar tipo real, dimensiones, páginas y política de malware.
- Al normalizar, el activo guarda el plazo de 1, 2 o 3 meses vigente y un `expires_at`; cambiar el workspace no altera objetos existentes.
- Las URLs de lectura son breves, autorizadas por workspace/recurso y nunca permanentes.
- El ciclo de vida elimina objetos temporales, huérfanos, vencidos o pertenecientes a un workspace terminado y registra el resultado en PostgreSQL.

Guardar archivos en el sistema local o como `bytea` simplificaría la primera demo, pero acoplaría escalado, backups y retención. El coste de un servicio S3-compatible es aceptable porque cámara y audio son requisitos centrales, no accesorios.

## Identidad y autorización

### Protocolo

- OpenID Connect con Authorization Code y PKCE para la web.
- La API actúa como resource server y valida firma mediante JWKS, issuer, audience, expiración y algoritmo permitido.
- La identidad local se vincula mediante la pareja inmutable issuer–subject, nunca solo por correo electrónico.
- Para personal, esa pareja resuelve el único workspace; para demo, el rol y la sesión `sid` resuelven un workspace efímero independiente.
- El logout termina la sesión local, revoca el workspace demo asociado y solicita cierre en el proveedor cuando el protocolo lo permite.
- Los roles son mínimos; la pertenencia de cada recurso se valida contra el workspace derivado por servidor.

### Proveedor

Keycloak es la referencia por ser abierto, soportar autorregistro, recuperación, OIDC, MFA y passkeys. En local puede ejecutarse como servicio opcional con realm reproducible durante la futura implementación.

No se oculta su coste: una instalación de producción requiere TLS, base de datos, backups, actualizaciones, monitorización y memoria reservada. Para el despliegue público del TFM puede sustituirse por un OIDC gestionado si reduce operación. El dominio solo conserva issuer y subject, por lo que el cambio no modifica reglas financieras.

MFA y passkeys son capacidades recomendadas de endurecimiento; el flujo básico de registro y acceso es la puerta del MVP.

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
| Trazas | Contexto OpenTelemetry en API, worker y llamadas externas | Collector y almacenamiento cuando el diagnóstico lo justifique |

No se despliega una plataforma completa de observabilidad para la demo. Se conserva el estándar y se activa el backend en la fase de endurecimiento.

## Estrategia de pruebas

| Nivel | Herramientas | Objetivo |
|---|---|---|
| Unidad | Vitest | Entidades, valores, políticas y casos de uso sin NestJS ni red |
| Componentes | React Testing Library | Formularios, estados, accesibilidad y errores |
| Integración | Vitest y servicios efímeros | PostgreSQL, Redis, MinIO y adaptadores de persistencia |
| Contrato HTTP | OpenAPI y cliente generado | Compatibilidad entre despliegues de web y API |
| Proveedores | Fixtures más pruebas opt-in | Normalización estable sin consumir cuota ordinaria |
| End-to-end | Playwright | Registro, captura, confirmación, reportes y planificación |
| Accesibilidad | axe y pruebas manuales | WCAG 2.2 AA, teclado, foco y alternativas a gráficos |

## Despliegue de referencia

### Desarrollo

- Web y procesos Node.js ejecutados desde el workspace.
- PostgreSQL, Redis, MinIO y, cuando se necesite, Keycloak en contenedores.
- Adaptadores simulados por defecto para OCR y voz.
- Servicios externos habilitados solo con credenciales fuera del repositorio.

### TFM desplegado

- Web en hosting estático con CDN.
- API y worker como contenedores independientes.
- PostgreSQL gestionado con backups.
- Redis persistente compatible con los requisitos de BullMQ.
- Almacenamiento de objetos privado y económico.
- OIDC gestionado o Keycloak endurecido según el presupuesto real.
- Azure OCR/voz con presupuesto y kill switch.

### No incluido inicialmente

- Kubernetes y service mesh.
- Kafka u otro log distribuido.
- Base por microservicio antes de extraer servicios.
- Multi-región activa-activa.
- Data warehouse o plataforma ML.

## Alternativas relevantes

| Alternativa | Ventaja | Motivo para no elegirla ahora |
|---|---|---|
| Spring Boot | Ecosistema empresarial y operación madura | Mayor cambio de contexto sin equipo JVM ni requisito que lo compense |
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
- [BullMQ: producción](https://docs.bullmq.io/guide/going-to-production)
- [Keycloak: documentación](https://www.keycloak.org/documentation)
- [Azure AI Document Intelligence](https://learn.microsoft.com/azure/ai-services/document-intelligence/)
- [Azure AI Speech](https://learn.microsoft.com/azure/ai-services/speech-service/)
- [OpenTelemetry](https://opentelemetry.io/docs/)

## Siguiente documento

La distribución concreta de estas piezas y sus flujos está en [Arquitectura de solución](03-arquitectura-solucion.md).
