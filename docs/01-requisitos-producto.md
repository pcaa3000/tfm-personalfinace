# Requisitos del producto

Este documento define un MVP internacional de finanzas personales que convierte entradas manuales, tickets y dictados en transacciones confirmadas y recomendaciones explicables, sin conectarse a entidades bancarias ni mover dinero.

## Resumen ejecutivo

La persona usuaria necesita una vista fiable de sus finanzas sin depender de una única forma de carga. La aplicación debe reducir la fricción de registro, conservar el control humano sobre los datos inferidos y explicar cómo llega a cada recomendación.

El flujo central es único: **capturar, proponer, revisar, confirmar y analizar**. Tanto OCR como voz generan borradores; solo una confirmación explícita crea información financiera válida.

## Objetivos

1. Proporcionar a cada usuario registrado un workspace financiero personal y aislado.
2. Registrar ingresos y gastos con el menor esfuerzo compatible con la calidad del dato.
3. Unificar entrada manual, ticket y voz en el mismo modelo de transacción.
4. Clasificar movimientos con reglas comprensibles y correcciones del usuario.
5. Mostrar reportes accionables por período, categoría, comercio y moneda.
6. Recomendar una tasa de ahorro sostenible y una distribución adaptable en siete bolsillos virtuales.
7. Detectar gastos pequeños y repetitivos sin imponer un umbral universal ni culpabilizar a la persona.
8. Proteger imágenes, audios y datos financieros mediante una retención configurable y borrado anticipado.
9. Ofrecer una demo reproducible, aislada y claramente simulada para demostrar los flujos sin consumir proveedores externos.

## Alcance

### Incluido en el MVP

- Registro y autenticación mediante un proveedor de identidad.
- Un workspace financiero personal por usuario registrado.
- Preferencias de idioma, locale, zona horaria, moneda y retención en el workspace.
- Ingresos y gastos manuales.
- Tickets capturados con cámara o seleccionados desde almacenamiento.
- Dictados cortos desde micrófono.
- Procesamiento asíncrono de OCR y voz.
- Retención común de tickets y audios durante 1, 2 o 3 meses.
- Revisión obligatoria de datos inferidos.
- Categorías globales y personalizadas por workspace.
- Reportes mensuales separados por moneda.
- Recomendación de ahorro después de cerrar un período mensual válido.
- Siete bolsillos virtuales y porcentajes ajustables.
- Detección configurable de gastos hormiga.
- Exportación y eliminación de datos del workspace.
- Cuenta demo compartida con un workspace efímero independiente por sesión.
- Datos demo sintéticos y extracciones simuladas que se restablecen en cada nuevo login.

### Fuera del MVP

- Conexión a bancos u otros agregadores financieros.
- Open banking, iniciación de pagos o transferencias.
- Apertura, custodia o conciliación de cuentas reales.
- Crédito, inversión, compraventa de activos o cálculo fiscal.
- Presupuestos familiares compartidos y permisos multiusuario.
- Múltiples workspaces por usuario, membresías, invitaciones o transferencia de propiedad.
- Procesamiento de medios demo mediante Azure o cualquier proveedor de pago.
- Reinicio manual del dataset dentro de una sesión demo vigente.
- Conversión automática entre monedas sin una fuente de tipos de cambio trazable.
- Recomendaciones presentadas como asesoramiento financiero, fiscal, legal o de inversión.
- Clasificación o planificación dependientes de un LLM.
- Microservicios distribuidos, Kubernetes, Kafka o un data warehouse en la primera versión.

## Actores y sistemas externos

| Actor o sistema | Responsabilidad |
|---|---|
| Persona usuaria registrada | Opera exclusivamente sobre su workspace personal; registra, revisa, confirma y corrige datos |
| Visitante demo | Utiliza credenciales compartidas dentro de un workspace efímero aislado por sesión |
| Aplicación web | Captura entradas, presenta estados, solicita confirmación y muestra reportes accesibles |
| API de negocio | Ejecuta casos de uso, aplica autorización y conserva el estado canónico |
| Worker | Procesa de forma asíncrona archivos, OCR, voz, outbox y agregados |
| Proveedor de identidad | Autentica, recupera cuentas y ofrece segundo factor o passkeys |
| Proveedor OCR | Extrae campos y confianza de imágenes o documentos de tickets |
| Proveedor de voz | Convierte audio en texto y, cuando exista, informa idioma y confianza |
| Operación técnica | Observa salud, costes y errores sin acceso ordinario al contenido financiero |

## Supuestos

- Cada identidad personal posee exactamente un workspace financiero; no existe colaboración en el MVP.
- La API resuelve el workspace desde la identidad o sesión validada y no confía en un identificador enviado por cliente.
- La web será responsive y utilizará cámara y micrófono solo en contextos seguros y con permiso explícito.
- La entrada manual debe seguir disponible aunque fallen OCR, voz o almacenamiento externo.
- El MVP ofrecerá interfaz y patrones de dictado en español e inglés; el diseño permitirá añadir idiomas sin cambiar el dominio.
- Cada transacción conserva su moneda original. Los reportes no suman monedas distintas.
- El período base es el mes calendario de la zona horaria configurada en el workspace.
- Un cierre mensual requiere datos confirmados y una declaración de integridad; el sistema no puede saber si faltan movimientos sin conexión bancaria.
- La política de retención se elige una vez para tickets y audios, acepta 1, 2 o 3 meses y solo afecta capturas futuras.
- Cada login demo nuevo recibe una sesión y workspace diferentes; recargar conserva la sesión y logout/expiración la termina.
- Cámara y micrófono demo se procesan localmente para preview; ningún medio real se sube ni se envía a proveedores.
- Las cuotas y precios de proveedores externos pueden cambiar y no forman parte de la garantía funcional.

## Glosario

| Término | Definición |
|---|---|
| Workspace financiero | Contenedor aislado de datos, preferencias y políticas de una identidad personal o sesión demo |
| Workspace personal | Workspace persistente y único de un usuario registrado |
| Sesión demo | Sesión OIDC de credenciales compartidas ligada a un workspace efímero exclusivo |
| Dataset semilla | Conjunto sintético, versionado y reproducible materializado al iniciar una sesión demo |
| Política de retención | Plazo común de 1, 2 o 3 meses que un workspace asigna a nuevos tickets y audios |
| Transacción | Ingreso o gasto perteneciente a un workspace, con importe positivo, moneda, fecha de negocio y estado |
| Borrador | Propuesta editable que todavía no participa en reportes ni recomendaciones |
| Transacción confirmada | Dato aceptado explícitamente por la persona usuaria y válido para cálculos |
| Activo capturado | Imagen, documento o audio almacenado temporalmente y asociado a un intento de captura |
| Extracción | Resultado normalizado de OCR o voz, con procedencia y confianza por campo cuando esté disponible |
| Categoría | Clasificación de un movimiento; puede ser global, personalizada o quedar explícitamente sin categorizar |
| Período mensual | Mes calendario cerrado según la zona horaria del workspace |
| Tasa de ahorro | Porcentaje recomendado de ingresos confirmados que puede reservarse sin exceder la capacidad estimada |
| Bolsillo virtual | Destino conceptual de una parte del ahorro; no representa una cuenta ni dinero real |
| Gasto hormiga | Patrón agregado de gastos discrecionales pequeños y repetitivos según reglas configurables |
| Confianza | Calidad estimada de una extracción o recomendación; no equivale a certeza |
| Moneda original | Código ISO 4217 en el que se registró una transacción |

## Flujos principales

### Acceso personal y workspace

1. La persona se autentica mediante OIDC.
2. La API resuelve su perfil por issuer–subject.
3. En el primer acceso crea exactamente un workspace personal con la política de retención predeterminada de un mes.
4. En accesos posteriores recupera el mismo workspace.
5. La API inyecta el workspace en cada caso de uso; el cliente no puede seleccionar otro.

### Registro manual

1. La persona elige ingreso o gasto.
2. Introduce importe, moneda, fecha, concepto y categoría.
3. La aplicación valida el dato y muestra un resumen.
4. La confirmación crea la transacción.
5. Los reportes afectados se recalculan o invalidan.

### Captura de ticket

1. La persona toma una fotografía o selecciona un archivo.
2. La aplicación valida tamaño, formato y permiso de uso.
3. El activo se almacena en cuarentena y se crea un trabajo trazable.
4. El worker solicita la extracción OCR y normaliza su respuesta.
5. La web muestra comercio, fecha, moneda, total, impuestos, partidas y confianza cuando existan.
6. La persona corrige o completa los campos y confirma.
7. La confirmación crea una única transacción; un reintento no puede duplicarla.

### Dictado

1. La persona concede permiso, inicia y detiene una grabación corta.
2. El audio se almacena temporalmente y se transcribe de forma asíncrona.
3. Un analizador sensible a locale propone tipo, importe, moneda, fecha, comercio y categoría.
4. Los campos ambiguos permanecen incompletos y el texto original queda visible para revisión.
5. La persona corrige y confirma o descarta el borrador.

### Cierre mensual y planificación

1. La persona revisa movimientos sin categorizar y confirma que el período está suficientemente completo.
2. El sistema calcula ingresos, gastos, flujo neto, distribución por categorías y calidad de los datos por moneda.
3. Si existe capacidad positiva, propone un ahorro sostenible con explicación y confianza.
4. El ahorro se distribuye entre seis destinos; la cuenta corriente conserva el resto de los ingresos.
5. La persona modifica porcentajes si lo desea y guarda una versión del plan.

### Sesión demo

1. La persona inicia sesión con las credenciales demo compartidas.
2. La API crea un workspace efímero ligado a esa sesión y materializa la semilla sintética.
3. La persona modifica datos sin afectar otras sesiones ni workspaces personales.
4. Cámara y micrófono muestran preview local; el backend devuelve escenarios de extracción mock marcados como simulados y no recibe el medio real.
5. Recargar conserva el workspace mientras la sesión siga vigente.
6. Logout o expiración revoca el workspace e inicia su limpieza.
7. El siguiente login crea otro workspace con la semilla original.

## Requisitos funcionales

### Identidad y workspace

| ID | Requisito |
|---|---|
| RF-001 | La persona debe poder registrarse, autenticarse, cerrar sesión y recuperar acceso mediante OpenID Connect |
| RF-002 | La API debe restringir cada operación al workspace resuelto desde la identidad o sesión autenticada |
| RF-003 | El workspace debe conservar idioma, locale, zona horaria y moneda predeterminada de nuevas transacciones |
| RF-004 | La persona debe poder cambiar las preferencias de su workspace sin alterar moneda, zona ni fecha histórica de transacciones existentes |
| RF-005 | La gestión de credenciales, segundo factor y passkeys debe pertenecer al proveedor de identidad, no a la aplicación de negocio |
| RF-006 | El primer acceso de una identidad personal debe crear exactamente un workspace personal y los accesos siguientes deben recuperar el mismo |
| RF-007 | Todo recurso financiero o derivado debe pertenecer a un workspace explícito e inmutable |
| RF-008 | El contexto de workspace debe ser construido por la API; un identificador enviado por cliente no concede pertenencia ni acceso |
| RF-009 | El MVP no debe permitir crear un segundo workspace personal, añadir miembros ni transferir propiedad |

### Libro de transacciones

| ID | Requisito |
|---|---|
| RF-010 | La persona debe poder crear manualmente un ingreso o gasto con importe, moneda, fecha de negocio, concepto y categoría |
| RF-011 | Todo importe debe ser positivo; el tipo ingreso o gasto determina su efecto financiero |
| RF-012 | Una transacción debe poder editarse o anularse y conservar trazabilidad de la revisión que cambió los reportes |
| RF-013 | La persona debe poder listar, buscar, paginar y filtrar por período, tipo, moneda, categoría, comercio y origen |
| RF-014 | La aplicación debe distinguir borrador, confirmado y anulado; solo confirmado participa en cálculos |
| RF-015 | La categoría `Sin categorizar` debe ser visible y filtrable, nunca un valor ausente oculto |
| RF-016 | Toda operación de creación susceptible de repetición debe aceptar una clave de idempotencia o un identificador equivalente |

### Tickets y OCR

| ID | Requisito |
|---|---|
| RF-020 | La web debe permitir capturar un ticket con cámara o seleccionar un archivo compatible |
| RF-021 | Tipos, tamaño, dimensiones, número de páginas y duración de conservación deben ser políticas configurables |
| RF-022 | Cada activo debe pertenecer a un workspace y conservar checksum, política de retención asignada, expiración, estado de cuarentena y ciclo de vida independiente del borrador |
| RF-023 | El procesamiento debe ser asíncrono y mostrar al menos los estados recibido, en cola, procesando, requiere revisión, confirmado, fallido y descartado |
| RF-024 | La extracción debe intentar obtener comercio, fecha, hora, moneda, subtotal, impuestos, propina, total y partidas cuando el proveedor los ofrezca |
| RF-025 | Cada campo inferido debe conservar origen, valor bruto, valor normalizado y confianza cuando el proveedor la informe |
| RF-026 | La persona debe poder corregir cualquier campo antes de confirmar y debe ver qué valores fueron inferidos |
| RF-027 | Reintentos, mensajes duplicados o respuestas tardías no deben crear más de un borrador activo ni más de una transacción para la misma captura |
| RF-028 | Ante error, formato no compatible o cuota agotada, la aplicación debe conservar una ruta de reintento y entrada manual |
| RF-029 | La persona debe poder eliminar el activo original sin eliminar necesariamente la transacción confirmada |

### Voz

| ID | Requisito |
|---|---|
| RF-030 | La web debe solicitar permiso explícito antes de usar el micrófono y mostrar de forma inequívoca cuándo graba |
| RF-031 | La persona debe poder detener, reproducir, descartar o enviar una grabación antes de procesarla |
| RF-032 | El trabajo de voz debe conservar estados equivalentes al trabajo OCR y no bloquear una petición HTTP hasta finalizar |
| RF-033 | La transcripción debe conservar texto, idioma detectado o solicitado, duración y confianza cuando estén disponibles |
| RF-034 | El analizador debe proponer tipo, importe, moneda, fecha, comercio y categoría sin inventar campos que no pueda justificar |
| RF-035 | La persona debe revisar el texto y todos los campos propuestos antes de crear la transacción |
| RF-036 | Ante transcripción o interpretación fallida, la persona debe poder reutilizar el texto disponible o completar el movimiento manualmente |
| RF-037 | La persona debe poder eliminar el audio independientemente de la transacción confirmada |

### Categorías

| ID | Requisito |
|---|---|
| RF-040 | El sistema debe ofrecer categorías iniciales localizables y permitir categorías personalizadas por workspace |
| RF-041 | Una categoría debe poder marcarse como esencial, discrecional, ingreso, obligación o transferencia conceptual para soportar análisis |
| RF-042 | La sugerencia debe usar reglas explicables, texto del comercio y preferencias históricas del mismo workspace |
| RF-043 | La corrección de una sugerencia puede actualizar una preferencia del workspace por comercio solo con acción explícita o política visible |
| RF-044 | Editar o archivar una categoría no debe eliminar las transacciones históricas asociadas |

### Reportes e insights

| ID | Requisito |
|---|---|
| RF-050 | El reporte mensual debe mostrar ingresos, gastos, flujo neto y tasa de ahorro observada por moneda |
| RF-051 | Debe incluir distribución por categoría, evolución temporal, comercios principales y transacciones sin categorizar |
| RF-052 | Toda visualización debe disponer de una tabla o resumen textual equivalente y descargable |
| RF-053 | La persona debe poder navegar desde un agregado hasta las transacciones que lo componen |
| RF-054 | El sistema debe detectar candidatos a gasto hormiga mediante importe relativo, frecuencia y carácter discrecional configurables |
| RF-055 | El insight debe mostrar número de operaciones, importe total, porcentaje del gasto compatible y ahorro potencial, no solo cada gasto aislado |
| RF-056 | La persona debe poder descartar un patrón o cambiar su clasificación; esa decisión debe evitar avisos repetidos injustificados |
| RF-057 | Editar, anular o recategorizar una transacción debe invalidar los agregados y recomendaciones afectados |
| RF-058 | No se deben agregar importes de monedas diferentes en una cifra única sin conversión explícita y trazable |

### Ahorro y bolsillos virtuales

| ID | Requisito |
|---|---|
| RF-060 | La recomendación debe requerir al menos un período mensual cerrado, ingresos confirmados y confirmación de integridad del período |
| RF-061 | Si los datos son insuficientes o no existe ingreso positivo, el sistema debe explicar por qué no puede calcular un porcentaje |
| RF-062 | La recomendación debe mostrar ingresos, gastos, obligaciones, excedente, margen de seguridad, política aplicada y nivel de confianza |
| RF-063 | El 10% de los ingresos se utilizará como referencia inicial, pero la propuesta nunca debe exceder la capacidad de ahorro estimada |
| RF-064 | Con un solo mes, la recomendación debe marcarse como confianza baja y advertir sobre gastos o ingresos extraordinarios |
| RF-065 | El plan debe contener una cuenta corriente y seis bolsillos de ahorro; estos últimos deben distribuir exactamente el 100% del ahorro recomendado |
| RF-066 | Se ofrecerá como punto de partida la distribución 40/30/10/10/5/5, pero la recomendación puede adaptarla y la persona puede modificarla |
| RF-067 | La interfaz debe validar la suma antes de guardar y mostrar tanto porcentaje como importe por bolsillo |
| RF-068 | Cada versión del plan debe conservar período, datos de entrada, política, porcentajes propuestos, cambios del usuario y fecha de aceptación |
| RF-069 | Reserva fiscal y fondo de emergencia deben tener objetivos, elegibilidad y explicaciones diferentes; impuestos nunca significará imprevistos |

### Privacidad y control de datos

| ID | Requisito |
|---|---|
| RF-070 | La persona debe conocer qué proveedor externo procesa una imagen o audio antes de habilitar esa capacidad |
| RF-071 | El workspace personal debe ofrecer un único plazo de conservación para tickets y audios con valores válidos de 1, 2 o 3 meses y 1 mes predeterminado |
| RF-072 | La persona debe poder exportar transacciones, categorías, planes y metadatos de captura de su workspace en un formato interoperable |
| RF-073 | Debe poder solicitar eliminación de su workspace/cuenta y seguir el estado hasta completar borrado o anonimización legalmente justificada |
| RF-074 | La eliminación debe contemplar base de datos, objetos, trabajos, cachés y copias según la política de retención documentada |
| RF-075 | Cada ticket o audio debe guardar el plazo vigente al capturarse y una expiración calculada desde ese instante |
| RF-076 | Cambiar la preferencia de retención debe afectar solo nuevas capturas y mantener inalterada la expiración de medios existentes |
| RF-077 | La interfaz debe mostrar la expiración de cada medio y permitir borrarlo antes sin eliminar necesariamente la transacción confirmada |

### Modo demo

| ID | Requisito |
|---|---|
| RF-080 | La experiencia demo debe utilizar credenciales compartidas identificadas como cuenta no personal y sin funciones de recuperación o cambio de identidad |
| RF-081 | Cada nueva sesión OIDC demo debe crear un workspace efímero distinto mediante `sid` o un identificador servidor ligado a la sesión validada |
| RF-082 | El workspace demo debe materializar una semilla sintética versionada con manual, ticket, voz, reportes, gastos hormiga, ahorro, bolsillos y auditoría |
| RF-083 | Recargar debe conservar los cambios mientras la sesión continúe vigente; no debe existir reinicio manual en el MVP |
| RF-084 | Logout o expiración deben revocar el workspace inmediatamente e iniciar limpieza idempotente; el siguiente login debe cargar la semilla original en otro workspace |
| RF-085 | Dos sesiones demo concurrentes con el mismo `subject` deben mantener datos, objetos, cachés, jobs y proyecciones separados |
| RF-086 | Cámara, archivos y micrófono demo deben permanecer en el navegador; el backend solo recibe un escenario sintético y no llama a Azure |
| RF-087 | Toda extracción, error o confianza demo debe marcarse como simulada y nunca atribuirse al contenido real capturado |

## Reglas de negocio transversales

| ID | Regla |
|---|---|
| RN-001 | Solo una transacción confirmada puede afectar reportes, ahorro o insights |
| RN-002 | El dinero se representa como decimal y moneda ISO 4217; no se utiliza coma flotante binaria |
| RN-003 | La fecha de negocio se interpreta en la zona horaria registrada, mientras los instantes técnicos se conservan en UTC |
| RN-004 | Cambiar locale o zona horaria del workspace no reinterpreta silenciosamente datos históricos |
| RN-005 | Un agregado financiero contiene una única moneda o incluye una conversión con fuente, tasa, par y fecha |
| RN-006 | Una captura origina como máximo una transacción confirmada; todo consumidor asíncrono debe ser idempotente |
| RN-007 | Una recomendación no puede producir ahorro negativo ni superior al excedente disponible después del margen de seguridad |
| RN-008 | La suma de los seis porcentajes de ahorro debe ser 100%; la cuenta corriente queda fuera de esa suma |
| RN-009 | La confianza de una recomendación depende de meses válidos, cobertura, datos sin categorizar, regularidad de ingresos y anomalías |
| RN-010 | Un gasto hormiga debe ser confirmado, discrecional, pequeño respecto de una política por moneda y repetido al menos el número configurado de veces |
| RN-011 | Gastos esenciales, impuestos, devoluciones y movimientos anulados quedan fuera de gasto hormiga por defecto |
| RN-012 | Toda sugerencia debe exponer sus evidencias y permitir corrección, descarte o desactivación |
| RN-013 | Una reserva fiscal cubre obligaciones fiscales estimadas; un fondo de emergencia cubre eventos imprevistos y no son intercambiables |
| RN-014 | Los bolsillos son proyecciones matemáticas; guardarlos nunca desencadena un movimiento de dinero |
| RN-015 | Todo recurso financiero o derivado pertenece a un solo workspace y no puede reasignarse a otro |
| RN-016 | Una identidad personal posee exactamente un workspace; una sesión demo posee exactamente un workspace efímero |
| RN-017 | La retención del medio se fija al capturarse y solo admite 1, 2 o 3 meses calendario; cambios posteriores no la reescriben |
| RN-018 | Un workspace demo terminado nunca se reactiva; un nuevo login materializa la semilla original en otro workspace |

## Requisitos no funcionales

| ID | Área | Requisito verificable |
|---|---|---|
| RNF-001 | Seguridad | Todo tráfico externo debe usar TLS y la autenticación debe seguir Authorization Code con PKCE mediante OpenID Connect |
| RNF-002 | Autorización | Cada acceso debe comprobar el workspace derivado en la API, independientemente de los IDs o filtros enviados por cliente |
| RNF-003 | Privacidad | Imágenes, audios, texto extraído y datos financieros deben tener finalidad, retención, exportación y borrado definidos |
| RNF-004 | Logs | Los logs no deben incluir tokens, imágenes, audios, transcripciones completas, notas ni importes asociados a una identidad |
| RNF-005 | Fiabilidad | PostgreSQL es la fuente de verdad; trabajos y eventos admiten reintentos sin duplicar efectos |
| RNF-006 | Rendimiento | Bajo la carga de referencia, el 95% de operaciones síncronas propias debe responder en menos de 750 ms, excluyendo proveedores externos |
| RNF-007 | Reportes | Un reporte mensual de hasta 10.000 transacciones de un perfil debe responder en menos de 2 s en el entorno de referencia |
| RNF-008 | Asincronía | La aceptación de una captura debe devolver estado trazable sin esperar OCR o voz; el progreso debe poder consultarse o recibirse posteriormente |
| RNF-009 | Accesibilidad | Los flujos críticos deben cumplir WCAG 2.2 nivel AA; gráficos tendrán alternativa tabular y no dependerán solo del color |
| RNF-010 | Internacionalización | Textos, plurales, moneda, número, fecha y zona horaria deben usar recursos y APIs sensibles a locale |
| RNF-011 | Portabilidad | OCR, voz, identidad y almacenamiento deben implementarse como adaptadores sustituibles por contrato |
| RNF-012 | Coste | Cada proveedor de pago debe tener cuota, timeout, reintentos acotados, métrica de consumo y degradación manual |
| RNF-013 | Observabilidad | API y worker deben propagar correlación y emitir logs, métricas y trazas sin contenido financiero sensible |
| RNF-014 | Mantenibilidad | Dominio y aplicación no deben importar frameworks, ORM, colas, SDK cloud ni tipos HTTP |
| RNF-015 | Escalabilidad | API y workers deben ser sin estado local y escalables horizontalmente; los archivos no se almacenan en su disco efímero |
| RNF-016 | Recuperación | Deben existir copias verificables de PostgreSQL y metadatos de objetos, con procedimiento de restauración probado antes de producción |
| RNF-017 | Navegadores | Cámara y micrófono solo se ofrecerán cuando el navegador y el contexto seguro los soporten; siempre existirá alternativa de archivo o entrada manual |
| RNF-018 | Compatibilidad | Los contratos HTTP publicados deben versionarse y mantener una ventana de migración definida para clientes desplegados por separado |
| RNF-019 | Aislamiento | Persistencia, objetos, jobs, cachés, eventos y proyecciones deben incluir y validar el workspace; las pruebas deben cubrir accesos cruzados |
| RNF-020 | Demo | La revocación del workspace demo debe ser inmediata y su limpieza física idempotente/reconciliable; ninguna ruta demo puede invocar proveedores de pago |

## Criterios de aceptación del MVP

| ID | Escenario aceptado |
|---|---|
| CA-001 | Una persona autenticada registra manualmente un gasto y lo encuentra una sola vez en listado y reporte de su moneda |
| CA-002 | Un ticket procesado muestra un borrador editable con procedencia y no altera reportes antes de confirmarse |
| CA-003 | Un dictado ambiguo conserva el texto, deja campos sin justificar vacíos y requiere revisión antes de crear la transacción |
| CA-004 | Repetir un mensaje o trabajo de la misma captura no duplica borrador, transacción ni agregado |
| CA-005 | Dos workspaces personales no pueden leer, modificar, descargar ni inferir la existencia de recursos ajenos |
| CA-006 | Un período con euros y dólares produce resultados separados; no muestra un total combinado sin conversión trazable |
| CA-007 | Tras un único mes válido, la recomendación indica confianza baja, explica sus entradas y no supera el excedente disponible |
| CA-008 | Si los gastos igualan o superan los ingresos, el sistema propone 0% de ahorro y explica las áreas revisables, sin asignaciones ficticias |
| CA-009 | Los seis destinos de ahorro deben sumar 100% para guardar el plan; la cuenta corriente muestra el importe restante |
| CA-010 | Un gasto aislado pequeño no activa gasto hormiga; un patrón que cumple umbral, frecuencia y categoría muestra impacto agregado y detalle |
| CA-011 | Una caída o cuota agotada de OCR/voz termina en estado comprensible con reintento acotado y ruta manual |
| CA-012 | La persona elimina un activo de ticket o audio sin perder la transacción que confirmó a partir de él |
| CA-013 | Las tablas permiten comprender la misma información que los gráficos mediante teclado y lector de pantalla |
| CA-014 | La exportación incluye monedas, zonas horarias, origen, estados y revisiones suficientes para interpretar los datos fuera del sistema |
| CA-015 | El primer acceso personal crea un workspace; repetir el acceso devuelve el mismo y no permite crear un segundo |
| CA-016 | Un medio capturado con plazo de 1 mes conserva esa expiración después de cambiar la preferencia a 3 meses; la siguiente captura usa 3 meses |
| CA-017 | Dos logins demo concurrentes con las mismas credenciales reciben workspaces y modificaciones independientes |
| CA-018 | Recargar conserva datos demo, pero logout/expiración revoca el workspace y el siguiente login restaura la semilla original |
| CA-019 | Cámara/micrófono demo no generan una subida real ni llamada Azure y todo resultado se muestra como simulado |

## Datos mínimos para una recomendación

Una recomendación mensual solo puede emitirse cuando se cumplen todas estas condiciones:

- El período está cerrado según la zona horaria del workspace.
- Existe al menos un ingreso confirmado en la moneda analizada.
- Solo se utilizan movimientos confirmados y no anulados.
- La persona declara que el período es suficientemente completo.
- Se informa el porcentaje y valor de movimientos sin categorizar.
- Los ingresos o gastos extraordinarios detectados se muestran como advertencia.
- El sistema puede explicar cada ajuste aplicado al objetivo de referencia.

Si alguna condición falla, el resultado es `datos insuficientes`, no una recomendación inventada.

## Dependencias documentales

- Las decisiones de implementación están en [Stack tecnológico](02-stack-tecnologico.md).
- Los módulos y flujos responsables están en [Arquitectura de solución](03-arquitectura-solucion.md).
- Las fórmulas conceptuales e invariantes se detallan en [Modelo de dominio financiero](04-modelo-dominio-financiero.md).
- Los controles y políticas de datos están en [Seguridad y privacidad](05-seguridad-privacidad.md).
- La secuencia de entrega y trazabilidad está en [Roadmap y validación](06-roadmap-validacion.md).
